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
      'specialty-services',
      'health-packages',
      'booking-methods',
    ]
    if (!supportedResources.includes(resource)) throw new BadRequestException('Danh mục không hợp lệ')

    const models: Record<string, any> = {
      branches: this.prisma.branch,
      rooms: this.prisma.clinicRoom,
      specialties: this.prisma.specialty,
      services: this.prisma.medicalService,
      medicines: this.prisma.medicine,
      'specialty-services': this.prisma.specialtyService,
      'health-packages': this.prisma.healthPackage,
      'booking-methods': this.prisma.branchBookingMethod,
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
    if (resource === 'booking-methods') return { items: await model.findMany({ where: term ? { displayName: { contains: term, mode: 'insensitive' } } : {}, include: { branch: { select: { id: true, name: true } } }, orderBy: [{ branch: { name: 'asc' } }, { sortOrder: 'asc' }] }) }
    const where: any = term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(['branches','services','medicines','specialty-services','health-packages'].includes(resource) ? [{ code: { contains: term, mode: 'insensitive' } }] : [])] } : {}
    const include = resource === 'specialty-services'
      ? { branch: { select: { id: true, name: true } }, specialty: { select: { id: true, name: true } } }
      : resource === 'health-packages'
        ? { branch: { select: { id: true, name: true } }, items: { include: { medicalService: { select: { id: true, code: true, name: true } } }, orderBy: { sortOrder: 'asc' } }, schedules: { include: { room: { select: { id: true, name: true, branchId: true } } }, orderBy: { examDate: 'asc' } } }
        : undefined
    return { items: await model.findMany({ where, include, orderBy: { name: 'asc' }, take: 200 }) }
  }

  async create(userId: string, resource: string, body: any) { await this.manager(userId); return this.model(resource).create({ data: await this.payload(resource, body, true) }) }
  async update(userId: string, resource: string, id: string, body: any) {
    await this.manager(userId); const model = this.model(resource); const key = resource === 'specialties' ? Number(id) : id
    if (!await model.findUnique({ where: { id: key } })) throw new NotFoundException('Không tìm thấy dữ liệu')
    return model.update({ where: { id: key }, data: await this.payload(resource, body, false) })
  }
  async remove(userId: string, resource: string, id: string) {
    await this.manager(userId); const model = this.model(resource); const key = resource === 'specialties' ? Number(id) : id
    if (!await model.findUnique({ where: { id: key } })) throw new NotFoundException('Không tìm thấy dữ liệu')
    if (resource === 'specialties') return model.delete({ where: { id: key } })
    return model.update({ where: { id: key }, data: resource === 'booking-methods' ? { isEnabled: false } : { isActive: false } })
  }

  private async payload(resource: string, b: any, creating: boolean) {
    if (resource === 'booking-methods') {
      const type = String(b.type || '').toUpperCase()
      if (!['SPECIALTY_EXAM','HEALTH_PACKAGE','CONSULTATION','AFTER_HOURS'].includes(type)) throw new BadRequestException('Hình thức đặt khám không hợp lệ')
      if (!String(b.branchId || '') || !String(b.displayName || '').trim()) throw new BadRequestException('Thiếu chi nhánh hoặc tên hiển thị')
      return { branchId: String(b.branchId), type, displayName: String(b.displayName).trim(), description: b.description || null, isEnabled: b.isEnabled ?? true, sortOrder: Number(b.sortOrder) || 0 }
    }
    if (!String(b.name || '').trim()) throw new BadRequestException('Tên không được để trống')
    if (resource === 'branches') {
      let clinicId = b.clinicId
      if (!clinicId) { const clinic = await this.prisma.clinic.findFirst({ where: { isActive: true } }); if (!clinic) throw new BadRequestException('Chưa có phòng khám để gán chi nhánh'); clinicId = clinic.id }
      return { name: String(b.name).trim(), code: String(b.code || '').trim(), address: b.address || null, phoneNumber: b.phoneNumber || null, timezone: b.timezone || 'Asia/Ho_Chi_Minh', isActive: b.isActive ?? true, ...(creating ? { clinicId } : {}) }
    }
    if (resource === 'specialties') return { name: String(b.name).trim(), description: b.description || null, departmentId: Number(b.departmentId) }
    if (resource === 'services') {
      const category = String(b.category || '').trim().toUpperCase(); if (!['LAB_TEST','IMAGING','PROCEDURE'].includes(category)) throw new BadRequestException('Nhóm dịch vụ không hợp lệ')
      return { name: String(b.name).trim(), code: String(b.code || '').trim(), description: b.description || null, category, departmentId: b.departmentId ? Number(b.departmentId) : null, price: Number(b.price) || 0, durationMin: Number(b.durationMin) || 30, isActive: b.isActive ?? true }
    }
    if (resource === 'specialty-services') return { name: String(b.name).trim(), code: String(b.code || '').trim(), description: b.description || null, branchId: String(b.branchId || ''), specialtyId: Number(b.specialtyId), price: Number(b.price) || 0, durationMin: Number(b.durationMin) || 30, isActive: b.isActive ?? true }
    if (resource === 'health-packages') {
      const serviceIds = Array.isArray(b.medicalServiceIds) ? [...new Set<string>(b.medicalServiceIds.map(String).filter(Boolean))] : []
      if (!String(b.branchId || '') || !serviceIds.length) throw new BadRequestException('Vui lòng chọn chi nhánh và dịch vụ trong gói')
      const room = await this.prisma.clinicRoom.findFirst({ where: { id: String(b.roomId || ''), branchId: String(b.branchId), isActive: true } }); if (!room) throw new BadRequestException('Phòng khám không thuộc chi nhánh đã chọn')
      const examDate = new Date(`${String(b.examDate || '')}T00:00:00.000Z`); if (Number.isNaN(examDate.getTime())) throw new BadRequestException('Ngày khám không hợp lệ')
      return { name: String(b.name).trim(), code: String(b.code || '').trim(), description: b.description || null, branchId: String(b.branchId), price: Number(b.price) || 0, isActive: b.isActive ?? true, items: creating ? { create: serviceIds.map((medicalServiceId, sortOrder) => ({ medicalServiceId, sortOrder })) } : { deleteMany: {}, create: serviceIds.map((medicalServiceId, sortOrder) => ({ medicalServiceId, sortOrder })) }, schedules: creating ? { create: { roomId: room.id, examDate, capacity: Number(b.capacity) || 20 } } : { deleteMany: {}, create: { roomId: room.id, examDate, capacity: Number(b.capacity) || 20 } } }
    }
    return { name: String(b.name).trim(), code: String(b.code || '').trim(), activeIngredient: b.activeIngredient || null, strength: b.strength || null, unit: b.unit || null, unitPrice: Number(b.unitPrice) || 0, stockQuantity: Number(b.stockQuantity) || 0, isActive: b.isActive ?? true }
  }
}
