import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class PharmacyService {
  constructor(private readonly prisma: PrismaService) {}

  private async staff(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchAssignments: { select: { branchId: true } } } })
    if (!user || !['PHARMACIST', 'ADMIN', 'BRANCH_MANAGER'].includes(user.role)) throw new ForbiddenException('Không có quyền truy cập nhà thuốc')
    return { role: user.role, branchIds: user.branchAssignments.map((row) => row.branchId) }
  }

  private view(row: any) { return { id: row.id, status: row.status, issuedAt: row.issuedAt, updatedAt: row.updatedAt, branch: row.medicalVisit.branch, patient: row.medicalVisit.medicalRecord.patientProfile, recordCode: row.medicalVisit.medicalRecord.recordCode, doctor: row.medicalVisit.doctor, diagnosis: row.medicalVisit.diagnoses.map((d: any) => ({ code: d.icd10Code.code, name: d.icd10Code.description, isPrimary: d.isPrimary })), items: row.items.map((i: any) => ({ id: i.id.toString(), medicineId: i.medicineId, medicineName: i.medicineName, strength: i.strength, unit: i.unit, quantity: Number(i.quantity), dosageAmount: i.dosageAmount, frequencyPerDay: i.frequencyPerDay, durationDays: i.durationDays, instructions: i.instructions, stock: Number(i.medicine.stocks.find((stock: any) => stock.branchId === row.medicalVisit.branchId)?.quantity || 0), unitPrice: Number(i.medicine.unitPrice) })) } }

  async list(userId: string, status = 'ISSUED', q = '') {
    const staff = await this.staff(userId); const normalized = String(status || 'ISSUED').toUpperCase()
    if (!['ISSUED', 'DISPENSED'].includes(normalized)) throw new BadRequestException('Trạng thái đơn thuốc không hợp lệ')
    const term = String(q || '').trim()
    const rows = await this.prisma.prescription.findMany({ where: { status: normalized as any, medicalVisit: { ...(staff.role === 'ADMIN' ? {} : { branchId: { in: staff.branchIds } }), ...(term ? { medicalRecord: { patientProfile: { fullName: { contains: term, mode: 'insensitive' } } } } : {}) } }, include: { items: { include: { medicine: { include: { stocks: true } } }, orderBy: { id: 'asc' } }, medicalVisit: { include: { branch: true, doctor: true, medicalRecord: { include: { patientProfile: true } }, diagnoses: { include: { icd10Code: true } } } } }, orderBy: { issuedAt: 'asc' }, take: 200 })
    return { items: rows.map((row) => this.view(row)) }
  }

  async dispense(userId: string, prescriptionId: string) {
    const staff = await this.staff(userId)
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.prescription.findUnique({ where: { id: prescriptionId }, include: { items: true, medicalVisit: true } })
      if (!row) throw new NotFoundException('Không tìm thấy đơn thuốc')
      if (row.status !== 'ISSUED') throw new BadRequestException('Đơn thuốc không còn ở trạng thái chờ cấp')
      if (staff.role !== 'ADMIN' && !staff.branchIds.includes(row.medicalVisit.branchId)) throw new ForbiddenException('Đơn thuốc không thuộc chi nhánh của bạn')
      for (const item of row.items) {
        const quantity = Number(item.quantity)
        const changed = await tx.inventoryStock.updateMany({ where: { branchId: row.medicalVisit.branchId, medicineId: item.medicineId, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } })
        if (changed.count !== 1) throw new BadRequestException(`Tồn kho không đủ cho ${item.medicineName}`)
        await tx.inventoryMovement.create({ data: { branchId: row.medicalVisit.branchId, medicineId: item.medicineId, type: 'DISPENSE', quantity: new Prisma.Decimal(-quantity), referenceId: row.id, note: `Cấp theo đơn ${row.id}`, createdById: userId } })
      }
      await tx.prescription.update({ where: { id: row.id }, data: { status: 'DISPENSED' } })
      return { prescriptionId: row.id, status: 'DISPENSED' }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }
}
