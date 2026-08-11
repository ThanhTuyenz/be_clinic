import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class MedicalVisitsService {
  constructor(private readonly prisma: PrismaService) {}

  private number(value: unknown) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(String(value).replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }

  private integer(value: unknown) {
    const parsed = this.number(value)
    return parsed === null ? null : Math.trunc(parsed)
  }

  private serialize(row: any) {
    if (!row) return null
    const payload = { ...((row.payload || {}) as Record<string, unknown>) }
    const primaryDiagnosis = row.diagnoses?.find((item: any) => item.isPrimary) || row.diagnoses?.[0]
    if (primaryDiagnosis?.icd10Code) {
      payload.diagnosisCode = primaryDiagnosis.icd10Code.code
      payload.diagnosisName = primaryDiagnosis.icd10Code.description
      payload.diagnosis = `${primaryDiagnosis.icd10Code.code} – ${primaryDiagnosis.icd10Code.description}`
    }
    payload.temperature = row.temperature === null ? '' : Number(row.temperature)
    payload.respiratoryRate = row.respiratoryRate ?? ''
    payload.bp = row.systolicBp && row.diastolicBp ? `${row.systolicBp}/${row.diastolicBp}` : ''
    payload.pulse = row.pulse ?? ''
    payload.heightCm = row.heightCm === null ? '' : Number(row.heightCm)
    payload.weightKg = row.weightKg === null ? '' : Number(row.weightKg)
    payload.spo2 = row.spo2 === null ? '' : Number(row.spo2)
    if (row.prescription) {
      payload.prescriptionLines = row.prescription.items.map((item: any) => ({
        medicineId: item.medicineId,
        medicineCode: item.medicine?.code || '',
        medicineName: item.medicineName,
        medicineDisplayName: item.medicineName,
        unit: item.unit || '',
        dosage: item.dosageAmount,
        frequency: item.frequencyPerDay ? `${item.frequencyPerDay} lần/ngày` : '',
        duration: item.durationDays ? `${item.durationDays} ngày` : '',
        quantity: Number(item.quantity),
        note: item.instructions || '',
      }))
    }
    if (row.clinicalOrders) {
      payload.clinicalOrders = row.clinicalOrders.map((order: any) => ({
        id: order.id,
        serviceId: order.medicalServiceId,
        serviceCode: order.medicalService?.code || '',
        serviceName: order.serviceName,
        price: Number(order.price),
        note: order.note || '',
        status: order.status,
      }))
    }
    return {
      ...payload,
      id: row.id,
      appointmentId: row.appointmentId,
      medicalRecordId: row.medicalRecordId,
      status: row.status,
      updatedAt: row.updatedAt,
    }
  }

  private visitInclude() {
    return {
      diagnoses: { include: { icd10Code: true } },
      prescription: { include: { items: { include: { medicine: true } } } },
      clinicalOrders: { include: { medicalService: true }, orderBy: { orderedAt: 'asc' as const } },
    }
  }

  private async authorize(userId: string, appointmentId: string, write: boolean) {
    if (!appointmentId) throw new BadRequestException('Thiếu appointmentId')
    const [user, appointment] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctor: { select: { id: true } } } }),
      this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, doctorId: true, branchId: true, patientProfileId: true, status: true },
      }),
    ])
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch khám')
    const allowed = user && (
      user.role === 'ADMIN' ||
      (user.role === 'DOCTOR' && user.doctor?.id === appointment.doctorId) ||
      (!write && ['BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role))
    )
    if (!allowed) throw new ForbiddenException('Không có quyền truy cập hồ sơ khám này')
    if (write && appointment.status !== 'IN_EXAMINATION') {
      throw new BadRequestException('Chỉ được ghi hồ sơ sau khi bác sĩ bắt đầu khám')
    }
    return appointment
  }

  private async validateAndNormalizePayload(payload: Record<string, unknown>) {
    const normalized: Record<string, unknown> = { ...payload }
    const diagnosisCode = String(payload.diagnosisCode || '').trim().toUpperCase()
    if (diagnosisCode) {
      const diagnosis = await this.prisma.icd10Code.findFirst({
        where: { code: { equals: diagnosisCode, mode: 'insensitive' }, isActive: true },
        select: { code: true, description: true },
      })
      if (!diagnosis) throw new BadRequestException('Mã chẩn đoán ICD-10 không tồn tại hoặc đã ngừng sử dụng')
      normalized.diagnosisCode = diagnosis.code
      normalized.diagnosisName = diagnosis.description
      normalized.diagnosis = `${diagnosis.code} – ${diagnosis.description}`
    }

    const prescriptionLines = Array.isArray(payload.prescriptionLines) ? payload.prescriptionLines : []
    if (prescriptionLines.length > 30) throw new BadRequestException('Một đơn thuốc không được vượt quá 30 dòng')
    const medicineIds = prescriptionLines
      .map((line) => String((line as Record<string, unknown>)?.medicineId || '').trim())
      .filter(Boolean)
    if (medicineIds.length) {
      const validMedicines = await this.prisma.medicine.findMany({
        where: { id: { in: [...new Set(medicineIds)] }, isActive: true },
        select: { id: true },
      })
      if (validMedicines.length !== new Set(medicineIds).size) {
        throw new BadRequestException('Đơn thuốc chứa thuốc không tồn tại hoặc đã ngừng sử dụng')
      }
    }
    const invalidMedicine = prescriptionLines.some((line) => {
      const item = line as Record<string, unknown>
      return Boolean(String(item.medicineName || item.medicineDisplayName || '').trim()) && !String(item.medicineId || '').trim()
    })
    if (invalidMedicine) throw new BadRequestException('Thuốc kê đơn phải được chọn từ danh mục')

    const clinicalOrders = Array.isArray(payload.clinicalOrders) ? payload.clinicalOrders : []
    if (clinicalOrders.length > 20) throw new BadRequestException('Không được vượt quá 20 chỉ định cận lâm sàng')
    const serviceIds = clinicalOrders
      .map((order) => String((order as Record<string, unknown>)?.serviceId || '').trim())
      .filter(Boolean)
    if (serviceIds.length !== clinicalOrders.length) {
      throw new BadRequestException('Mỗi chỉ định cận lâm sàng phải có serviceId')
    }
    if (serviceIds.length) {
      const services = await this.prisma.medicalService.findMany({
        where: { id: { in: [...new Set(serviceIds)] }, isActive: true },
        select: { id: true, code: true, name: true, price: true },
      })
      if (services.length !== new Set(serviceIds).size) {
        throw new BadRequestException('Chỉ định chứa dịch vụ không tồn tại hoặc đã ngừng sử dụng')
      }
      const serviceMap = new Map(services.map((service) => [service.id, service]))
      normalized.clinicalOrders = clinicalOrders.map((order) => {
        const item = order as Record<string, unknown>
        const service = serviceMap.get(String(item.serviceId))!
        return {
          serviceId: service.id,
          serviceCode: service.code,
          serviceName: service.name,
          price: Number(service.price),
          note: String(item.note || '').trim(),
          priority: String(item.priority || 'NORMAL').trim().toUpperCase(),
        }
      })
    }
    return normalized
  }

  async findByAppointment(userId: string, appointmentId: string) {
    await this.authorize(userId, appointmentId, false)
    const row = await this.prisma.medicalVisit.findUnique({ where: { appointmentId }, include: this.visitInclude() })
    return { medicalVisit: this.serialize(row) }
  }

  async upsert(userId: string, body: Record<string, unknown>) {
    const appointmentId = String(body.appointmentId || '').trim()
    const appointment = await this.authorize(userId, appointmentId, true)
    const { appointmentId: _ignored, ...payload } = body
    const normalized = await this.validateAndNormalizePayload(payload)
    const medicalRecord = await this.prisma.medicalRecord.upsert({
      where: { patientProfileId: appointment.patientProfileId },
      update: {},
      create: {
        patientProfileId: appointment.patientProfileId,
        recordCode: `MR-${appointment.patientProfileId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      },
    })
    const bp = String(normalized.bloodPressure || normalized.bp || '').split('/')
    const vitalData = {
      temperature: this.number(normalized.temperature ?? normalized.temp),
      respiratoryRate: this.integer(normalized.respiratoryRate ?? normalized.breath),
      systolicBp: this.integer(bp[0]),
      diastolicBp: this.integer(bp[1]),
      pulse: this.integer(normalized.pulse),
      heightCm: this.number(normalized.heightCm ?? normalized.height),
      weightKg: this.number(normalized.weightKg ?? normalized.weight),
      spo2: this.number(normalized.spo2),
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const visit = await tx.medicalVisit.upsert({
        where: { appointmentId },
        create: {
          medicalRecordId: medicalRecord.id,
          appointmentId,
          doctorId: appointment.doctorId,
          branchId: appointment.branchId,
          createdById: userId,
          symptoms: String(normalized.symptoms || '').trim() || null,
          clinicalNotes: String(normalized.clinicalNotes || normalized.notes || '').trim() || null,
          treatmentPlan: String(normalized.treatmentPlan || normalized.treatment || '').trim() || null,
          ...vitalData,
          payload: normalized as Prisma.InputJsonValue,
        },
        update: {
          doctorId: appointment.doctorId,
          branchId: appointment.branchId,
          symptoms: String(normalized.symptoms || '').trim() || null,
          clinicalNotes: String(normalized.clinicalNotes || normalized.notes || '').trim() || null,
          treatmentPlan: String(normalized.treatmentPlan || normalized.treatment || '').trim() || null,
          ...vitalData,
          payload: normalized as Prisma.InputJsonValue,
        },
      })

      await tx.visitDiagnosis.deleteMany({ where: { medicalVisitId: visit.id } })
      const diagnosisCode = String(normalized.diagnosisCode || '').trim()
      if (diagnosisCode) {
        const diagnosis = await tx.icd10Code.findFirstOrThrow({
          where: { code: { equals: diagnosisCode, mode: 'insensitive' }, isActive: true },
        })
        await tx.visitDiagnosis.create({
          data: { medicalVisitId: visit.id, icd10CodeId: diagnosis.id, isPrimary: true },
        })
      }

      const prescriptionLines = (Array.isArray(normalized.prescriptionLines) ? normalized.prescriptionLines : []) as Record<string, unknown>[]
      if (prescriptionLines.length) {
        const prescription = await tx.prescription.upsert({
          where: { medicalVisitId: visit.id },
          create: { medicalVisitId: visit.id },
          update: {},
        })
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: prescription.id } })
        const medicines = await tx.medicine.findMany({
          where: { id: { in: prescriptionLines.map((line) => String(line.medicineId)) } },
        })
        const medicineMap = new Map(medicines.map((medicine) => [medicine.id, medicine]))
        for (const line of prescriptionLines) {
          const medicine = medicineMap.get(String(line.medicineId))
          if (!medicine) continue
          const quantity = this.number(line.quantity)
          if (quantity === null || quantity <= 0) throw new BadRequestException(`Số lượng thuốc ${medicine.name} phải lớn hơn 0`)
          const frequency = String(line.frequency || line.frequencyPerDay || '').match(/\d+/)?.[0]
          const duration = String(line.duration || line.durationDays || '').match(/\d+/)?.[0]
          await tx.prescriptionItem.create({
            data: {
              prescriptionId: prescription.id,
              medicineId: medicine.id,
              medicineName: medicine.name,
              strength: medicine.strength,
              unit: String(line.unit || medicine.unit || '').trim() || null,
              quantity,
              dosageAmount: String(line.dosage || line.dosageAmount || '').trim() || 'Theo chỉ định',
              frequencyPerDay: frequency ? Number(frequency) : null,
              durationDays: duration ? Number(duration) : null,
              instructions: String(line.note || line.instructions || '').trim() || null,
            },
          })
        }
      } else {
        await tx.prescription.deleteMany({ where: { medicalVisitId: visit.id } })
      }

      await tx.clinicalOrder.deleteMany({ where: { medicalVisitId: visit.id } })
      const clinicalOrders = (Array.isArray(normalized.clinicalOrders) ? normalized.clinicalOrders : []) as Record<string, unknown>[]
      if (clinicalOrders.length) {
        const services = await tx.medicalService.findMany({
          where: { id: { in: clinicalOrders.map((order) => String(order.serviceId)) }, isActive: true },
        })
        const serviceMap = new Map(services.map((service) => [service.id, service]))
        for (const order of clinicalOrders) {
          const service = serviceMap.get(String(order.serviceId))
          if (!service) continue
          await tx.clinicalOrder.create({
            data: {
              medicalVisitId: visit.id,
              medicalServiceId: service.id,
              serviceName: service.name,
              price: service.price,
              note: String(order.note || '').trim() || null,
            },
          })
        }
      }

      return tx.medicalVisit.findUniqueOrThrow({ where: { id: visit.id }, include: this.visitInclude() })
    })
    return { medicalVisit: this.serialize(row) }
  }
}
