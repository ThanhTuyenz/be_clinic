import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class SystemCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async manager(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!user || !['ADMIN', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('Chỉ quản trị viên hoặc quản lý chi nhánh được thao tác')
  }

  private model(resource: string): any {
    const supportedResources = [
      'branches',
      'rooms',
      'specialties',
      'services',
      'medicines',
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
      services: this.prisma.medicalService,
      medicines: this.prisma.medicine,
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
        include: { branch: { select: { id: true, name: true } }, specialty: { select: { id: true, name: true, department: { select: { id: true, name: true } } } } },
        orderBy: [{ branch: { name: 'asc' } }, { specialty: { name: 'asc' } }],
      })
      return { items: rows }
    }
    if (resource === 'room-specialties') {
      const rows = await model.findMany({
        where: term ? { OR: [{ room: { name: { contains: term, mode: 'insensitive' } } }, { specialty: { name: { contains: term, mode: 'insensitive' } } }, { room: { branch: { name: { contains: term, mode: 'insensitive' } } } }] } : {},
        include: { room: { include: { branch: { select: { id: true, name: true, address: true } } } }, specialty: { include: { department: { select: { id: true, name: true } } } } },
        orderBy: [{ room: { branch: { name: 'asc' } } }, { room: { code: 'asc' } }, { priority: 'desc' }],
      })
      return { items: rows }
    }
    const where: any = term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(['branches','services','medicines','service-packages'].includes(resource) ? [{ code: { contains: term, mode: 'insensitive' } }] : [])] } : {}
    const include = resource === 'service-packages'
      ? { branchBookingMethod: { include: { branch: { select: { id: true, name: true } }, bookingMethod: { select: { id: true, code: true, name: true } } } }, specialty: { select: { id: true, name: true } }, items: { include: { medicalService: { select: { id: true, code: true, name: true } } }, orderBy: { sortOrder: 'asc' } }, schedules: { include: { room: { select: { id: true, name: true, branchId: true } }, slots: { orderBy: { startTime: 'asc' } } }, orderBy: { examDate: 'asc' } } }
      : resource === 'rooms' ? { branch: { select: { id: true, name: true, address: true } }, specialties: { where: { isActive: true }, include: { specialty: { select: { id: true, name: true } } }, orderBy: { priority: 'desc' } } } : undefined
    return { items: await model.findMany({ where, include, orderBy: { name: 'asc' }, take: 200 }) }
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
    const row = await this.model(resource).create({ data: await this.payload(resource, body, true) })
    if (resource === 'service-packages') await this.ensureBranchSpecialty(body)
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
    if (resource === 'service-packages') {
      const data: any = await this.payload(resource, body, false)
      const schedules = data.schedules?.create || []
      delete data.schedules
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.servicePackage.update({ where: { id }, data })
        const activeDates: Date[] = []
        for (const scheduleInput of schedules) {
          const { slots, ...scheduleData } = scheduleInput
          activeDates.push(scheduleData.examDate)
          const schedule = await tx.servicePackageSchedule.upsert({ where: { servicePackageId_examDate: { servicePackageId: id, examDate: scheduleData.examDate } }, update: { roomId: scheduleData.roomId, isActive: true }, create: { servicePackageId: id, ...scheduleData } })
          const activeStarts: Date[] = []
          for (const slot of slots.create) {
            activeStarts.push(slot.startTime)
            await tx.servicePackageScheduleSlot.upsert({ where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } }, update: { endTime: slot.endTime, capacity: slot.capacity, isActive: true }, create: { scheduleId: schedule.id, ...slot } })
          }
          await tx.servicePackageScheduleSlot.updateMany({ where: { scheduleId: schedule.id, startTime: { notIn: activeStarts } }, data: { isActive: false } })
        }
        await tx.servicePackageSchedule.updateMany({ where: { servicePackageId: id, examDate: { notIn: activeDates } }, data: { isActive: false } })
        return updated
      })
      await this.ensureBranchSpecialty(body)
      return row
    }
    const row = await model.update({ where: { id: key }, data: await this.payload(resource, body, false) })
    if (resource === 'service-packages') await this.ensureBranchSpecialty(body)
    return row
  }
  async remove(userId: string, resource: string, id: string) {
    await this.manager(userId); const model = this.model(resource); const key = resource === 'specialties' ? Number(id) : id
    if (!await model.findUnique({ where: { id: key } })) throw new NotFoundException('Không tìm thấy dữ liệu')
    if (resource === 'specialties') return model.delete({ where: { id: key } })
    return model.update({ where: { id: key }, data: resource === 'booking-methods' ? { isEnabled: false } : { isActive: false } })
  }

  private async payload(resource: string, b: any, creating: boolean) {
    if (!['branch-specialties', 'room-specialties'].includes(resource) && !String(b.name || '').trim()) throw new BadRequestException('Tên không được để trống')
    if (resource === 'branches') {
      let clinicId = b.clinicId
      if (!clinicId) { const clinic = await this.prisma.clinic.findFirst({ where: { isActive: true } }); if (!clinic) throw new BadRequestException('Chưa có phòng khám để gán chi nhánh'); clinicId = clinic.id }
      return { name: String(b.name).trim(), code: String(b.code || '').trim(), address: b.address || null, phoneNumber: b.phoneNumber || null, timezone: b.timezone || 'Asia/Ho_Chi_Minh', isActive: b.isActive ?? true, ...(creating ? { clinicId } : {}) }
    }
    if (resource === 'specialties') return { name: String(b.name).trim(), description: b.description || null, departmentId: Number(b.departmentId) }
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
    if (resource === 'services') {
      const category = String(b.category || '').trim().toUpperCase(); if (!['LAB_TEST','IMAGING','PROCEDURE'].includes(category)) throw new BadRequestException('Nhóm dịch vụ không hợp lệ')
      return { name: String(b.name).trim(), code: String(b.code || '').trim(), description: b.description || null, category, departmentId: b.departmentId ? Number(b.departmentId) : null, price: Number(b.price) || 0, durationMin: Number(b.durationMin) || 30, isActive: b.isActive ?? true }
    }
    if (resource === 'service-packages') {
      const serviceIds = Array.isArray(b.medicalServiceIds) ? [...new Set<string>(b.medicalServiceIds.map(String).filter(Boolean))] : []
      if (!String(b.branchId || '')) throw new BadRequestException('Vui lòng chọn chi nhánh')
      const branchBookingMethodId = await this.resolveBranchMethod(b, 'SPECIALTY_EXAM')
      const inputSchedules = Array.isArray(b.schedules) ? b.schedules : []
      if (!inputSchedules.length) throw new BadRequestException('Vui lòng cấu hình ít nhất một ngày hoạt động')
      if (inputSchedules.some((item: any) => !String(item.roomId || ''))) throw new BadRequestException('Mỗi ngày hoạt động phải có phòng khám dự kiến')
      const roomIds = [...new Set<string>(inputSchedules.map((item: any) => String(item.roomId || '')).filter(Boolean))]
      const validRoomCount = await this.prisma.clinicRoom.count({ where: { id: { in: roomIds }, branchId: String(b.branchId), isActive: true } })
      if (validRoomCount !== roomIds.length) throw new BadRequestException('Có phòng khám không thuộc chi nhánh đã chọn')
      if (b.specialtyId && roomIds.length) {
        const compatibleRoomCount = await this.prisma.clinicRoomSpecialty.count({ where: { roomId: { in: roomIds }, specialtyId: Number(b.specialtyId), isActive: true } })
        if (compatibleRoomCount !== roomIds.length) throw new BadRequestException('Có phòng khám chưa được gán cho chuyên khoa của gói')
      }
      const schedules = inputSchedules.map((item: any) => {
        const examDate = new Date(`${String(item.examDate || '')}T00:00:00.000Z`)
        if (Number.isNaN(examDate.getTime())) throw new BadRequestException('Ngày khám không hợp lệ')
        const inputSlots = Array.isArray(item.slots) ? item.slots : []
        if (!inputSlots.length) throw new BadRequestException('Mỗi ngày hoạt động phải có ít nhất một khung giờ')
        const slots = inputSlots.map((slot: any) => {
          const startTime = new Date(`1970-01-01T${String(slot.startTime || '')}:00.000Z`)
          const endTime = new Date(`1970-01-01T${String(slot.endTime || '')}:00.000Z`)
          if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) throw new BadRequestException('Khung giờ khám không hợp lệ')
          return { startTime, endTime, capacity: Math.max(1, Number(slot.capacity) || 20) }
        })
        return { roomId: item.roomId ? String(item.roomId) : null, examDate, slots: { create: slots } }
      })
      const generatedPkgCode = String(b.code || '').trim() || `PKG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      return { name: String(b.name).trim(), code: generatedPkgCode, description: b.description || null, branchBookingMethodId, specialtyId: b.specialtyId ? Number(b.specialtyId) : null, price: Number(b.price) || 0, durationMin: Number(b.durationMin) || 30, isActive: b.isActive ?? true, items: creating ? { create: serviceIds.map((medicalServiceId, sortOrder) => ({ medicalServiceId, sortOrder })) } : { deleteMany: {}, create: serviceIds.map((medicalServiceId, sortOrder) => ({ medicalServiceId, sortOrder })) }, schedules: creating ? { create: schedules } : { deleteMany: {}, create: schedules } }
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
}
