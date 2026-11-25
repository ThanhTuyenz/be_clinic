import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { calculateEffectivePermissions } from '../auth/permissions/constants/permissions.constant.js';
import { AssignBranchManagerDto } from './dtos/assign-branch-manager.dto.js';

const managerSelect = { id: true, fullName: true, email: true, phoneNumber: true, isBlocked: true, status: true } satisfies Prisma.UserSelect;

@Injectable()
export class BranchManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(tx: Prisma.TransactionClient, actorId: string) {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, customPermissions: true, isDeleted: true, isBlocked: true } });
    if (!actor || actor.role !== 'CHAIN_MANAGER' || actor.isDeleted || actor.isBlocked
      || !calculateEffectivePermissions(actor.role, actor.customPermissions).some(permission => permission === 'branch:update')) {
      throw new ForbiddenException('Chỉ quản lý toàn chuỗi có quyền bổ nhiệm quản lý chi nhánh.');
    }
  }

  async options(actorId: string, branchId: number, q = '') {
    return this.prisma.$transaction(async tx => {
      await this.authorize(tx, actorId);
      const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true, isActive: true } });
      if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
      const currentManagers = await tx.user.findMany({ where: { branchId, role: 'BRANCH_MANAGER', isDeleted: false }, select: managerSelect, orderBy: { fullName: 'asc' } });
      const term = q.trim().slice(0, 100);
      const candidates = await tx.user.findMany({
        where: {
          role: 'BRANCH_MANAGER', isDeleted: false, isBlocked: false, status: 'ACTIVE',
          AND: [
            { OR: [{ branchId: null }, { branchId }] },
            ...(term ? [{ OR: [{ fullName: { contains: term, mode: 'insensitive' as const } }, { email: { contains: term, mode: 'insensitive' as const } }] }] : []),
          ],
        },
        select: managerSelect, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100,
      });
      return { branch, currentManagers, candidates };
    });
  }

  async assign(actorId: string, branchId: number, dto: AssignBranchManagerDto) {
    try {
      return await this.prisma.$transaction(async tx => {
        await this.authorize(tx, actorId);
        await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
        const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
        if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
        if (!branch.isActive) throw new BadRequestException('Không thể bổ nhiệm cho chi nhánh đã ngừng hoạt động.');
        const current = await tx.user.findMany({ where: { branchId, role: 'BRANCH_MANAGER', isDeleted: false }, select: { id: true } });
        const ids = current.map(user => user.id).sort();
        if (JSON.stringify(ids) !== JSON.stringify([...dto.expectedManagerIds].sort())) {
          throw new ConflictException('Người quản lý đã thay đổi. Vui lòng tải lại danh sách trước khi bổ nhiệm.');
        }
        const manager = await tx.user.findUnique({ where: { id: dto.managerId }, select: { ...managerSelect, role: true, branchId: true, isDeleted: true } });
        if (!manager || manager.role !== 'BRANCH_MANAGER' || manager.isDeleted || manager.isBlocked || manager.status !== 'ACTIVE') {
          throw new BadRequestException('Vui lòng chọn tài khoản quản lý chi nhánh đang hoạt động.');
        }
        if (manager.branchId !== null && manager.branchId !== branchId) {
          throw new ConflictException('Người này đang quản lý chi nhánh khác. Vui lòng chọn người chưa được phân công.');
        }
        if (ids.length === 1 && ids[0] === manager.id) return { manager };
        await tx.user.updateMany({ where: { branchId, role: 'BRANCH_MANAGER', id: { not: manager.id } }, data: { branchId: null } });
        const updated = await tx.user.update({ where: { id: manager.id }, data: { branchId }, select: managerSelect });
        await tx.auditLog.create({ data: {
          actorId, action: 'BRANCH_MANAGER_ASSIGNED', targetType: 'Branch', targetId: String(branchId),
          metadata: { previousManagerIds: ids, managerId: updated.id },
        } });
        return { manager: updated };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Phân công vừa được cập nhật. Vui lòng tải lại danh sách và thử lại.');
      }
      throw error;
    }
  }
}
