import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { formatTime, getStaffUser } from '../../common/utils/staff.utils.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway.js';
import { appointmentInclude, assertPatientSlotAvailable, computeQueueNumber, parseAppointmentDate, RECEPTION_ROLES, serialize } from '../appointments/helpers/appointment.helper.js';
import { PatientDirectoryService } from '../patients/patient-directory.service.js';
import { CreateReceptionAppointmentDto } from './dtos/reception-booking.dto.js';
import { assertPackageReception, PACKAGE_RECEPTION_SELECT } from './helpers/package-reception.helper.js';

@Injectable()
export class ReceptionBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly patients: PatientDirectoryService,
  ) {}

  async createReception(userId: string, input: CreateReceptionAppointmentDto) {
    const user = await getStaffUser(this.prisma, userId);
    if (!RECEPTION_ROLES.includes(user.role)) throw new ForbiddenException('Không có quyền đặt lịch tại quầy');
    const branchIds = user.branchAssignments.map(link => link.branchId);
    if (user.role !== 'CHAIN_MANAGER' && (!branchIds.length || (input.branchId && !branchIds.includes(input.branchId)))) {
      throw new ForbiddenException('Chỉ được tạo lịch tại chi nhánh phụ trách');
    }
    const workDate = parseAppointmentDate(input.appointmentDate);
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (input.appointmentDate < today) throw new BadRequestException('Ngày khám phải là hôm nay hoặc ngày trong tương lai');
    const startTime = new Date(`1970-01-01T${input.startTime}:00.000Z`);

    const row = await this.prisma.$transaction(async tx => {
      const specialty = await tx.specialty.findUnique({
        where: { id: input.specialtyId }, select: { id: true, name: true, isActive: true },
      });
      if (!specialty?.isActive) throw new NotFoundException('Chuyên khoa không khả dụng');
      const service = await tx.servicePackage.findUnique({
        where: { id: input.servicePackageId }, select: PACKAGE_RECEPTION_SELECT,
      });
      if (!service?.isActive) throw new NotFoundException('Dịch vụ khám không khả dụng');
      if (service.specialtyId !== specialty.id) throw new BadRequestException('Dịch vụ khám không thuộc chuyên khoa đã chọn');
      const method = await tx.bookingMethod.findFirst({
        where: { code: 'SPECIALTY_EXAM', isActive: true }, select: { id: true },
      });
      if (!method) throw new BadRequestException('Hình thức khám chuyên khoa không khả dụng');
      const deployments = [service.branchBookingMethod, ...service.branchBookingMethods.map(link => link.branchBookingMethod)]
        .filter(link => link?.isEnabled && link.bookingMethodId === method.id);
      const allowedBranches = deployments.map(link => link.branchId);
      const slot = await tx.doctorScheduleSlot.findFirst({
        where: {
          id: input.scheduleSlotId,
          isActive: true, slotStatus: 'AVAILABLE', startTime,
          schedule: {
            doctorId: input.doctorId, workDate, status: 'OPEN',
            branchId: input.branchId || (user.role === 'CHAIN_MANAGER' ? { in: allowedBranches } : { in: allowedBranches.filter(id => branchIds.includes(id)) }),
            branch: {
              isActive: true,
              specialties: { some: { specialtyId: specialty.id, isActive: true } },
              bookingMethods: { some: { bookingMethodId: method.id, isEnabled: true } },
            },
            doctor: { isActive: true, specialties: { some: { specialtyId: specialty.id } } },
          },
        },
        include: { schedule: { select: { id: true, branchId: true, workDate: true, doctorId: true } } },
        orderBy: { id: 'asc' },
      });
      if (!slot || !allowedBranches.includes(slot.schedule.branchId)) {
        throw new BadRequestException('Không có khung giờ phù hợp với dịch vụ, chuyên khoa và cơ sở phụ trách');
      }
      if (slot.occupiedCount >= slot.capacity) throw new ConflictException('Khung giờ không còn chỗ');
      assertPackageReception(service.receptionSchedules, slot);
      // Slot trong ngày vẫn được tiếp nhận đến khi kết thúc khung giờ.
      const clinicNow = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(11, 19);
      if (input.appointmentDate === today && slot.endTime.toISOString().slice(11, 19) < clinicNow) {
        throw new BadRequestException('Khung giờ khám đã kết thúc');
      }
      const patientProfileId = await this.patients.resolveReceptionProfile(tx, input);
      await assertPatientSlotAvailable(tx, patientProfileId, slot);
      const reserved = await tx.$executeRaw`
        UPDATE "doctor_schedule_slots"
        SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
        WHERE "id" = ${slot.id}::uuid AND "is_active" = TRUE
          AND "slot_status" = 'AVAILABLE' AND "occupied_count" < "capacity"
      `;
      if (reserved !== 1) throw new ConflictException('Khung giờ vừa hết chỗ, vui lòng chọn lại');

      const appointmentId = randomUUID();
      const bookingCode = `VC-${appointmentId.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
      const queueNumber = await computeQueueNumber(tx, appointmentId, slot.id);
      await tx.appointment.create({
        data: {
          id: appointmentId, bookingCode, patientProfileId,
          branchId: slot.schedule.branchId, bookingMethodId: method.id,
          servicePackageId: service.id, servicePrice: service.price,
          scheduleSlotId: slot.id, queueNumber,
          symptomsDescription: input.note || null, status: 'HOLD',
          statusHistories: { create: { toStatus: 'HOLD', actorId: userId, reason: 'CREATED_AT_RECEPTION' } },
        },
      });
      await tx.invoice.create({
        data: {
          appointmentId, issuedBranchId: slot.schedule.branchId,
          subtotal: service.price, totalAmount: service.price,
          items: { create: { description: service.name, quantity: 1, unitPrice: service.price, amount: service.price } },
        },
      });
      return tx.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: appointmentInclude() });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        throw new ConflictException('Lịch khám vừa thay đổi hoặc bị trùng, vui lòng tải lại và kiểm tra trước khi đặt');
      }
      throw error;
    });

    try {
      this.realtimeGateway.emitAppointmentBooked({
        appointmentId: row.id, bookingCode: row.bookingCode,
        queueNumber: row.queueNumber ?? undefined,
        patientName: row.patientProfile.fullName, patientPhone: row.patientProfile.phoneNumber,
        doctorId: row.scheduleSlot?.schedule.doctorId,
        doctorName: row.scheduleSlot?.schedule.doctor.user.fullName,
        specialtyName: row.servicePackage?.specialty?.name,
        servicePackageName: row.servicePackage?.name, packageName: row.servicePackage?.name,
        bookingType: 'SERVICE_PACKAGE',
        branchId: row.branchId, branchName: row.branch.name,
        appointmentDate: row.scheduleSlot?.schedule.workDate.toISOString().slice(0, 10),
        startTime: row.scheduleSlot ? formatTime(row.scheduleSlot.startTime) : undefined,
        endTime: row.scheduleSlot ? formatTime(row.scheduleSlot.endTime) : undefined,
        status: row.status,
      });
    } catch {
      // Lịch đã được lưu; lỗi realtime không làm thất bại việc đăng ký.
    }
    return { appointment: serialize(row) };
  }
}
