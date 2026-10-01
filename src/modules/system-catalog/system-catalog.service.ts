import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import { RedisService } from '../../infrastructure/redis/redis.service.js'
import { EmbeddingService } from '../../infrastructure/embedding/embedding.service.js'

@Injectable()
export class SystemCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  private async syncPackageVector(pkg: any): Promise<void> {
    try {
      // 1. Tạo sự kiện Transactional Outbox để RabbitMQ xử lý nền
      await this.prisma.outboxEvent.create({
        data: {
          aggregateType: 'ServicePackage',
          aggregateId: pkg.id,
          eventType: 'package.vector.sync',
          payload: {
            packageId: pkg.id,
            code: pkg.code,
            name: pkg.name,
            description: pkg.description || '',
            symptoms: (pkg as any).symptoms || [],
            price: Number(pkg.price) || 0,
            durationMin: pkg.durationMin || 30,
            specialtyId: pkg.specialtyId,
            specialtyName: pkg.specialty?.name || 'Đa khoa',
          },
        },
      })
    } catch {
      // 2. Fallback trực tiếp nếu Outbox gặp trục trặc
      if (this.redis.isEnabled()) {
        try {
          await this.embeddingService.getOrComputePackageVector({
            id: pkg.id,
            code: pkg.code,
            name: pkg.name,
            description: pkg.description || '',
            symptoms: (pkg as any).symptoms || [],
            price: Number(pkg.price) || 0,
            durationMin: pkg.durationMin || 30,
            specialtyId: pkg.specialtyId,
            specialtyName: pkg.specialty?.name || 'Đa khoa',
          })
        } catch (err: any) {
          console.warn(`[SystemCatalogService] Failed to auto-generate vector for package ${pkg.id}:`, err?.message)
        }
      }
    }
  }

  async syncAllPackageVectors(userId: string) {
    await this.manager(userId)
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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!user || !['ADMIN', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('Chỉ quản trị viên hoặc quản lý chi nhánh được thao tác')
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

  async list(userId: string, resource: string, q = '') {
    await this.manager(userId)
    const term = q.trim()
    const model = this.model(resource)
    if (resource === 'booking-methods') {
      const rows = await model.findMany({ where: term ? { bookingMethod: { name: { contains: term, mode: 'insensitive' } } } : {}, include: { branch: { select: { id: true, name: true } }, bookingMethod: true }, orderBy: [{ branch: { name: 'asc' } }, { sortOrder: 'asc' }] })
      return { items: rows.map(({ bookingMethod, ...row }: any) => ({ ...row, bookingMethodId: bookingMethod.id, type: bookingMethod.code, code: bookingMethod.code, displayName: bookingMethod.name, description: bookingMethod.description, route: bookingMethod.route })) }
    }
    if (resource === 'branch-specialties') {
      const rows = await model.findMany({
        where: term ? { OR: [{ branch: { name: { contains: term, mode: 'insensitive' } } }, { specialty: { name: { contains: term, mode: 'insensitive' } } }] } : {},
        include: { branch: { select: { id: true, name: true } }, specialty: { select: { id: true, name: true } } },
        orderBy: [{ branch: { name: 'asc' } }, { specialty: { name: 'asc' } }],
      })
      return { items: rows }
    }
    if (resource === 'room-specialties') {
      const rows = await model.findMany({
        where: term ? { OR: [{ room: { name: { contains: term, mode: 'insensitive' } } }, { specialty: { name: { contains: term, mode: 'insensitive' } } }, { room: { branch: { name: { contains: term, mode: 'insensitive' } } } }] } : {},
        include: { room: { include: { branch: { select: { id: true, name: true, address: true } } } }, specialty: { select: { id: true, name: true } } },
        orderBy: [{ room: { branch: { name: 'asc' } } }, { room: { code: 'asc' } }, { priority: 'desc' }],
      })
      return { items: rows }
    }
    const where: any = term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(['branches','medicines','service-packages'].includes(resource) ? [{ code: { contains: term, mode: 'insensitive' } }] : [])] } : {}
    const include = resource === 'service-packages'
      ? {
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
    await this.manager(userId)
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
      const data = await this.payload(resource, body, true)
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
      return specialty
    }
    const row = await this.model(resource).create({ data: await this.payload(resource, body, true) })
    return row
  }
  async update(userId: string, resource: string, id: string, body: any) {
    await this.manager(userId); const model = this.model(resource); const key = resource === 'specialties' ? Number(id) : id
    const existing = await model.findUnique({ where: { id: key } })
    if (!existing) throw new NotFoundException('Không tìm thấy dữ liệu')
    if (resource === 'booking-methods') {
      const name = String(body.displayName || body.name || '').trim()
      if (name) await this.prisma.bookingMethod.update({ where: { id: existing.bookingMethodId }, data: { name, description: body.description || null, route: body.route || null, isActive: true } })
      return model.update({ where: { id: key }, data: { isEnabled: body.isEnabled ?? existing.isEnabled, sortOrder: Number(body.sortOrder) || 0 } })
    }
    if (resource === 'specialties') {
      const specialtyId = Number(id)
      const data: any = await this.payload(resource, body, false)
      const updated = await this.prisma.specialty.update({ where: { id: specialtyId }, data })

      if (body.branchIds !== undefined || body.applyAllBranches !== undefined) {
        const branchIds: string[] = body.applyAllBranches
          ? (await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id)
          : Array.isArray(body.branchIds)
          ? body.branchIds
          : []

        await this.prisma.branchSpecialty.deleteMany({
          where: { specialtyId, branchId: { notIn: branchIds } },
        })
        for (const bId of branchIds) {
          await this.prisma.branchSpecialty.upsert({
            where: { branchId_specialtyId: { branchId: bId, specialtyId } },
            update: { isActive: true },
            create: { branchId: bId, specialtyId, isActive: true },
          })
        }
      }
      return updated
    }
    if (resource === 'service-packages') {
      const data: any = await this.payload(resource, body, false)

      const branchIds: string[] = body.applyAllBranches
        ? (await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })).map((b) => b.id)
        : Array.isArray(body.branchIds) && body.branchIds.length > 0
        ? body.branchIds
        : body.branchId ? [body.branchId] : []

      const methodCodes: string[] = Array.isArray(body.bookingMethodCodes) && body.bookingMethodCodes.length > 0
        ? body.bookingMethodCodes.map((c: string) => String(c).trim().toUpperCase())
        : body.branchBookingMethodId
        ? [(await this.prisma.branchBookingMethod.findUnique({ where: { id: body.branchBookingMethodId }, include: { bookingMethod: true } }))?.bookingMethod.code].filter(Boolean) as string[]
        : []

      if (branchIds.length > 0 && methodCodes.length > 0) {
        const bbmIds: string[] = []
        for (const branchId of branchIds) {
          for (const methodCode of methodCodes) {
            let bbm = await this.prisma.branchBookingMethod.findFirst({
              where: { branchId, isEnabled: true, bookingMethod: { code: methodCode, isActive: true } },
            })
            if (!bbm) {
              const bm = await this.prisma.bookingMethod.findFirst({ where: { code: methodCode, isActive: true } })
              if (bm) {
                bbm = await this.prisma.branchBookingMethod.upsert({
                  where: { branchId_bookingMethodId: { branchId, bookingMethodId: bm.id } },
                  update: { isEnabled: true },
                  create: { branchId, bookingMethodId: bm.id, isEnabled: true },
                })
              }
            }
            if (bbm) bbmIds.push(bbm.id)
          }
        }
        await this.prisma.servicePackageBranchBookingMethod.deleteMany({
          where: { servicePackageId: id, branchBookingMethodId: { notIn: bbmIds } },
        })
        for (const bbmId of bbmIds) {
          await this.prisma.servicePackageBranchBookingMethod.upsert({
            where: { servicePackageId_branchBookingMethodId: { servicePackageId: id, branchBookingMethodId: bbmId } },
            update: {},
            create: { servicePackageId: id, branchBookingMethodId: bbmId },
          })
        }
        if (bbmIds.length > 0) {
          data.branchBookingMethodId = bbmIds[0]
        }
      }

      const updated = await this.prisma.servicePackage.update({
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
      await this.ensureBranchSpecialty(body)
      if (this.redis.isEnabled()) {
        try {
          await this.embeddingService.invalidatePackageVector(id)
        } catch {}
      }
      void this.syncPackageVector(updated)
      return updated
    }
    const row = await model.update({ where: { id: key }, data: await this.payload(resource, body, false) })
    return row
  }
  async remove(userId: string, resource: string, id: string) {
    await this.manager(userId); const model = this.model(resource); const key = resource === 'specialties' ? Number(id) : id
    if (!await model.findUnique({ where: { id: key } })) throw new NotFoundException('Không tìm thấy dữ liệu')
    if (resource === 'specialties') return model.delete({ where: { id: key } })
    if (resource === 'service-packages' && this.redis.isEnabled()) {
      try {
        await this.embeddingService.invalidatePackageVector(id)
      } catch {}
    }
    return model.update({ where: { id: key }, data: resource === 'booking-methods' ? { isEnabled: false } : { isActive: false } })
  }

  async batchBranchSpecialties(userId: string, body: { branchId: string; specialtyIds: number[] }) {
    await this.manager(userId)
    const { branchId, specialtyIds } = body
    if (!branchId) throw new BadRequestException('Vui lòng chọn cơ sở')
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

    return { success: true, branchId, count: ids.length }
  }

  async batchRoomSpecialties(userId: string, body: { specialtyId: number; roomIds: string[] }) {
    await this.manager(userId)
    const specialtyId = Number(body.specialtyId)
    if (!Number.isInteger(specialtyId)) throw new BadRequestException('Vui lòng chọn chuyên khoa')
    const roomIds = Array.isArray(body.roomIds) ? body.roomIds.map(String).filter(Boolean) : []

    await this.prisma.$transaction(async (tx) => {
      // Deactivate unselected rooms for this specialty
      await tx.clinicRoomSpecialty.updateMany({
        where: { specialtyId, roomId: { notIn: roomIds } },
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

    return { success: true, specialtyId, count: roomIds.length }
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
      const generatedPkgCode = String(b.code || '').trim() || `PKG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      const data: any = {
        name: String(b.name).trim(),
        code: generatedPkgCode,
        imageUrl: b.imageUrl || null,
        description: b.description || null,
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
        specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
        price: Number(b.price) || 0,
        durationMin: Number(b.durationMin) || 30,
        sessionType: b.sessionType || 'ALL_DAY',
        activeDaysOfWeek: Array.isArray(b.activeDaysOfWeek) && b.activeDaysOfWeek.length > 0
          ? b.activeDaysOfWeek.map(Number)
          : [1, 2, 3, 4, 5, 6, 0],
        isActive: b.isActive ?? true,
      }
      if (b.branchBookingMethodId || b.branchId) {
        try {
          data.branchBookingMethodId = await this.resolveBranchMethod(b, 'HEALTH_PACKAGE')
        } catch {}
      }
      return data
    }

    return { name: String(b.name).trim(), code: String(b.code || '').trim(), activeIngredient: b.activeIngredient || null, strength: b.strength || null, unit: b.unit || null, unitPrice: Number(b.unitPrice) || 0, stockQuantity: Number(b.stockQuantity) || 0, isActive: b.isActive ?? true }
  }

  private async ensureBranchSpecialty(body: any) {
    const branchId = String(body.branchId || ''), specialtyId = Number(body.specialtyId)
    if (!branchId || !Number.isInteger(specialtyId)) return
    await this.prisma.branchSpecialty.upsert({
      where: { branchId_specialtyId: { branchId, specialtyId } },
      update: { isActive: true },
      create: { branchId, specialtyId, isActive: true },
    })
  }

  private async resolveBranchMethod(body: any, fallbackCode: string) {
    if (body.branchBookingMethodId) return String(body.branchBookingMethodId)
    const branchId = String(body.branchId || '')
    const code = String(body.bookingMethodCode || fallbackCode).toUpperCase()
    const row = await this.prisma.branchBookingMethod.findFirst({ where: { branchId, isEnabled: true, bookingMethod: { code, isActive: true } } })
    if (!row) throw new BadRequestException(`Chi nhánh chưa bật hình thức đặt khám ${code}`)
    return row.id
  }

  private async createServicePackages(b: any) {
    if (!String(b.name || '').trim()) throw new BadRequestException('Tên gói khám không được để trống')

    // 1. Xác định danh sách cơ sở áp dụng
    let branches: { id: string; code: string; name: string }[] = []
    if (b.applyAllBranches || (Array.isArray(b.branchIds) && b.branchIds.includes('ALL')) || (!b.branchIds?.length && !b.branchId)) {
      branches = await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } })
    } else if (Array.isArray(b.branchIds) && b.branchIds.length > 0) {
      branches = await this.prisma.branch.findMany({ where: { id: { in: b.branchIds }, isActive: true }, select: { id: true, code: true, name: true } })
    } else if (b.branchId) {
      branches = await this.prisma.branch.findMany({ where: { id: b.branchId, isActive: true }, select: { id: true, code: true, name: true } })
    }

    if (branches.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một cơ sở y tế')
    }

    // 2. Xác định danh sách hình thức đặt khám áp dụng
    let methodCodes: string[] = []
    if (Array.isArray(b.bookingMethodCodes) && b.bookingMethodCodes.length > 0) {
      methodCodes = b.bookingMethodCodes.map((c: string) => String(c).trim().toUpperCase())
    } else if (Array.isArray(b.branchBookingMethodIds) && b.branchBookingMethodIds.length > 0) {
      const rows = await this.prisma.branchBookingMethod.findMany({
        where: { id: { in: b.branchBookingMethodIds } },
        include: { bookingMethod: true },
      })
      methodCodes = [...new Set(rows.map((r) => r.bookingMethod.code))]
    } else if (b.branchBookingMethodId) {
      const row = await this.prisma.branchBookingMethod.findUnique({
        where: { id: b.branchBookingMethodId },
        include: { bookingMethod: true },
      })
      if (row) methodCodes = [row.bookingMethod.code]
    } else if (b.bookingMethodCode) {
      methodCodes = [String(b.bookingMethodCode).trim().toUpperCase()]
    }

    if (methodCodes.length === 0) {
      methodCodes = ['HEALTH_PACKAGE', 'SPECIALTY_EXAM']
    }

    const bbmList: any[] = []
    for (const branch of branches) {
      for (const methodCode of methodCodes) {
        let bbm = await this.prisma.branchBookingMethod.findFirst({
          where: { branchId: branch.id, isEnabled: true, bookingMethod: { code: methodCode, isActive: true } },
        })
        if (!bbm) {
          const bm = await this.prisma.bookingMethod.findFirst({ where: { code: methodCode, isActive: true } })
          if (bm) {
            bbm = await this.prisma.branchBookingMethod.upsert({
              where: { branchId_bookingMethodId: { branchId: branch.id, bookingMethodId: bm.id } },
              update: { isEnabled: true },
              create: { branchId: branch.id, bookingMethodId: bm.id, isEnabled: true },
            })
          }
        }
        if (bbm) bbmList.push(bbm)
      }
    }

    if (bbmList.length === 0) {
      throw new BadRequestException('Không thể liên kết gói khám với cơ sở và hình thức đã chọn. Vui lòng kiểm tra lại cấu hình chi nhánh.')
    }

    let pkgCode = String(b.code || '').trim() || `PKG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
    let exists = await this.prisma.servicePackage.findUnique({ where: { code: pkgCode } })
    let attempt = 1
    while (exists && attempt <= 5) {
      pkgCode = `PKG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      exists = await this.prisma.servicePackage.findUnique({ where: { code: pkgCode } })
      attempt++
    }

    // TẠO ĐÚNG 1 BẢN GHI ServicePackage DUY NHẤT và liên kết các cơ sở/hình thức
    const pkg = await this.prisma.servicePackage.create({
      data: {
        name: String(b.name).trim(),
        code: pkgCode,
        description: b.description || null,
        symptoms: Array.isArray(b.symptoms) ? b.symptoms.map(String).map((s: string) => s.trim().toLowerCase()).filter(Boolean) : [],
        branchBookingMethodId: bbmList[0]?.id || null,
        specialtyId: b.specialtyId ? Number(b.specialtyId) : null,
        price: Number(b.price) || 0,
        durationMin: 30,
        sessionType: b.sessionType || 'ALL_DAY',
        activeDaysOfWeek: Array.isArray(b.activeDaysOfWeek) && b.activeDaysOfWeek.length > 0
          ? b.activeDaysOfWeek.map(Number)
          : [1, 2, 3, 4, 5, 6, 0],
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

    for (const branch of branches) {
      if (b.specialtyId) {
        await this.ensureBranchSpecialty({ branchId: branch.id, specialtyId: b.specialtyId })
      }
    }

    // Tự động sinh ngay vector embedding và lưu vào Redis
    void this.syncPackageVector(pkg)

    return pkg
  }
}
