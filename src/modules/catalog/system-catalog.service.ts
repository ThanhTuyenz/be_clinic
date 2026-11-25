import { replaceReceptionSchedules } from '../bookings/helpers/reception-schedule.helper.js'
import { PACKAGE_DEPLOYMENT_SELECT, getPackageDeployments } from '../bookings/helpers/package-deployment.helper.js'
import { assertReceptionMethods, parseReceptionDays, parseBranchReceptionSchedules } from '../bookings/helpers/package-reception.helper.js'
import { UpdatePackageReceptionDto } from './dtos/update-package-reception.dto.js'
import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { RedisService } from '../../infrastructure/redis/redis.service.js'
import { EmbeddingService, mapPackageForRetrieval } from '../../infrastructure/embedding/embedding.service.js'
import { TELEMETRY_CONFIG } from '../recommendations/constants/recommendation.constants.js'

import { calculateEffectivePermissions } from '../auth/permissions/constants/permissions.constant.js'

const DEFAULT_PACKAGE_DURATION_MIN = 30

function generatePackageCode(): string {
  return `PKG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
}

@Injectable()
export class SystemCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  private async syncPackageVector(pkg: { id: number }): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({ data: {
        aggregateType: 'ServicePackage', aggregateId: String(pkg.id),
        eventType: 'package.vector.sync', payload: { packageId: pkg.id },
      } });
    } catch {
      if (!this.redis.isEnabled()) return;
      try {
        const current = await this.prisma.servicePackage.findUnique({
          where: { id: pkg.id },
          include: { specialty: { select: { name: true, description: true, symptoms: true } } },
        });
        if (current?.isActive) await this.embeddingService.getOrComputePackageVector(mapPackageForRetrieval(current));
      } catch {
        console.warn(`[SystemCatalogService] Failed to synchronize vector for package ${pkg.id}`);
      }
    }
  }

  private async invalidatePublicCache() {
    if (this.redis.isEnabled()) {
      try {
        await this.redis.deletePattern('cache:public:*');
        await this.redis.deletePattern('rec:cache:search_candidates:*');
        await this.redis.deletePattern('search:cache:candidates:*');
        await this.redis.deletePattern(`${TELEMETRY_CONFIG.CACHE_PREFIX}:*`);
      } catch (err: any) {
        console.warn('[SystemCatalogService] Failed to invalidate public cache:', err?.message);
      }
    }
  }

  async syncAllPackageVectors(userId: string) {
    const user = await this.manager(userId)
    this.assertCatalogOwner(user, 'service-packages')
    this.assertCrudPermission(user, 'service-packages', 'update')
    if (!this.redis.isEnabled()) {
      return { message: 'Redis is disabled', total: 0, synced: 0 }
    }
    const packages = await this.prisma.servicePackage.findMany({
      where: { isActive: true },
      include: { specialty: true },
    })
    for (const pkg of packages) {
      await this.syncPackageVector(pkg)
    }
    return { message: 'Đã đồng bộ vector embedding vào Redis', total: packages.length }
  }

  private async manager(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        customPermissions: true,
        isDeleted: true,
        branchId: true,
      },
    })
    if (!user || user.isDeleted || !['ADMIN', 'CHAIN_MANAGER', 'BRANCH_MANAGER'].includes(user.role))
      throw new ForbiddenException('Chỉ nhân sự quản trị hoặc quản lý được thao tác')
    return user
  }

  private model(resource: string): any {
    const supportedResources = [
      'branches',
      'rooms',
      'specialties',
      'service-packages',
      'booking-methods',
      'branch-specialties',
      'room-specialties',
    ]
    if (!supportedResources.includes(resource)) throw new BadRequestException('Danh mục không hợp lệ')

    const models: Record<string, any> = {
      branches: this.prisma.branch,
      rooms: this.prisma.clinicRoom,
      specialties: this.prisma.specialty,
      'service-packages': this.prisma.servicePackage,
      'booking-methods': this.prisma.branchBookingMethod,
      'branch-specialties': this.prisma.branchSpecialty,
      'room-specialties': this.prisma.clinicRoomSpecialty,
    }
    if (!models[resource]) {
      throw new InternalServerErrorException('Prisma Client chưa được generate theo schema mới. Hãy chạy npx prisma generate và khởi động lại backend.')
    }
    return models[resource]
  }

  private assertCrudPermission(user: { role: string; customPermissions?: unknown }, resource: string, action: 'read' | 'create' | 'update' | 'delete') {
    const prefixes: Record<string, string> = { branches: 'branch', rooms: 'room', specialties: 'specialty', 'service-packages': 'service', 'booking-methods': 'booking_method', 'branch-specialties': 'specialty', 'room-specialties': 'room' }
    const prefix = prefixes[resource]
    if (!prefix) throw new BadRequestException('Danh mục không hợp lệ')
    const permission = prefix + ':' + action
    if (!calculateEffectivePermissions(user.role, user.customPermissions).includes(permission as any)) throw new ForbiddenException('Bạn không có quyền ' + action + ' cho danh mục này')
  }

  private assertCatalogOwner(user: { role: string }, resource: string) {
    if (resource === 'booking-methods') {
      if (user.role !== 'CHAIN_MANAGER') throw new ForbiddenException('Chỉ quản lý toàn chuỗi được cấu hình hình thức đặt khám')
    } else if (user.role === 'ADMIN' || (user.role !== 'CHAIN_MANAGER' && ['specialties', 'service-packages'].includes(resource))) {
      throw new ForbiddenException('Chỉ quản lý toàn chuỗi được thay đổi danh mục dùng chung')
    }
  }

  private async assertAssignmentScope(user: { role: string; branchId: number | null }, resource: string, body: any) {
    if (user.role !== 'BRANCH_MANAGER') return
    const branchId = user.branchId
    if (['branch-specialties', 'rooms'].includes(resource) && branchId !== body.branchId) {
      throw new ForbiddenException('Bạn chỉ có quyền thao tác trên chi nhánh mình phụ trách')
    }
    if (resource === 'room-specialties') {
      const room = await this.prisma.clinicRoom.findFirst({ where: { id: body.roomId, branchId: branchId || 0 }, select: { id: true } })
      if (!room) throw new ForbiddenException('Phòng khám không thuộc chi nhánh bạn phụ trách')
    }
  }

  async list(userId: string, resource: string, q = '') {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        customPermissions: true,
        isDeleted: true,
        branchId: true,
      },
    })
    if (!user || user.isDeleted) throw new ForbiddenException('Không có quyền truy cập')
    this.assertCrudPermission(user, resource, 'read')
    const branchIds = user.branchId ? [user.branchId] : []
    const isBranchManager = user.role === 'BRANCH_MANAGER'
    const term = q.trim()
    const model = this.model(resource)

    if (resource === 'booking-methods') {
      const baseWhere: any = isBranchManager ? { branchId: { in: branchIds } } : {}
      const where = term
        ? { ...baseWhere, bookingMethod: { name: { contains: term, mode: 'insensitive' } } }
        : baseWhere
      const rows = await model.findMany({
        where,
        include: { branch: { select: { id: true, name: true } }, bookingMethod: true },
        orderBy: [{ branch: { name: 'asc' } }, { sortOrder: 'asc' }],
      })
      return { items: rows.map(({ bookingMethod, ...row }: any) => ({ ...row, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, bookingMethodIsActive: bookingMethod.isActive, description: bookingMethod.description })) }
    }
    if (resource === 'branch-specialties') {
      const baseWhere: any = isBranchManager ? { branchId: { in: branchIds } } : {}
      const where = term
        ? { ...baseWhere, OR: [{ branch: { name: { contains: term, mode: 'insensitive' } } }, { specialty: { name: { contains: term, mode: 'insensitive' } } }] }
        : baseWhere
      const rows = await model.findMany({
        where,
        include: { branch: { select: { id: true, name: true } }, specialty: { select: { id: true, name: true } } },
        orderBy: [{ branch: { name: 'asc' } }, { specialty: { name: 'asc' } }],
      })
      return { items: rows }
    }
    if (resource === 'room-specialties') {
      const baseWhere: any = isBranchManager ? { room: { branchId: { in: branchIds } } } : {}
      const where = term
        ? { ...baseWhere, OR: [{ room: { name: { contains: term, mode: 'insensitive' } } }, { specialty: { name: { contains: term, mode: 'insensitive' } } }, { room: { branch: { name: { contains: term, mode: 'insensitive' } } } }] }
        : baseWhere
      const rows = await model.findMany({
        where,
        include: { room: { include: { branch: { select: { id: true, name: true, address: true } } } }, specialty: { select: { id: true, name: true } } },
        orderBy: [{ room: { branch: { name: 'asc' } } }, { room: { code: 'asc' } }, { priority: 'desc' }],
      })
      return { items: rows }
    }
    const where: any = term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(['branches', 'service-packages'].includes(resource) ? [{ code: { contains: term, mode: 'insensitive' } }] : [])] } : {}

    if (isBranchManager) {
      if (resource === 'branches') {
        where.id = { in: branchIds }
      } else if (resource === 'rooms') {
        where.branchId = { in: branchIds }
      }
    }

    const include = resource === 'service-packages'
      ? { receptionSchedules: { where: { isActive: true }, select: { branchId: true, dayOfWeek: true, sessions: true } },
          bookingMethod: PACKAGE_DEPLOYMENT_SELECT.bookingMethod, branches: PACKAGE_DEPLOYMENT_SELECT.branches,
          specialty: { select: { id: true, name: true } } }
      : resource === 'rooms'
      ? { branch: { select: { id: true, name: true, address: true } } }
      : resource === 'specialties'
      ? { branches: { where: { isActive: true }, select: { branchId: true } } }
      : resource === 'branches'
      ? { users: { where: { role: 'BRANCH_MANAGER', isDeleted: false }, select: { id: true, fullName: true, email: true, isBlocked: true, status: true } } }
      : undefined
    const defaultOrderBy: any =
      resource === 'specialties'
        ? { id: 'asc' }
        : resource === 'rooms'
        ? { code: 'asc' }
        : { name: 'asc' }
    const items = await model.findMany({ where, include, orderBy: defaultOrderBy, take: 200 })
    return { items: resource === 'branches' ? items.map(({ users, ...branch }: any) => ({
      ...branch, managers: users,
      managerNames: users.map((manager: any) => manager.fullName || manager.email || 'Chưa có tên').join(', ') || 'Chưa bổ nhiệm',
    })) : items }
  }


  async create(userId: string, resource: string, body: any) {
    const user = await this.manager(userId)
    this.assertCrudPermission(user, resource, 'create')
    this.assertCatalogOwner(user, resource)
    await this.assertAssignmentScope(user, resource, body)
    if (user.role === 'BRANCH_MANAGER' && resource === 'branches') {
      throw new ForbiddenException('Quản lý chi nhánh không có quyền tạo chi nhánh mới')
    }
    if (resource === 'booking-methods') {
      const branchId = Number(body.branchId), code = String(body.code || body.type || '').trim().toUpperCase(), name = String(body.displayName || body.name || '').trim()
      if (!branchId || !code || !name) throw new BadRequestException('Thiếu chi nhánh, mã hoặc tên hình thức đặt khám')
      return this.prisma.$transaction(async (tx) => {
        const description = String(body.description || '').trim()
        if (!description) throw new BadRequestException('Thiếu mô tả hình thức đặt khám')
        const bookingMethod = await tx.bookingMethod.upsert({ where: { code }, update: { name, description, isActive: true }, create: { code, name, description } })
        const exists = await tx.branchBookingMethod.findUnique({ where: { branchId_bookingMethodId: { branchId, bookingMethodId: bookingMethod.id } } })
        if (exists) throw new BadRequestException('Chi nhánh đã có hình thức đặt khám này')
        const row = await tx.branchBookingMethod.create({ data: { branchId, bookingMethodId: bookingMethod.id, isEnabled: body.isEnabled ?? true, sortOrder: Number(body.sortOrder) || 0 }, include: { bookingMethod: true } })
        return { ...row, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description }
      })
    }
    if (resource === 'service-packages') {
      return this.createServicePackages(body)
    }
    if (resource === 'specialties') {
      const data: any = await this.payload(resource, body)
      const specialty = await this.prisma.specialty.create({ data })

      const branchIds: number[] = body.applyAllBranches
        ? (await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id)
        : Array.isArray(body.branchIds) && body.branchIds.length > 0
        ? body.branchIds
        : body.branchId ? [body.branchId] : []

      for (const bId of branchIds) {
        await this.prisma.branchSpecialty.upsert({
          where: { branchId_specialtyId: { branchId: bId, specialtyId: specialty.id } },
          update: { isActive: true },
          create: { branchId: bId, specialtyId: specialty.id, isActive: true },
        })
      }
      void this.invalidatePublicCache()
      return specialty
    }
    const row = await this.model(resource).create({ data: await this.payload(resource, body) })
    void this.invalidatePublicCache()
    return row
  }
  async update(userId: string, resource: string, id: number, body: any) {
    const user = await this.manager(userId)
    this.assertCrudPermission(user, resource, 'update')
    this.assertCatalogOwner(user, resource)
    if (user.role === 'BRANCH_MANAGER' && resource === 'branches') {
      if (user.branchId !== id) {
        throw new ForbiddenException('Bạn chỉ có quyền cập nhật chi nhánh mình phụ trách')
      }
    }
    const model = this.model(resource)
    const key = id
    const existing = await model.findUnique({ where: { id: key } })
    if (!existing) throw new NotFoundException('Không tìm thấy dữ liệu')
    await this.assertAssignmentScope(user, resource, existing)
    await this.assertAssignmentScope(user, resource, { ...existing, ...body })
    if (resource === 'booking-methods') {
      const name = String(body.displayName || body.name || '').trim()
      const isEnabled = body.isEnabled !== undefined ? Boolean(body.isEnabled) : existing.isEnabled
      const isActive = body.isActive !== undefined ? Boolean(body.isActive) : isEnabled
      if (name || body.isActive !== undefined) {
        await this.prisma.bookingMethod.update({
          where: { id: existing.bookingMethodId },
          data: {
            ...(name ? { name } : {}),
            description: body.description || null,
            isActive,
          },
        })
      }
      const updatedRow = await model.update({
        where: { id: key },
        data: { isEnabled, sortOrder: Number(body.sortOrder) || 0 },
      })
      void this.invalidatePublicCache()
      return updatedRow
    }
    if (resource === 'specialties') {
      const specialtyId = Number(id)
      const data: any = await this.payload(resource, body)
      const updated = await this.prisma.specialty.update({ where: { id: specialtyId }, data })

      if (body.branchIds !== undefined || body.applyAllBranches !== undefined) {
        const branchIds: number[] = body.applyAllBranches
          ? (await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id)
          : Array.isArray(body.branchIds) ? body.branchIds : []
        await this.prisma.branchSpecialty.deleteMany({ where: { specialtyId, branchId: { notIn: branchIds } } })
        for (const branchId of branchIds) {
          await this.prisma.branchSpecialty.upsert({
            where: { branchId_specialtyId: { branchId, specialtyId } },
            update: { isActive: true }, create: { branchId, specialtyId, isActive: true },
          })
        }
      }
      const affectedPackages = await this.prisma.servicePackage.findMany({
        where: { specialtyId, isActive: true }, select: { id: true },
      })
      await Promise.all(affectedPackages.map(pkg => this.syncPackageVector(pkg)))
      void this.invalidatePublicCache()
      return updated
    }
    if (resource === 'service-packages') {
      const data: any = await this.payload(resource, body)
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.servicePackage.findUnique({ where: { id }, select: { bookingMethodId: true, branches: { select: { branchId: true } } } })
        if (!existing) throw new NotFoundException('Không tìm thấy gói khám')
        const bookingMethodId = body.bookingMethodId === undefined ? existing.bookingMethodId : Number(body.bookingMethodId)
        if (bookingMethodId !== existing.bookingMethodId) {
          const [appointments, slots] = await Promise.all([
            tx.appointment.count({ where: { servicePackageId: id } }),
            tx.packageReceptionSlot.count({ where: { receptionSchedule: { servicePackageId: id } } }),
          ])
          if (appointments || slots) throw new BadRequestException('Gói đã có lịch hẹn hoặc khung tiếp nhận. Hãy tạo gói mới để đổi hình thức khám.')
        }
        const branchIds = body.branchIds === undefined ? existing.branches.map(link => link.branchId) : body.branchIds
        const methods = await this.packageDeployments(tx, branchIds, bookingMethodId, data.specialtyId)
        const receptionSchedules = parseBranchReceptionSchedules(body.branchReceptionSchedules, branchIds)
        const retained = await tx.packageReceptionTime.findMany({ where: { servicePackageId: id, isActive: true, branchId: { in: branchIds } }, select: { branchId: true, dayOfWeek: true, sessions: true } })
        const replaced = new Set((body.branchReceptionSchedules || []).map((entry: any) => entry.branchId))
        assertReceptionMethods(methods, [...retained.filter(day => !replaced.has(day.branchId)), ...(receptionSchedules || [])])
        await tx.packageReceptionTime.updateMany({ where: { servicePackageId: id, branchId: { notIn: branchIds } }, data: { isActive: false } })
        await tx.packageBranch.deleteMany({ where: { servicePackageId: id, branchId: { notIn: branchIds } } })
        if (branchIds.length) await tx.packageBranch.createMany({ data: branchIds.map((branchId: number) => ({ servicePackageId: id, branchId })), skipDuplicates: true })
        if (receptionSchedules !== undefined) {
          const scheduleBranchIds = body.branchReceptionSchedules.map((entry: any) => entry.branchId)
          await replaceReceptionSchedules(tx, id, scheduleBranchIds, receptionSchedules)
        }
        return tx.servicePackage.update({ where: { id }, data: { ...data, bookingMethodId }, include: {
          bookingMethod: true, branches: { include: { branch: true } }, specialty: true,
        } })

      })
      if (this.redis.isEnabled()) {
        try {
          await this.embeddingService.invalidatePackageVector(id)
        } catch {}
      }
      if (updated.isActive) {
        void this.syncPackageVector(updated)
      }
      void this.invalidatePublicCache()
      return updated
    }
    const row = await model.update({ where: { id: key }, data: await this.payload(resource, body) })
    void this.invalidatePublicCache()
    return row
  }
  async remove(userId: string, resource: string, id: number) {
    const user = await this.manager(userId)
    this.assertCrudPermission(user, resource, 'delete')
    this.assertCatalogOwner(user, resource)
    if (user.role === 'BRANCH_MANAGER' && resource === 'branches') {
      throw new ForbiddenException('Quản lý chi nhánh không có quyền ngừng hoạt động chi nhánh')
    }
    const model = this.model(resource)
    const key = id
    const existing = await model.findUnique({ where: { id: key } })
    if (!existing) throw new NotFoundException('Không tìm thấy dữ liệu')
    await this.assertAssignmentScope(user, resource, existing)
    if (resource === 'service-packages' && this.redis.isEnabled()) {
      try {
        await this.embeddingService.invalidatePackageVector(id)
      } catch {}
    }
    const updated = await model.update({ where: { id: key }, data: resource === 'booking-methods' ? { isEnabled: false } : { isActive: false } })
    void this.invalidatePublicCache()
    return updated
  }

  async batchBranchSpecialties(userId: string, body: { branchId: number; specialtyIds: number[] }) {
    const user = await this.manager(userId)
    this.assertCatalogOwner(user, 'branch-specialties')
    this.assertCrudPermission(user, 'branch-specialties', 'update')
    const { branchId, specialtyIds } = body
    if (!branchId) throw new BadRequestException('Vui lòng chọn cơ sở')
    if (user.role === 'BRANCH_MANAGER') {
      if (user.branchId !== branchId) {
        throw new ForbiddenException('Bạn chỉ có quyền thao tác trên chi nhánh mình phụ trách')
      }
    }
    const ids = Array.isArray(specialtyIds) ? specialtyIds.map(Number).filter((n) => Number.isInteger(n)) : []

    await this.prisma.$transaction(async (tx) => {
      // Deactivate those not in list
      await tx.branchSpecialty.updateMany({
        where: { branchId, specialtyId: { notIn: ids } },
        data: { isActive: false },
      })
      // Upsert selected
      for (const sId of ids) {
        await tx.branchSpecialty.upsert({
          where: { branchId_specialtyId: { branchId, specialtyId: sId } },
          update: { isActive: true },
          create: { branchId, specialtyId: sId, isActive: true },
        })
      }
    })

    await this.invalidatePublicCache()
    return { success: true, branchId, count: ids.length }
  }

  async batchRoomSpecialties(userId: string, body: { specialtyId: number; roomIds: number[] }) {
    const user = await this.manager(userId)
    this.assertCatalogOwner(user, 'room-specialties')
    this.assertCrudPermission(user, 'room-specialties', 'update')
    const specialtyId = Number(body.specialtyId)
    if (!Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn chuyên khoa')
    const roomIds = Array.isArray(body.roomIds) ? body.roomIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []
    const branchIds = user.branchId ? [user.branchId] : []
    if (user.role === 'BRANCH_MANAGER' && roomIds.length > 0) {
      const invalidRooms = await this.prisma.clinicRoom.findFirst({
        where: { id: { in: roomIds }, branchId: { notIn: branchIds } },
      })
      if (invalidRooms) {
        throw new ForbiddenException('Chứa phòng khám không thuộc chi nhánh bạn phụ trách')
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Deactivate unselected rooms for this specialty
      await tx.clinicRoomSpecialty.updateMany({
        where: { specialtyId, roomId: { notIn: roomIds }, ...(user.role === 'BRANCH_MANAGER' ? { room: { branchId: { in: branchIds } } } : {}) },
        data: { isActive: false },
      })
      for (const rId of roomIds) {
        await tx.clinicRoomSpecialty.upsert({
          where: { roomId_specialtyId: { roomId: rId, specialtyId } },
          update: { isActive: true },
          create: { roomId: rId, specialtyId, isActive: true, priority: 1 },
        })
      }
    })

    await this.invalidatePublicCache()
    return { success: true, specialtyId, count: roomIds.length }
  }

  async setBranchPackage(userId: string, id: number, body: { branchId: number; isDeployed: boolean; schedules?: UpdatePackageReceptionDto['schedules'] }) {
    const user = await this.manager(userId)
    if (user.role === 'ADMIN') throw new ForbiddenException('Quản trị kỹ thuật không điều phối gói khám tại chi nhánh')
    this.assertCrudPermission(user, 'service-packages', 'update')
    const branchId = Number(body.branchId)
    if (!Number.isInteger(branchId) || branchId < 1 || typeof body.isDeployed !== 'boolean') throw new BadRequestException('Chi nhánh hoặc trạng thái triển khai không hợp lệ')
    await this.assertAssignmentScope(user, 'branch-specialties', { branchId })
    const days = body.schedules === undefined ? undefined : parseReceptionDays(body.schedules)
    if (!body.isDeployed && days?.length) throw new BadRequestException('Vui lòng triển khai gói trước khi thiết lập lịch tiếp nhận')
    await this.prisma.$transaction(async tx => {
      const pkg = await tx.servicePackage.findUnique({ where: { id }, select: { isActive: true, specialtyId: true, bookingMethodId: true, branches: { select: { branchId: true } } } })
      if (!pkg) throw new NotFoundException('Không tìm thấy gói khám')
      if (body.isDeployed) {
        const alreadyDeployed = pkg.branches.some(link => link.branchId === branchId)
        if ((!alreadyDeployed || days?.length) && !pkg.isActive) throw new BadRequestException('Gói khám đã ngừng hoạt động')
        const methods = await this.packageDeployments(tx, [branchId], pkg.bookingMethodId, pkg.specialtyId)
        const schedules = days !== undefined ? days.map(day => ({ ...day, branchId }))
          : await tx.packageReceptionTime.findMany({ where: { servicePackageId: id, branchId, isActive: true }, select: { branchId: true, dayOfWeek: true, sessions: true } })
        assertReceptionMethods(methods, schedules)
        await tx.packageBranch.upsert({ where: { servicePackageId_branchId: { servicePackageId: id, branchId } }, update: {}, create: { servicePackageId: id, branchId } })
      } else {
        await tx.packageBranch.deleteMany({ where: { servicePackageId: id, branchId } })
      }
      if (!body.isDeployed || days !== undefined) await replaceReceptionSchedules(tx, id, [branchId], body.isDeployed ? (days || []).map(day => ({ ...day, branchId })) : [])
    })
    await this.invalidatePublicCache()
    return { success: true }
  }

  async setReceptionSchedules(userId: string, id: number, body: UpdatePackageReceptionDto) {
    const user = await this.manager(userId)
    if (!['CHAIN_MANAGER', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('Chỉ quản lý được cấu hình lịch tiếp nhận gói khám')
    this.assertCrudPermission(user, 'service-packages', 'update')
    await this.assertAssignmentScope(user, 'branch-specialties', { branchId: body.branchId })
    const days = parseReceptionDays(body.schedules)
    await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.servicePackage.findUnique({ where: { id }, select: { isActive: true, ...PACKAGE_DEPLOYMENT_SELECT } })
      if (!pkg) throw new NotFoundException('Không tìm thấy gói khám')
      if (days.length && !pkg.isActive) throw new BadRequestException('Gói khám đã ngừng hoạt động')
      if (!pkg.branches.some(link => link.branchId === body.branchId)) throw new BadRequestException('Gói khám chưa được áp dụng tại chi nhánh này')
      assertReceptionMethods(getPackageDeployments(pkg), days.map(day => ({ ...day, branchId: body.branchId })))
      await replaceReceptionSchedules(tx, id, [body.branchId], days.map(day => ({ ...day, branchId: body.branchId })))
    })
    await this.invalidatePublicCache()
    return { success: true }
  }

  private async payload(resource: string, b: any) {
    if (!['branch-specialties', 'room-specialties'].includes(resource) && !String(b.name || '').trim()) throw new BadRequestException('Tên không được để trống')
    if (resource === 'branches') {
      const requiredFields = { address: 'Địa chỉ chi tiết', province: 'Tỉnh/Thành phố', ward: 'Phường/Xã', phoneNumber: 'Hotline', openTime: 'Giờ mở cửa', closeTime: 'Giờ đóng cửa' }
      for (const [field, label] of Object.entries(requiredFields)) {
        if (!String(b[field] || '').trim()) throw new BadRequestException(`${label} không được để trống`)
      }
      return {
        name: String(b.name).trim(), slug: String(b.slug || '').trim() || String(b.code || '').trim().toLowerCase() || String(b.name).trim().toLowerCase().replace(/\s+/g, '-'),
        code: String(b.code || '').trim() || `BRC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        address: b.address || null,
        province: b.province || null,
        // District is optional for new addresses; preserve legacy values on partial updates.
        district: b.district === undefined ? undefined : String(b.district || '').trim() || null,
        ward: b.ward || null,
        latitude: b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null,
        longitude: b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null,
        phoneNumber: b.phoneNumber || null,
        email: b.email || null,
        imageUrl: b.imageUrl || '',
        description: b.description || '',
        operatingHours: b.operatingHours || null,
        openTime: b.openTime || null,
        closeTime: b.closeTime || null,
        timezone: b.timezone || 'Asia/Ho_Chi_Minh',
        isActive: b.isActive ?? true,
      }
    }
    if (resource === 'specialties') {
      return {
        name: String(b.name).trim(), slug: String(b.slug || '').trim() || String(b.code || '').trim().toLowerCase() || String(b.name).trim().toLowerCase().replace(/\s+/g, '-'),

        description: b.description || '',
        iconUrl: b.iconUrl || b.imageUrl || '',
        isActive: b.isActive ?? true,
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
      }
    }
    if (resource === 'branch-specialties') {
      const branchId = Number(b.branchId), specialtyId = Number(b.specialtyId)
      if (!branchId || !Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn cơ sở và chuyên khoa')
      return { branchId, specialtyId, isActive: b.isActive ?? true }
    }
    if (resource === 'room-specialties') {
      const roomId = Number(b.roomId), specialtyId = Number(b.specialtyId)
      if (!roomId || !Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn phòng khám và chuyên khoa')
      const room = await this.prisma.clinicRoom.findFirst({ where: { id: roomId, isActive: true }, select: { branchId: true } })
      if (!room) throw new BadRequestException('Phòng khám không tồn tại hoặc đã ngừng hoạt động')
      const branchSpecialty = await this.prisma.branchSpecialty.findFirst({ where: { branchId: room.branchId, specialtyId, isActive: true } })
      if (!branchSpecialty) throw new BadRequestException('Cơ sở của phòng chưa triển khai chuyên khoa này')
      return { roomId, specialtyId, priority: Math.max(0, Number(b.priority) || 0), isActive: b.isActive ?? true }
    }
    if (resource === 'rooms') {
      const branchId = Number(b.branchId)
      if (!branchId) throw new BadRequestException('Vui lòng chọn cơ sở y tế')
      return { branchId, name: String(b.name).trim(), code: String(b.code || '').trim(), isActive: b.isActive ?? true }
    }
    if (resource === 'service-packages') {
      return {
        ...(b.isFeatured !== undefined ? { isFeatured: b.isFeatured === true } : {}),
        name: String(b.name).trim(), slug: String(b.slug || '').trim() || String(b.code || '').trim().toLowerCase() || String(b.name).trim().toLowerCase().replace(/\s+/g, '-'),
        code: String(b.code || '').trim() || generatePackageCode(),
        imageUrl: b.imageUrl || '',
        description: b.description || '',
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
        specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
        price: Number(b.price) || 0,
        durationMin: Number(b.durationMin) || DEFAULT_PACKAGE_DURATION_MIN,
        isActive: b.isActive ?? true,
      }
    }

    throw new BadRequestException('Danh mục không hợp lệ')
  }

  private async packageDeployments(tx: Prisma.TransactionClient, value: unknown, bookingMethodId: number, specialtyId?: number | null) {
    if (!Array.isArray(value) || value.some(id => !Number.isInteger(id) || id < 1)) throw new BadRequestException('Danh sách chi nhánh không hợp lệ')
    const ids = [...new Set<number>(value)]
    const method = await tx.bookingMethod.findUnique({ where: { id: bookingMethodId } })
    if (!method?.isActive || !['SPECIALTY_EXAM', 'AFTER_HOURS', 'HEALTH_PACKAGE'].includes(method.code)) throw new BadRequestException('Vui lòng chọn một hình thức khám hợp lệ cho gói')
    const methods = await tx.branchBookingMethod.findMany({ where: { branchId: { in: ids }, bookingMethodId }, select: {
      id: true, branchId: true, isEnabled: true, branch: { select: { isActive: true } }, bookingMethod: { select: { code: true, isActive: true } },
    } })
    if (methods.length !== ids.length || methods.some(item => !item.isEnabled || !item.branch.isActive)) throw new BadRequestException('Có chi nhánh chưa bật hình thức khám của gói')
    if (specialtyId && ids.length) {
      const count = await tx.branchSpecialty.count({ where: { branchId: { in: ids }, specialtyId, isActive: true } })
      if (count !== ids.length) throw new BadRequestException('Chi nhánh chưa triển khai chuyên khoa của gói khám')
    }
    return methods
  }

  private async createServicePackages(b: any) {
    if (!String(b.name || '').trim()) throw new BadRequestException('Tên gói khám không được để trống')

    const pkg = await this.prisma.$transaction(async (tx) => {
      const bbmList = await this.packageDeployments(tx, b.branchIds, Number(b.bookingMethodId), b.specialtyId ? Number(b.specialtyId) : null)
      if (!bbmList.length) throw new BadRequestException('Vui lòng chọn ít nhất một hình thức khám tại chi nhánh')
      const receptionSchedules = parseBranchReceptionSchedules(b.branchReceptionSchedules, [...new Set(bbmList.map((method) => method.branchId))])
      assertReceptionMethods(bbmList, receptionSchedules || [])

      let pkgCode = String(b.code || '').trim() || generatePackageCode()
      let exists = await tx.servicePackage.findUnique({ where: { code: pkgCode } })
      let attempt = 1
      while (exists && attempt <= 5) {
        pkgCode = generatePackageCode()
        exists = await tx.servicePackage.findUnique({ where: { code: pkgCode } })
        attempt++
      }

      // TẠO ĐÚNG 1 BẢN GHI ServicePackage DUY NHẤT và liên kết các cơ sở/hình thức
      return tx.servicePackage.create({
        data: {
          name: String(b.name).trim(), slug: String(b.slug || '').trim() || String(b.code || '').trim().toLowerCase() || String(b.name).trim().toLowerCase().replace(/\s+/g, '-'),
          code: pkgCode,
          imageUrl: b.imageUrl || '',
          description: b.description || '',
          symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
          bookingMethodId: Number(b.bookingMethodId),
          ...(receptionSchedules?.length ? { receptionSchedules: { create: receptionSchedules } } : {}),
          specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
          price: Number(b.price) || 0,
          durationMin: Number(b.durationMin) || DEFAULT_PACKAGE_DURATION_MIN,
          isFeatured: b.isFeatured === true,
          isActive: b.isActive ?? true,
          branches: { create: bbmList.map(bbm => ({ branchId: bbm.branchId })) },
        },
        include: {
          bookingMethod: true, branches: { include: { branch: true } },
          specialty: true,
        },
    })
    })

    // Tự động sinh ngay vector embedding và lưu vào Redis
    void this.syncPackageVector(pkg)
    void this.invalidatePublicCache()

    return pkg
  }
}
