import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Gender } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class StaffAppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async roleOf(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!user) throw new ForbiddenException('Tài khoản không hợp lệ')
    return user.role
  }

  private statusForClient(status: string) {
    if (status === 'PENDING_PAYMENT') return 'pending'
    if (['BOOKED', 'CHECKED_IN', 'IN_EXAMINATION'].includes(status)) return 'confirmed'
    if (status === 'COMPLETED') return 'examined'
    if (status === 'CANCELLED') return 'cancelled'
    return status.toLowerCase()
  }

  private time(value: Date) {
    return value.toISOString().slice(11, 16)
  }

  private serialize(row: any) {
    const payment = row.invoice?.payments?.[0]
    const doctorSlot = row.scheduleSlot
    const packageSlot = row.servicePackageScheduleSlot
    const bookedDoctor = row.doctor ?? doctorSlot?.schedule?.doctor
    const appointmentDate = doctorSlot?.schedule?.workDate ?? packageSlot?.schedule?.examDate
    const room = doctorSlot?.schedule?.room ?? packageSlot?.schedule?.room
    const creator = row.statusHistories?.[0]?.actor
    const createdAtClinic = creator && creator.role !== 'PATIENT'
    const specialty = row.servicePackage?.specialty ?? bookedDoctor?.specialties?.find((item: any) => item.isPrimary)?.specialty ?? bookedDoctor?.specialties?.[0]?.specialty
    return {
      id: row.id,
      ticket: row.bookingCode,
      bookingCode: row.bookingCode,
      createdAt: row.createdAt,
      source: createdAtClinic ? 'clinic' : 'online',
      bookingSource: createdAtClinic ? 'clinic' : 'online',
      createdByStaff: createdAtClinic ? { id: creator.id, fullName: creator.fullName, email: creator.email, role: creator.role } : null,
      appointmentDate: appointmentDate?.toISOString().slice(0, 10) ?? null,
      startTime: doctorSlot?.startTime ? this.time(doctorSlot.startTime) : packageSlot?.startTime ? this.time(packageSlot.startTime) : null,
      endTime: doctorSlot?.endTime ? this.time(doctorSlot.endTime) : packageSlot?.endTime ? this.time(packageSlot.endTime) : null,
      status: this.statusForClient(row.status),
      workflowStatus: row.status,
      symptoms: row.symptomsDescription || '',
      visitQueueNumber: row.queueNumber,
      clinicRoom: room?.id || '',
      clinicRoomName: room?.name || room?.code || '',
      patient: {
        id: row.patientProfile.id,
        patientCode: row.patientProfile.nationalId || row.patientProfile.id,
        fullName: row.patientProfile.fullName,
        name: row.patientProfile.fullName,
        dateOfBirth: row.patientProfile.dateOfBirth,
        dob: row.patientProfile.dateOfBirth,
        gender: row.patientProfile.gender?.toLowerCase(),
        email: row.patientProfile.account?.email,
        phone: row.patientProfile.account?.phoneNumber,
        address: row.patientProfile.address,
        nationalId: row.patientProfile.nationalId,
        healthInsuranceNumber: row.patientProfile.healthInsuranceNumber,
      },
      doctor: bookedDoctor ? {
        id: bookedDoctor.id,
        fullName: bookedDoctor.fullName,
        name: bookedDoctor.fullName,
        department: bookedDoctor.department?.name,
        specialtyId: specialty?.id,
        specialtyName: specialty?.name,
      } : null,
      specialty: specialty ? { id: specialty.id, name: specialty.name, department: specialty.department?.name } : null,
      servicePackage: row.servicePackage ? { id: row.servicePackage.id, code: row.servicePackage.code, name: row.servicePackage.name } : null,
      bookingMethod: row.servicePackage?.branchBookingMethod?.bookingMethod
        ? { code: row.servicePackage.branchBookingMethod.bookingMethod.code, name: row.servicePackage.branchBookingMethod.bookingMethod.name }
        : { code: 'DOCTOR', name: 'Khám với bác sĩ' },
      branch: row.branch ? { id: row.branch.id, code: row.branch.code, name: row.branch.name, address: row.branch.address } : null,
      payment: row.invoice ? {
        status: row.invoice.status === 'PAID' ? 'paid' : 'unpaid',
        paid: row.invoice.status === 'PAID',
        amount: Number(row.invoice.totalAmount),
        method: payment?.method?.toLowerCase(),
        paidAt: row.invoice.paidAt,
      } : null,
      medicalVisit: row.medicalVisit ? {
        ...(row.medicalVisit.payload as object),
        id: row.medicalVisit.id,
        appointmentId: row.medicalVisit.appointmentId,
        medicalRecordId: row.medicalVisit.medicalRecordId,
        updatedAt: row.medicalVisit.updatedAt,
      } : null,
    }
  }

  private appointmentInclude() {
    return {
      patientProfile: { include: { account: true } },
      doctor: { include: { department: true, specialties: { include: { specialty: { include: { department: true } } } } } },
      branch: true,
      scheduleSlot: {
        include: {
          schedule: {
            include: {
              room: true,
              doctor: { include: { department: true, specialties: { include: { specialty: { include: { department: true } } } } } },
            },
          },
        },
      },
      servicePackage: { include: { specialty: { include: { department: true } }, branchBookingMethod: { include: { bookingMethod: true } } } },
      servicePackageScheduleSlot: { include: { schedule: { include: { room: true } } } },
      invoice: { include: { payments: { orderBy: { createdAt: 'desc' as const }, take: 1 } } },
      medicalVisit: true,
      statusHistories: { orderBy: { createdAt: 'asc' as const }, take: 1, include: { actor: { select: { id: true, fullName: true, email: true, role: true } } } },
    }
  }

  async doctorAppointments(userId: string, query: { date?: string; status?: string } = {}) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctor: { select: { id: true } } } })
    if (!user || (user.role !== 'ADMIN' && user.role !== 'DOCTOR')) throw new ForbiddenException('Không có quyền xem lịch bác sĩ')
    const requestedStatus = String(query.status || '').trim().toUpperCase()
    const statusAliases: Record<string, string> = {
      PENDING: 'PENDING_PAYMENT',
      CONFIRMED: 'BOOKED',
      EXAMINED: 'COMPLETED',
    }
    const status = statusAliases[requestedStatus] || requestedStatus
    const allowedStatuses = ['PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN', 'IN_EXAMINATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW']
    if (status && status !== 'ALL' && !allowedStatuses.includes(status)) {
      throw new BadRequestException('Trạng thái lọc không hợp lệ')
    }
    let dateRange: { gte: Date; lt: Date } | undefined
    if (query.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw new BadRequestException('Ngày lọc không hợp lệ')
      const start = new Date(`${query.date}T00:00:00.000Z`)
      if (Number.isNaN(start.getTime())) throw new BadRequestException('Ngày lọc không hợp lệ')
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      dateRange = { gte: start, lt: end }
    }
    const rows = await this.prisma.appointment.findMany({
      where: {
        ...(user.role === 'DOCTOR' ? { doctorId: user.doctor?.id || '__none__' } : {}),
        ...(status && status !== 'ALL' ? { status: status as any } : {}),
        ...(dateRange ? { scheduleSlot: { schedule: { workDate: dateRange } } } : {}),
      },
      include: this.appointmentInclude(),
      orderBy: { scheduleSlot: { schedule: { workDate: 'asc' } } },
    })
    return { appointments: rows.map((row) => this.serialize(row)) }
  }

  async receptionAppointments(userId: string, query: Record<string, string | undefined>) {
    const role = await this.roleOf(userId)
    if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'].includes(role)) throw new ForbiddenException('Không có quyền xem danh sách tiếp nhận')
    const start = query.from ? new Date(`${query.from}T00:00:00`) : undefined
    const end = query.to ? new Date(`${query.to}T23:59:59`) : undefined
    const statusMap: Record<string, any> = { pending: 'PENDING_PAYMENT', confirmed: { in: ['BOOKED', 'CHECKED_IN', 'IN_EXAMINATION'] }, cancelled: 'CANCELLED', examined: 'COMPLETED' }
    const term = String(query.q || '').trim()
    const rows = await this.prisma.appointment.findMany({
      where: {
        ...(query.status && query.status !== 'all' ? { status: statusMap[query.status] || query.status.toUpperCase() } : {}),
        ...(start || end ? { scheduleSlot: { schedule: { workDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } } } : {}),
        ...(term ? { OR: [{ bookingCode: { contains: term, mode: 'insensitive' } }, { patientProfile: { fullName: { contains: term, mode: 'insensitive' } } }] } : {}),
      },
      include: this.appointmentInclude(),
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return { appointments: rows.map((row) => this.serialize(row)) }
  }

  async lookupTicket(userId: string, ticket: string) {
    await this.roleOf(userId)
    const row = await this.prisma.appointment.findFirst({ where: { bookingCode: { equals: ticket, mode: 'insensitive' } }, include: this.appointmentInclude() })
    if (!row) throw new NotFoundException('Không tìm thấy lịch hẹn')
    return { appointment: this.serialize(row) }
  }

  async patients(userId: string, query: Record<string, string | undefined>) {
    await this.roleOf(userId)
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 10, 1), 100)
    const where: any = {
      ...(query.patientCode ? { OR: [{ id: query.patientCode }, { nationalId: { contains: query.patientCode, mode: 'insensitive' } }] } : {}),
      ...(query.name ? { fullName: { contains: query.name, mode: 'insensitive' } } : {}),
      ...(query.phone ? { account: { phoneNumber: { contains: query.phone } } } : {}),
      ...(query.account ? { account: { email: { contains: query.account, mode: 'insensitive' } } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.patientProfile.findMany({ where, include: { account: true }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { fullName: 'asc' } }),
      this.prisma.patientProfile.count({ where }),
    ])
    return { patients: rows.map((row) => ({ ...row, patientCode: row.nationalId || row.id, phone: row.account?.phoneNumber, email: row.account?.email })), total, page, pageSize }
  }

  async patientHistory(userId: string, patientId: string) {
    if (!patientId) throw new BadRequestException('Thiếu mã bệnh nhân')
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctor: { select: { id: true } }, patientProfiles: { select: { id: true } } },
    })
    if (!user) throw new ForbiddenException('Tài khoản không hợp lệ')
    if (user.role === 'DOCTOR') {
      const assigned = await this.prisma.appointment.findFirst({
        where: { patientProfileId: patientId, doctorId: user.doctor?.id || '__none__' },
        select: { id: true },
      })
      if (!assigned) throw new ForbiddenException('Bệnh nhân chưa từng được phân công cho bác sĩ này')
    } else if (user.role === 'PATIENT') {
      if (!user.patientProfiles.some((profile) => profile.id === patientId)) {
        throw new ForbiddenException('Không có quyền xem bệnh sử này')
      }
    } else if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(user.role)) {
      throw new ForbiddenException('Không có quyền xem bệnh sử')
    }
    const rows = await this.prisma.appointment.findMany({ where: { patientProfileId: patientId }, include: this.appointmentInclude(), orderBy: { createdAt: 'desc' } })
    return { appointments: rows.map((row) => this.serialize(row)) }
  }

  async patientByCode(userId: string, code: string) {
    await this.roleOf(userId)
    const row = await this.prisma.patientProfile.findFirst({ where: { OR: [{ id: code }, { nationalId: code }] }, include: { account: true } })
    if (!row) throw new NotFoundException('Không tìm thấy bệnh nhân')
    return { patient: { ...row, patientCode: row.nationalId || row.id, phone: row.account?.phoneNumber, email: row.account?.email } }
  }

  async availability(userId: string, doctorId: string, date: string) {
    await this.roleOf(userId)
    const workDate = new Date(`${date}T00:00:00`)
    const nextDate = new Date(workDate); nextDate.setDate(nextDate.getDate() + 1)
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: { isActive: true, occupiedCount: { lt: this.prisma.doctorScheduleSlot.fields.capacity }, schedule: { doctorId, workDate: { gte: workDate, lt: nextDate }, status: 'OPEN' } },
      orderBy: { startTime: 'asc' },
    })
    return { freeSlots: slots.filter((slot) => slot.occupiedCount < slot.capacity).map((slot) => this.time(slot.startTime)) }
  }

  async updateStatus(userId: string, appointmentId: string, input: Record<string, any>) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctor: { select: { id: true } } },
    })
    if (!user) throw new ForbiddenException('Tài khoản không hợp lệ')
    const role = user.role
    if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'DOCTOR'].includes(role)) throw new ForbiddenException('Không có quyền cập nhật lịch khám')
    const current = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { scheduleSlot: { include: { schedule: true } } },
    })
    if (!current) throw new NotFoundException('Không tìm thấy lịch khám')
    const statuses: Record<string, any> = { pending: 'PENDING_PAYMENT', confirmed: 'BOOKED', cancelled: 'CANCELLED', examined: 'COMPLETED', completed: 'COMPLETED', checked_in: 'CHECKED_IN', in_examination: 'IN_EXAMINATION' }
    const status = statuses[String(input.status || '').toLowerCase()] || String(input.status || '').toUpperCase()
    const allowed = ['PENDING_PAYMENT', 'BOOKED', 'CHECKED_IN', 'IN_EXAMINATION', 'COMPLETED', 'CANCELLED']
    if (!allowed.includes(status)) throw new BadRequestException('Trạng thái lịch khám không hợp lệ')
    if (role === 'DOCTOR') {
      if (!user.doctor?.id || user.doctor.id !== current.doctorId) {
        throw new ForbiddenException('Lịch khám không thuộc bác sĩ hiện tại')
      }
      if (status !== 'IN_EXAMINATION' || current.status !== 'CHECKED_IN') {
        throw new BadRequestException('Bác sĩ chỉ có thể bắt đầu bệnh nhân đã check-in')
      }
    }
    const clinicRoom = input.clinicRoom == null ? '' : String(input.clinicRoom).trim()
    let roomId: string | undefined
    if (clinicRoom) {
      if (!current.scheduleSlot?.schedule) {
        throw new BadRequestException('Lịch hẹn không hỗ trợ xếp phòng trực tiếp')
      }
      const room = await this.prisma.clinicRoom.findFirst({
        where: {
          OR: [{ id: clinicRoom }, { code: clinicRoom }, { name: clinicRoom }],
          branchId: current.branchId,
          isActive: true,
        },
        select: { id: true },
      })
      if (!room) throw new BadRequestException('Phòng khám không tồn tại, đã ngừng hoạt động hoặc không thuộc cơ sở này')
      roomId = room.id
    }
    await this.prisma.$transaction(async (tx) => {
      if (roomId && current.scheduleSlot?.scheduleId) {
        await tx.doctorSchedule.update({
          where: { id: current.scheduleSlot.scheduleId },
          data: { roomId },
        })
      }
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status, ...(input.visitQueueNumber != null ? { queueNumber: Number(input.visitQueueNumber) } : {}) },
      })
      await tx.appointmentStatusHistory.create({
        data: { appointmentId, fromStatus: current.status, toStatus: status, actorId: userId, reason: input.cancelReason || input.note || null },
      })
    })
    const row = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: this.appointmentInclude() })
    return { appointment: this.serialize(row) }
  }

  async createReception(userId: string, input: Record<string, any>) {
    const role = await this.roleOf(userId)
    if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(role)) throw new ForbiddenException('Không có quyền đặt lịch tại quầy')
    const doctor = await this.prisma.doctor.findUnique({ where: { id: String(input.doctorId || '') } })
    if (!doctor) throw new NotFoundException('Không tìm thấy bác sĩ')
    const workDate = new Date(`${String(input.appointmentDate || '')}T00:00:00`)
    const nextDate = new Date(workDate); nextDate.setDate(nextDate.getDate() + 1)
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: { isActive: true, schedule: { doctorId: doctor.id, workDate: { gte: workDate, lt: nextDate }, status: 'OPEN' } },
      include: { schedule: true },
    })
    const slot = slots.find((item) => this.time(item.startTime) === String(input.startTime || '').slice(0, 5))
    if (!slot || slot.occupiedCount >= slot.capacity) throw new BadRequestException('Khung giờ không còn chỗ')

    let patientProfileId = String(input.patient?.id || input.patient?.patientId || '')
    if (!patientProfileId && input.patientEmailOrPhone) {
      const account = await this.prisma.user.findFirst({
        where: { OR: [{ email: input.patientEmailOrPhone }, { phoneNumber: input.patientEmailOrPhone }] },
        include: { patientProfiles: { orderBy: { isMainProfile: 'desc' }, take: 1 } },
      })
      patientProfileId = account?.patientProfiles[0]?.id || ''
    }
    if (!patientProfileId && input.patient?.fullName) {
      const patient = input.patient
      const created = await this.prisma.patientProfile.create({
        data: {
          fullName: String(patient.fullName),
          nationalId: patient.nationalId || patient.patientCode || null,
          dateOfBirth: new Date(patient.dateOfBirth || '1990-01-01'),
          gender: patient.gender && Object.values(Gender).includes(String(patient.gender).toUpperCase() as Gender)
            ? String(patient.gender).toUpperCase() as Gender
            : null,
          address: patient.address || null,
        },
      })
      patientProfileId = created.id
    }
    if (!patientProfileId) throw new BadRequestException('Chưa chọn hồ sơ bệnh nhân')

    const appointmentId = randomUUID()
    const bookingCode = `VC-${Date.now().toString(36).toUpperCase()}`
    await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.doctorScheduleSlot.updateMany({ where: { id: slot.id, occupiedCount: { lt: slot.capacity } }, data: { occupiedCount: { increment: 1 } } })
      if (reserved.count !== 1) throw new BadRequestException('Khung giờ vừa hết chỗ')
      await tx.appointment.create({
        data: { id: appointmentId, bookingCode, patientProfileId, doctorId: doctor.id, branchId: slot.schedule.branchId, scheduleSlotId: slot.id, symptomsDescription: input.note || null, status: 'PENDING_PAYMENT' },
      })
      await tx.appointmentStatusHistory.create({ data: { appointmentId, toStatus: 'PENDING_PAYMENT', actorId: userId, reason: 'CREATED_AT_RECEPTION' } })
      await tx.invoice.create({
        data: {
          appointmentId,
          issuedBranchId: slot.schedule.branchId,
          totalAmount: doctor.consultationFee,
          items: { create: { description: 'Phí khám', quantity: 1, unitPrice: doctor.consultationFee, amount: doctor.consultationFee } },
        },
      })
    })
    const row = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: this.appointmentInclude() })
    return { appointment: this.serialize(row) }
  }

  async nextQueueNumber(userId: string, date: string, clinicRoom?: string, excludeId?: string) {
    const role = await this.roleOf(userId)
    if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST'].includes(role)) {
      throw new ForbiddenException('Không có quyền cấp số thứ tự')
    }
    const workDate = new Date(`${date}T00:00:00`)
    if (Number.isNaN(workDate.getTime())) throw new BadRequestException('Ngày khám không hợp lệ')
    const nextDate = new Date(workDate)
    nextDate.setDate(nextDate.getDate() + 1)
    const rows = await this.prisma.appointment.aggregate({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        scheduleSlot: {
          schedule: {
            workDate: { gte: workDate, lt: nextDate },
            ...(clinicRoom
              ? { room: { is: { OR: [{ id: clinicRoom }, { code: clinicRoom }, { name: clinicRoom }] } } }
              : {}),
          },
        },
      },
      _max: { queueNumber: true },
    })
    return { nextVisitQueueNumber: (rows._max.queueNumber || 0) + 1 }
  }

  async recordPayment(userId: string, appointmentId: string, input: { method?: string; amount?: number; note?: string }) {
    const role = await this.roleOf(userId)
    if (!['ADMIN', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'].includes(role)) {
      throw new ForbiddenException('Không có quyền ghi nhận thanh toán')
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { appointmentId },
      include: { appointment: true, payments: { where: { status: 'SUCCESS' }, take: 1 } },
    })
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn của lịch khám')
    if (invoice.status === 'PAID' || invoice.payments.length) throw new BadRequestException('Lịch khám đã được thanh toán')
    const amount = Number(input.amount ?? invoice.totalAmount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Số tiền không hợp lệ')
    const method = String(input.method || 'cash').toLowerCase() === 'cash' ? 'CASH' : 'VIETQR'
    const now = new Date()
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentTransaction.create({
        data: {
          invoiceId: invoice.id,
          provider: 'CLINIC_COUNTER',
          idempotencyKey: `counter-${appointmentId}-${randomUUID()}`,
          method,
          amount,
          status: 'SUCCESS',
          paidAt: now,
          rawPayload: { note: input.note || null, recordedBy: userId },
        },
      })
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: now, cashierId: userId },
      })
      const appointment = await tx.appointment.update({
        where: { id: appointmentId },
        data: invoice.appointment.status === 'PENDING_PAYMENT' ? { status: 'BOOKED' } : {},
      })
      return { appointment, payment }
    })
  }

  async finishMedicalVisit(userId: string, appointmentId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctor: { select: { id: true } } },
    })
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { medicalVisit: { include: { diagnoses: true } } },
    })
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch khám')
    if (!user || (user.role !== 'ADMIN' && (user.role !== 'DOCTOR' || user.doctor?.id !== appointment.doctorId))) {
      throw new ForbiddenException('Không được kết thúc phiên khám này')
    }
    if (!['CHECKED_IN', 'IN_EXAMINATION'].includes(appointment.status)) {
      throw new BadRequestException('Trạng thái lịch khám không cho phép kết thúc')
    }
    if (appointment.status !== 'IN_EXAMINATION') {
      throw new BadRequestException('Bác sĩ phải bắt đầu khám trước khi kết thúc')
    }
    const medicalVisit = appointment.medicalVisit?.payload as Record<string, unknown> | undefined
    if (!medicalVisit) throw new BadRequestException('Chưa có hồ sơ lần khám')
    if (!appointment.medicalVisit?.diagnoses.length && !String(medicalVisit.diagnosisCode || '').trim()) {
      throw new BadRequestException('Chưa chọn chẩn đoán ICD-10')
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'IN_EXAMINATION' },
        data: { status: 'COMPLETED' },
      })
      if (result.count !== 1) throw new BadRequestException('Lịch khám vừa được cập nhật, vui lòng tải lại')
      await tx.appointmentStatusHistory.create({
        data: { appointmentId, fromStatus: appointment.status, toStatus: 'COMPLETED', actorId: userId },
      })
      await tx.medicalVisit.update({
        where: { appointmentId },
        data: { status: 'FINALIZED', finalizedAt: new Date() },
      })
      await tx.prescription.updateMany({
        where: { medicalVisit: { appointmentId }, items: { some: {} } },
        data: { status: 'ISSUED', issuedAt: new Date() },
      })
      return tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: this.appointmentInclude() })
    })
    return { appointment: this.serialize(row) }
  }
}
