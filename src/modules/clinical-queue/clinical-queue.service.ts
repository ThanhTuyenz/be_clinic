import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'
import QRCode from 'qrcode'

@Injectable()
export class ClinicalQueueService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private async staff(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctor: { select: { id: true } } } })
    if (!user || user.role === 'PATIENT') throw new ForbiddenException('Chỉ nhân viên được truy cập cận lâm sàng')
    return user
  }

  private signature(visitId: string) {
    const secret = this.config.get<string>('auth.secret')
    if (!secret) throw new Error('Thiếu AUTH_JWT_SECRET')
    return createHmac('sha256', secret).update(`clinical-order:${visitId}`).digest('base64url')
  }

  private payload(visitId: string) { return `VITACARE_CLINICAL_ORDER:${visitId}.${this.signature(visitId)}` }

  private verify(payload: string) {
    const raw = String(payload || '').trim().replace(/^VITACARE_CLINICAL_ORDER:/, '')
    const [visitId, supplied] = raw.split('.')
    if (!visitId || !supplied) throw new BadRequestException('QR phiếu chỉ định không hợp lệ')
    const expected = this.signature(visitId)
    const a = Buffer.from(supplied), b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('QR phiếu chỉ định không hợp lệ')
    return visitId
  }

  private dateKey() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  }

  async rooms(userId: string) {
    await this.staff(userId)
    return { items: await this.prisma.clinicRoom.findMany({ where: { isActive: true }, include: { branch: { select: { id: true, name: true } } }, orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }] }) }
  }

  async pass(userId: string, appointmentId: string) {
    const user = await this.staff(userId)
    const visit = await this.prisma.medicalVisit.findUnique({ where: { appointmentId }, include: { clinicalOrders: true } })
    if (!visit) throw new NotFoundException('Chưa có hồ sơ khám')
    if (user.role === 'DOCTOR' && user.doctor?.id !== visit.doctorId) throw new ForbiddenException('Không có quyền xem phiếu này')
    if (!visit.clinicalOrders.length) throw new BadRequestException('Phiếu chưa có chỉ định cận lâm sàng')
    const qrPayload = this.payload(visit.id)
    return { medicalVisitId: visit.id, qrPayload, qrImageDataUrl: await QRCode.toDataURL(qrPayload, { width: 280, margin: 2 }), orderCount: visit.clinicalOrders.length }
  }

  async patientPass(userId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientProfile: { accountId: userId } },
      include: {
        medicalVisit: {
          include: {
            clinicalOrders: { include: { medicalService: true, assignedRoom: true }, orderBy: { orderedAt: 'asc' } },
          },
        },
      },
    })
    if (!appointment) throw new NotFoundException('Không tìm thấy lịch khám')
    const visit = appointment.medicalVisit
    if (!visit?.clinicalOrders.length) throw new NotFoundException('Lịch khám chưa có chỉ định cận lâm sàng')
    const qrPayload = this.payload(visit.id)
    return {
      medicalVisitId: visit.id,
      appointmentId,
      qrPayload,
      qrImageDataUrl: await QRCode.toDataURL(qrPayload, { width: 280, margin: 2 }),
      orders: visit.clinicalOrders.map((order) => ({
        id: order.id,
        serviceName: order.serviceName,
        category: order.medicalService.category,
        status: order.status,
        room: order.assignedRoom ? { id: order.assignedRoom.id, code: order.assignedRoom.code, name: order.assignedRoom.name } : null,
        queueDate: order.queueDate?.toISOString().slice(0, 10) || null,
        queueNumber: order.queueNumber,
        receivedAt: order.receivedAt,
        completedAt: order.completedAt,
        result: order.resultPayload,
      })),
    }
  }

  async receive(userId: string, qrPayload: string) {
    await this.staff(userId)
    const visitId = this.verify(qrPayload)
    const date = this.dateKey()
    return this.prisma.$transaction(async (tx) => {
      const orders = await tx.clinicalOrder.findMany({ where: { medicalVisitId: visitId, status: { in: ['ORDERED', 'IN_PROGRESS'] } }, include: { medicalService: true, assignedRoom: true, medicalVisit: { include: { medicalRecord: { include: { patientProfile: true } } } } } })
      if (!orders.length) throw new NotFoundException('Phiếu không còn chỉ định chờ tiếp nhận')
      if (orders.some((item) => !item.assignedRoomId || !item.assignedRoom)) throw new BadRequestException('Phiếu có chỉ định chưa được bác sĩ phân phòng')
      const roomIds = [...new Set(orders.map((item) => item.assignedRoomId!))].sort()
      const tickets: Array<{ room: any; queueDate: string; queueNumber: number; orders: any[] }> = []
      for (const roomId of roomIds) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`CLINICAL:${roomId}:${date}`}))`
        const roomOrders = orders.filter((item) => item.assignedRoomId === roomId)
        const existing = roomOrders.find((item) => item.queueDate?.toISOString().slice(0, 10) === date && item.queueNumber != null)
        let queueNumber = existing?.queueNumber || null
        if (!queueNumber) {
          const [counter] = await tx.$queryRaw<Array<{ max: number | null }>>`SELECT MAX("queue_number")::int AS max FROM "clinical_orders" WHERE "assigned_room_id" = ${roomId}::uuid AND "queue_date" = ${date}::date`
          queueNumber = (counter?.max || 0) + 1
          await tx.clinicalOrder.updateMany({ where: { id: { in: roomOrders.map((item) => item.id) } }, data: { status: 'IN_PROGRESS', queueDate: new Date(`${date}T00:00:00.000Z`), queueNumber, receivedAt: new Date() } })
        }
        tickets.push({ room: roomOrders[0].assignedRoom, queueDate: date, queueNumber, orders: roomOrders.map((item) => ({ id: item.id, serviceName: item.serviceName, category: item.medicalService.category })) })
      }
      return { patient: orders[0].medicalVisit.medicalRecord.patientProfile, tickets }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  }

  async list(userId: string, roomId: string, date = this.dateKey(), status = 'waiting') {
    await this.staff(userId)
    if (!['waiting', 'completed'].includes(status)) throw new BadRequestException('Trạng thái hàng đợi không hợp lệ')
    const orderStatus = status === 'completed' ? 'COMPLETED' : 'IN_PROGRESS'
    const items = await this.prisma.clinicalOrder.findMany({ where: { assignedRoomId: roomId, queueDate: new Date(`${date}T00:00:00.000Z`), status: orderStatus }, include: { medicalService: true, assignedRoom: true, medicalVisit: { include: { medicalRecord: { include: { patientProfile: true } } } } }, orderBy: status === 'completed' ? [{ completedAt: 'desc' }, { queueNumber: 'asc' }] : [{ queueNumber: 'asc' }, { orderedAt: 'asc' }] })
    return { items: items.map((item) => ({ ...item, price: Number(item.price), patient: item.medicalVisit.medicalRecord.patientProfile })) }
  }

  async mockResult(userId: string, orderId: string) {
    await this.staff(userId)
    const order = await this.prisma.clinicalOrder.findUnique({ where: { id: orderId }, include: { medicalService: true } })
    if (!order || order.status !== 'IN_PROGRESS') throw new BadRequestException('Chỉ định chưa được tiếp nhận hoặc không tồn tại')
    const now = new Date()
    const result = order.medicalService.category === 'LAB_TEST'
      ? { source: 'MOCK_LIS', observations: [{ code: 'GLU', name: 'Glucose', value: 6.2, unit: 'mmol/L', referenceRange: '3.9 - 5.6', flag: 'HIGH' }, { code: 'WBC', name: 'Bạch cầu', value: 7.5, unit: '10^9/L', referenceRange: '4.0 - 10.0', flag: 'NORMAL' }], conclusion: 'Glucose cao nhẹ so với khoảng tham chiếu.' }
      : { source: 'MOCK_PACS', modality: 'CR', studyInstanceUid: `1.2.840.10008.${now.getTime()}`, imageUrl: '/mock-pacs/chest-xray.svg', conclusion: 'Chưa ghi nhận bất thường rõ trên ảnh mô phỏng.' }
    await this.prisma.clinicalOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED', resultPayload: result, completedAt: now } })
    return { orderId, status: 'COMPLETED', result }
  }
}
