import { assertReceptionMethods, parseReceptionDays, parseBranchReceptionSchedules } from '../bookings/helpers/package-reception.helper.js'
import { UpdatePackageReceptionDto } from './dtos/update-package-reception.dto.js'
import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { RedisService } from '../../infrastructure/redis/redis.service.js'
import { EmbeddingService, mapPackageForRetrieval } from '../../infrastructure/embedding/embedding.service.js'
import { TELEMETRY_CONFIG } from '../recommendations/constants/recommendation.constants.js'

import { calculateEffectivePermissions } from '../../common/constants/permissions.constant.js'

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

  private async syncPackageVector(pkg: { id: string }): Promise<void> {
    try {
      await this.prisma.outboxEvent.create({ data: {
        aggregateType: 'ServicePackage', aggregateId: pkg.id,
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
        branchAssignments: { select: { branchId: true } },
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

  private async assertAssignmentScope(user: { role: string; branchAssignments: { branchId: string }[] }, resource: string, body: any) {
    if (user.role !== 'BRANCH_MANAGER') return
    const branchIds = user.branchAssignments.map((b) => b.branchId)
    if (['branch-specialties', 'rooms'].includes(resource) && !branchIds.includes(body.branchId)) {
      throw new ForbiddenException('Bạn chỉ có quyền thao tác trên chi nhánh mình phụ trách')
    }
    if (resource === 'room-specialties') {
      const room = await this.prisma.clinicRoom.findFirst({ where: { id: body.roomId, branchId: { in: branchIds } }, select: { id: true } })
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
        branchAssignments: { select: { branchId: true } },
      },
    })
    if (!user || user.isDeleted) throw new ForbiddenException('Không có quyền truy cập')
    this.assertCrudPermission(user, resource, 'read')
    const branchIds = user.branchAssignments?.map((b) => b.branchId) || []
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
      return { items: rows.map(({ bookingMethod, ...row }: any) => ({ ...row, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, bookingMethodIsActive: bookingMethod.isActive, description: bookingMethod.description, route: bookingMethod.route })) }
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
      ? {
          receptionSchedules: { select: { branchId: true, dayOfWeek: true, sessions: true } },
          branchBookingMethod: { include: { branch: { select: { id: true, name: true } }, bookingMethod: { select: { id: true, code: true, name: true } } } },
          specialty: { select: { id: true, name: true } },
          branchBookingMethods: {
            include: {
              branchBookingMethod: {
                include: {
                  branch: { select: { id: true, name: true } },
                  bookingMethod: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        }
      : resource === 'rooms'
      ? { branch: { select: { id: true, name: true, address: true } } }
      : resource === 'specialties'
      ? { branches: { where: { isActive: true }, select: { branchId: true } } }
      : undefined
    const defaultOrderBy: any =
      resource === 'specialties'
        ? { id: 'asc' }
        : resource === 'rooms'
        ? { code: 'asc' }
        : { name: 'asc' }
    return { items: await model.findMany({ where, include, orderBy: defaultOrderBy, take: 200 }) }
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
      const branchId = String(body.branchId || ''), code = String(body.code || body.type || '').trim().toUpperCase(), name = String(body.displayName || body.name || '').trim()
      if (!branchId || !code || !name) throw new BadRequestException('Thiếu chi nhánh, mã hoặc tên hình thức đặt khám')
      return this.prisma.$transaction(async (tx) => {
        const bookingMethod = await tx.bookingMethod.upsert({ where: { code }, update: { name, description: body.description || null, route: body.route || null, isActive: true }, create: { code, name, description: body.description || null, route: body.route || null } })
        const exists = await tx.branchBookingMethod.findUnique({ where: { branchId_bookingMethodId: { branchId, bookingMethodId: bookingMethod.id } } })
        if (exists) throw new BadRequestException('Chi nhánh đã có hình thức đặt khám này')
        const row = await tx.branchBookingMethod.create({ data: { branchId, bookingMethodId: bookingMethod.id, isEnabled: body.isEnabled ?? true, sortOrder: Number(body.sortOrder) || 0 }, include: { bookingMethod: true } })
        return { ...row, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description, route: bookingMethod.route }
      })
    }
    if (resource === 'service-packages') {
      return this.createServicePackages(body)
    }
    if (resource === 'specialties') {
      const data: any = await this.payload(resource, body, true)
      const specialty = await this.prisma.specialty.create({ data })

      const branchIds: string[] = body.applyAllBranches
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
    const row = await this.model(resource).create({ data: await this.payload(resource, body, true) })
    void this.invalidatePublicCache()
    return row
  }
  async update(userId: string, resource: string, id: string, body: any) {
    const user = await this.manager(userId)
    this.assertCrudPermission(user, resource, 'update')
    this.assertCatalogOwner(user, resource)
    if (user.role === 'BRANCH_MANAGER' && resource === 'branches') {
      const branchIds = user.branchAssignments?.map((b) => b.branchId) || []
      if (!branchIds.includes(id)) {
        throw new ForbiddenException('Bạn chỉ có quyền cập nhật chi nhánh mình phụ trách')
      }
    }
    const model = this.model(resource)
    const key = resource === 'specialties' ? Number(id) : id
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
            route: body.route || null,
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
      const data: any = await this.payload(resource, body, false)
      const updated = await this.prisma.specialty.update({ where: { id: specialtyId }, data })

      if (body.branchIds !== undefined || body.applyAllBranches !== undefined) {
        const branchIds: string[] = body.applyAllBranches
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
      const data: any = await this.payload(resource, body, false)
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.servicePackage.findUnique({ where: { id }, select: {
          branchBookingMethodId: true, branchBookingMethods: { select: { branchBookingMethodId: true } },
        } })
        if (!existing) throw new NotFoundException('Không tìm thấy gói khám')
        const ids = body.branchBookingMethodIds !== undefined ? body.branchBookingMethodIds : [...new Set([
          ...existing.branchBookingMethods.map((link) => link.branchBookingMethodId),
          ...(existing.branchBookingMethodId ? [existing.branchBookingMethodId] : []),
        ])]
        const methods = await this.packageDeployments(tx, ids, data.specialtyId)
        const branchIds = [...new Set(methods.map((method) => method.branchId))]
        const receptionSchedules = parseBranchReceptionSchedules(body.branchReceptionSchedules, branchIds)
        const retained = await tx.packageReceptionSchedule.findMany({ where: { servicePackageId: id, branchId: { in: branchIds } }, select: { branchId: true, dayOfWeek: true, sessions: true } })
        const replaced = new Set((body.branchReceptionSchedules || []).map((entry: any) => entry.branchId))
        assertReceptionMethods(methods, [...retained.filter((day) => !replaced.has(day.branchId)), ...(receptionSchedules || [])])
        if (body.branchBookingMethodIds !== undefined) {
          await tx.packageReceptionSchedule.deleteMany({ where: { servicePackageId: id, branchId: { notIn: branchIds } } })
          await tx.servicePackageBranchBookingMethod.deleteMany({ where: { servicePackageId: id } })
          if (methods.length) await tx.servicePackageBranchBookingMethod.createMany({ data: methods.map((method) => ({ servicePackageId: id, branchBookingMethodId: method.id })) })
          data.branchBookingMethodId = methods[0]?.id || null
        }

        if (receptionSchedules !== undefined) {
          const scheduleBranchIds = body.branchReceptionSchedules.map((entry: any) => entry.branchId)
          await tx.packageReceptionSchedule.deleteMany({ where: { servicePackageId: id, branchId: { in: scheduleBranchIds } } })
          if (receptionSchedules.length) await tx.packageReceptionSchedule.createMany({
            data: receptionSchedules.map((day) => ({ servicePackageId: id, ...day })),
          })
        }

        return tx.servicePackage.update({
          where: { id },
          data,
          include: {
            branchBookingMethod: {
              include: { branch: true, bookingMethod: true },
            },
            specialty: true,
            branchBookingMethods: {
              include: {
                branchBookingMethod: {
                  include: { branch: true, bookingMethod: true },
                },
              },
            },
          },
        })
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
    const row = await model.update({ where: { id: key }, data: await this.payload(resource, body, false) })
    void this.invalidatePublicCache()
    return row
  }
  async remove(userId: string, resource: string, id: string) {
    const user = await this.manager(userId)
    this.assertCrudPermission(user, resource, 'delete')
    this.assertCatalogOwner(user, resource)
    if (user.role === 'BRANCH_MANAGER' && resource === 'branches') {
      throw new ForbiddenException('Quản lý chi nhánh không có quyền ngừng hoạt động chi nhánh')
    }
    const model = this.model(resource)
    const key = resource === 'specialties' ? Number(id) : id
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

  async batchBranchSpecialties(userId: string, body: { branchId: string; specialtyIds: number[] }) {
    const user = await this.manager(userId)
    this.assertCatalogOwner(user, 'branch-specialties')
    this.assertCrudPermission(user, 'branch-specialties', 'update')
    const { branchId, specialtyIds } = body
    if (!branchId) throw new BadRequestException('Vui lòng chọn cơ sở')
    if (user.role === 'BRANCH_MANAGER') {
      const branchIds = user.branchAssignments?.map((b) => b.branchId) || []
      if (!branchIds.includes(branchId)) {
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

  async batchRoomSpecialties(userId: string, body: { specialtyId: number; roomIds: string[] }) {
    const user = await this.manager(userId)
    this.assertCatalogOwner(user, 'room-specialties')
    this.assertCrudPermission(user, 'room-specialties', 'update')
    const specialtyId = Number(body.specialtyId)
    if (!Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn chuyên khoa')
    const roomIds = Array.isArray(body.roomIds) ? body.roomIds.map(String).filter(Boolean) : []
    if (user.role === 'BRANCH_MANAGER' && roomIds.length > 0) {
      const branchIds = user.branchAssignments?.map((b) => b.branchId) || []
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
        where: { specialtyId, roomId: { notIn: roomIds }, ...(user.role === 'BRANCH_MANAGER' ? { room: { branchId: { in: user.branchAssignments.map((b) => b.branchId) } } } : {}) },
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

  async setBranchPackage(userId: string, id: string, body: { branchId: string; branchBookingMethodIds: string[]; schedules?: UpdatePackageReceptionDto['schedules'] }) {
    const user = await this.manager(userId)
    if (user.role === 'ADMIN') throw new ForbiddenException('Quản trị kỹ thuật không điều phối gói khám tại chi nhánh')
    this.assertCrudPermission(user, 'service-packages', 'update')
    const branchId = String(body.branchId || '')
    if (!branchId) throw new BadRequestException('Vui lòng chọn chi nhánh')
    await this.assertAssignmentScope(user, 'branch-specialties', { branchId })
    if (!Array.isArray(body.branchBookingMethodIds)) throw new BadRequestException('Danh sách hình thức đặt khám không hợp lệ')
    const ids = [...new Set(body.branchBookingMethodIds.map(String))]
    const days = body.schedules === undefined ? undefined : parseReceptionDays(body.schedules)
    if (!ids.length && days?.length) throw new BadRequestException('Vui lòng chọn hình thức khám trước khi thiết lập lịch tiếp nhận')
    await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.servicePackage.findUnique({ where: { id }, select: { isActive: true, specialtyId: true, branchBookingMethodId: true } })
      if (!pkg) throw new NotFoundException('Không tìm thấy gói khám')
      const currentLinks = await tx.servicePackageBranchBookingMethod.findMany({ where: { servicePackageId: id, branchBookingMethod: { branchId } }, select: { branchBookingMethodId: true } })
      const currentIds = new Set(currentLinks.map((l) => l.branchBookingMethodId))
      if (pkg.branchBookingMethodId) currentIds.add(pkg.branchBookingMethodId)
      if (!pkg.isActive && ids.some((methodId) => !currentIds.has(methodId))) throw new BadRequestException('Gói khám đã ngừng hoạt động trên hệ thống')
      if (pkg.specialtyId && ids.some((methodId) => !currentIds.has(methodId))) {
        const specialties = await tx.branchSpecialty.findMany({ where: { branchId, specialtyId: pkg.specialtyId, isActive: true }, select: { branchId: true } })
        if (!specialties.length) throw new BadRequestException('Chi nhánh chưa triển khai chuyên khoa của gói khám')
      }
      const methods = await tx.branchBookingMethod.findMany({ where: { id: { in: ids }, branchId }, select: { id: true, branchId: true, isEnabled: true, bookingMethod: { select: { code: true, isActive: true } } } })
      if (methods.length !== ids.length || methods.some((m) => !currentIds.has(m.id) && (!m.isEnabled || !m.bookingMethod.isActive))) throw new BadRequestException('Hình thức đặt khám không hợp lệ hoặc không thuộc chi nhánh')
      if (methods.some((method) => !['SPECIALTY_EXAM', 'AFTER_HOURS', 'HEALTH_PACKAGE'].includes(method.bookingMethod.code))) throw new BadRequestException('Hình thức khám không hỗ trợ gói khám')
      if (days?.length && !pkg.isActive) throw new BadRequestException('Gói khám đã ngừng hoạt động')
      const schedules = days !== undefined ? days.map((day) => ({ ...day, branchId }))
        : await tx.packageReceptionSchedule.findMany({ where: { servicePackageId: id, branchId }, select: { branchId: true, dayOfWeek: true, sessions: true } })
      assertReceptionMethods(methods, schedules)
      // Preserve the legacy deployment before replacing only this branch's links.
      if (pkg.branchBookingMethodId) {
        await tx.servicePackageBranchBookingMethod.upsert({ where: { servicePackageId_branchBookingMethodId: { servicePackageId: id, branchBookingMethodId: pkg.branchBookingMethodId } }, update: {}, create: { servicePackageId: id, branchBookingMethodId: pkg.branchBookingMethodId } })
      }
      await tx.servicePackageBranchBookingMethod.deleteMany({ where: { servicePackageId: id, branchBookingMethod: { branchId } } })
      if (!ids.length || days !== undefined) await tx.packageReceptionSchedule.deleteMany({ where: { servicePackageId: id, branchId } })
      if (days?.length) await tx.packageReceptionSchedule.createMany({ data: days.map((day) => ({ servicePackageId: id, branchId, ...day })) })
      if (ids.length) await tx.servicePackageBranchBookingMethod.createMany({ data: ids.map((branchBookingMethodId) => ({ servicePackageId: id, branchBookingMethodId })) })
      const primary = await tx.servicePackageBranchBookingMethod.findFirst({ where: { servicePackageId: id }, select: { branchBookingMethodId: true }, orderBy: { id: 'asc' } })
      await tx.servicePackage.update({ where: { id }, data: { branchBookingMethodId: primary?.branchBookingMethodId || null } })
    })
    await this.invalidatePublicCache()
    return { success: true }
  }

  async setReceptionSchedules(userId: string, id: string, body: UpdatePackageReceptionDto) {
    const user = await this.manager(userId)
    if (!['CHAIN_MANAGER', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('Chỉ quản lý được cấu hình lịch tiếp nhận gói khám')
    this.assertCrudPermission(user, 'service-packages', 'update')
    await this.assertAssignmentScope(user, 'branch-specialties', { branchId: body.branchId })
    const days = parseReceptionDays(body.schedules)
    await this.prisma.$transaction(async (tx) => {
      const pkg = await tx.servicePackage.findUnique({
        where: { id }, select: {
          isActive: true, branchBookingMethodId: true,
          branchBookingMethod: { select: { branchId: true, bookingMethod: { select: { code: true } } } },
          branchBookingMethods: { select: { branchBookingMethod: { select: { branchId: true, bookingMethod: { select: { code: true } } } } } },
        },
      })
      if (!pkg) throw new NotFoundException('Không tìm thấy gói khám')
      if (days.length && !pkg.isActive) throw new BadRequestException('Gói khám đã ngừng hoạt động')
      const deployed = pkg.branchBookingMethod?.branchId === body.branchId
        || pkg.branchBookingMethods.some((link) => link.branchBookingMethod.branchId === body.branchId)
      if (!deployed) throw new BadRequestException('Gói khám chưa được áp dụng tại chi nhánh này')
      assertReceptionMethods([...(pkg.branchBookingMethod ? [pkg.branchBookingMethod] : []), ...pkg.branchBookingMethods.map((link) => link.branchBookingMethod)], days.map((day) => ({ ...day, branchId: body.branchId })))
      await tx.packageReceptionSchedule.deleteMany({ where: { servicePackageId: id, branchId: body.branchId } })
      if (days.length) await tx.packageReceptionSchedule.createMany({
        data: days.map((day) => ({ servicePackageId: id, branchId: body.branchId, ...day })),
      })
    })
    await this.invalidatePublicCache()
    return { success: true }
  }

  private async payload(resource: string, b: any, creating: boolean) {
    if (!['branch-specialties', 'room-specialties'].includes(resource) && !String(b.name || '').trim()) throw new BadRequestException('Tên không được để trống')
    if (resource === 'branches') {
      let clinicId = b.clinicId
      if (!clinicId) { const clinic = await this.prisma.clinic.findFirst({ where: { isActive: true } }); if (!clinic) throw new BadRequestException('Chưa có phòng khám để gán chi nhánh'); clinicId = clinic.id }
      return {
        name: String(b.name).trim(),
        code: String(b.code || '').trim() || `BRC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        address: b.address || null,
        province: b.province || null,
        district: b.district || null,
        ward: b.ward || null,
        latitude: b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null,
        longitude: b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null,
        phoneNumber: b.phoneNumber || null,
        email: b.email || null,
        imageUrl: b.imageUrl || null,
        description: b.description || null,
        operatingHours: b.operatingHours || null,
        openTime: b.openTime || null,
        closeTime: b.closeTime || null,
        timezone: b.timezone || 'Asia/Ho_Chi_Minh',
        isActive: b.isActive ?? true,
        ...(creating ? { clinicId } : {}),
      }
    }
    if (resource === 'specialties') {
      return {
        name: String(b.name).trim(),
        slug: b.slug ? String(b.slug).trim().toLowerCase() : null,
        description: b.description || null,
        iconUrl: b.iconUrl || b.imageUrl || null,
        isActive: b.isActive ?? true,
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
      }
    }
    if (resource === 'branch-specialties') {
      const branchId = String(b.branchId || ''), specialtyId = Number(b.specialtyId)
      if (!branchId || !Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn cơ sở và chuyên khoa')
      return { branchId, specialtyId, isActive: b.isActive ?? true }
    }
    if (resource === 'room-specialties') {
      const roomId = String(b.roomId || ''), specialtyId = Number(b.specialtyId)
      if (!roomId || !Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn phòng khám và chuyên khoa')
      const room = await this.prisma.clinicRoom.findFirst({ where: { id: roomId, isActive: true }, select: { branchId: true } })
      if (!room) throw new BadRequestException('Phòng khám không tồn tại hoặc đã ngừng hoạt động')
      const branchSpecialty = await this.prisma.branchSpecialty.findFirst({ where: { branchId: room.branchId, specialtyId, isActive: true } })
      if (!branchSpecialty) throw new BadRequestException('Cơ sở của phòng chưa triển khai chuyên khoa này')
      return { roomId, specialtyId, priority: Math.max(0, Number(b.priority) || 0), isActive: b.isActive ?? true }
    }
    if (resource === 'rooms') {
      const branchId = String(b.branchId || '')
      if (!branchId) throw new BadRequestException('Vui lòng chọn cơ sở y tế')
      return { branchId, name: String(b.name).trim(), code: String(b.code || '').trim(), isActive: b.isActive ?? true }
    }
    if (resource === 'service-packages') {
      return {
        ...(b.isFeatured !== undefined ? { isFeatured: b.isFeatured === true } : {}),
        name: String(b.name).trim(),
        code: String(b.code || '').trim() || generatePackageCode(),
        imageUrl: b.imageUrl || null,
        description: b.description || null,
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
        specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
        price: Number(b.price) || 0,
        durationMin: Number(b.durationMin) || DEFAULT_PACKAGE_DURATION_MIN,
        isActive: b.isActive ?? true,
      }
    }

    throw new BadRequestException('Danh mục không hợp lệ')
  }

  private async packageDeployments(tx: Prisma.TransactionClient, value: unknown, specialtyId?: number | null) {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id)) throw new BadRequestException('Vui lòng chọn hình thức khám tại từng chi nhánh')
    const ids = [...new Set<string>(value)]
    const methods = await tx.branchBookingMethod.findMany({ where: { id: { in: ids } }, select: {
      id: true, branchId: true, isEnabled: true, branch: { select: { isActive: true } }, bookingMethod: { select: { code: true, isActive: true } },
    } })
    if (methods.length !== ids.length || methods.some((method) => !method.isEnabled || !method.branch.isActive || !method.bookingMethod.isActive
      || !['SPECIALTY_EXAM', 'AFTER_HOURS', 'HEALTH_PACKAGE'].includes(method.bookingMethod.code))) throw new BadRequestException('Hình thức khám không tồn tại, đã ngừng hoạt động hoặc không hỗ trợ gói khám')
    if (specialtyId && methods.length) {
      const branchIds = [...new Set(methods.map((method) => method.branchId))]
      const specialties = await tx.branchSpecialty.findMany({ where: { branchId: { in: branchIds }, specialtyId, isActive: true }, select: { branchId: true } })
      if (specialties.length !== branchIds.length) throw new BadRequestException('Chi nhánh chưa triển khai chuyên khoa của gói khám. Vui lòng cấu hình chuyên khoa trước.')
    }
    return ids.map((id) => methods.find((method) => method.id === id)!)
  }

  private async createServicePackages(b: any) {
    if (!String(b.name || '').trim()) throw new BadRequestException('Tên gói khám không được để trống')

    const pkg = await this.prisma.$transaction(async (tx) => {
      const bbmList = await this.packageDeployments(tx, b.branchBookingMethodIds, b.specialtyId ? Number(b.specialtyId) : null)
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
          name: String(b.name).trim(),
          code: pkgCode,
          imageUrl: b.imageUrl || null,
          description: b.description || null,
          symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
          branchBookingMethodId: bbmList[0]?.id || null,
          ...(receptionSchedules?.length ? { receptionSchedules: { create: receptionSchedules } } : {}),
          specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
          price: Number(b.price) || 0,
          durationMin: Number(b.durationMin) || DEFAULT_PACKAGE_DURATION_MIN,
          isFeatured: b.isFeatured === true,
          isActive: b.isActive ?? true,
          branchBookingMethods: {
            create: bbmList.map((bbm) => ({
              branchBookingMethodId: bbm.id,
            })),
          },
        },
        include: {
          branchBookingMethod: {
            include: { branch: true, bookingMethod: true },
          },
          branchBookingMethods: {
            include: {
              branchBookingMethod: {
                include: { branch: true, bookingMethod: true },
              },
            },
          },
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
