import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { formatTime } from '../../../common/utils/staff.utils.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { assertPackageReception, PACKAGE_RECEPTION_SELECT } from '../../bookings/helpers/package-reception.helper.js';

// Access control
export const APPOINTMENT_ACTOR_SELECT = {
  id: true, role: true, doctor: { select: { id: true } },
  branchAssignments: { select: { branchId: true } },
} satisfies Prisma.UserSelect;

export type AppointmentActor = Prisma.UserGetPayload<{ select: typeof APPOINTMENT_ACTOR_SELECT }>;
export const RECEPTION_ROLES: UserRole[] = ['CHAIN_MANAGER', 'BRANCH_MANAGER', 'RECEPTIONIST'];
export const APPOINTMENT_STAFF_ROLES: UserRole[] = [...RECEPTION_ROLES, 'DOCTOR'];

export async function loadAppointmentActor(prisma: PrismaService, userId: string, roles: UserRole[]) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: APPOINTMENT_ACTOR_SELECT });
  if (!user || !roles.includes(user.role)) throw new ForbiddenException('Không có quyền thao tác lịch khám');
  return user;
}

export function appointmentScope(actor: AppointmentActor): Prisma.AppointmentWhereInput {
  if (actor.role === 'CHAIN_MANAGER') return {};
  if (actor.role === 'DOCTOR') {
    if (!actor.doctor) throw new ForbiddenException('Tài khoản chưa được gán hồ sơ bác sĩ');
    return { scheduleSlot: { schedule: { doctorId: actor.doctor.id } } };
  }
  const branchIds = actor.branchAssignments.map(link => link.branchId);
  if (!branchIds.length) throw new ForbiddenException('Tài khoản chưa được phân công chi nhánh');
  return { branchId: { in: branchIds } };
}

export function assertAppointmentAccess(actor: AppointmentActor, appointment: {
  branchId: string; scheduleSlot?: { schedule: { doctorId: string } } | null;
}) {
  if (actor.role === 'CHAIN_MANAGER') return;
  if (actor.role === 'DOCTOR') {
    if (!actor.doctor || appointment.scheduleSlot?.schedule.doctorId !== actor.doctor.id) {
      throw new ForbiddenException('Lịch khám không thuộc bác sĩ hiện tại');
    }
  } else if (!actor.branchAssignments.some(link => link.branchId === appointment.branchId)) {
    throw new ForbiddenException('Lịch khám không thuộc chi nhánh phụ trách');
  }
}

// Queue numbers
export async function computeQueueNumber(
  tx: Prisma.TransactionClient,
  appointmentId: string,
  scheduleSlotId?: string | null,
): Promise<number> {
  if (scheduleSlotId) {
    const currSlot = await tx.doctorScheduleSlot.findUnique({
      where: { id: scheduleSlotId },
    });
    if (currSlot) {
      const earlierSlots = await tx.doctorScheduleSlot.findMany({
        where: {
          scheduleId: currSlot.scheduleId,
          isActive: true,
          startTime: { lt: currSlot.startTime },
        },
        select: { capacity: true },
      });
      const priorCapacity = earlierSlots.reduce((sum, s) => sum + (s.capacity || 1), 0);
      const bookedInCurrentSlot = await tx.appointment.count({
        where: {
          scheduleSlotId: currSlot.id,
          queueNumber: { not: null },
          id: { not: appointmentId },
        },
      });
      return priorCapacity + bookedInCurrentSlot + 1;
    }
  }

  return 1;
}

// Rescheduling validation
type ReceptionPackage = Prisma.ServicePackageGetPayload<{ select: typeof PACKAGE_RECEPTION_SELECT }>;

export function assertRescheduleDestination(
  appointment: {
    branchId: string; scheduleSlotId: string | null;
    scheduleSlot?: { schedule: { doctorId: string } } | null;
    servicePackage?: ReceptionPackage | null;
  },
  slot: {
    id: string; isActive: boolean; startTime: Date;
    schedule: { doctorId: string; branchId: string; status: string; workDate: Date; doctor: { isActive: boolean } };
  },
  now = new Date(),
) {
  if (!slot.isActive || slot.schedule.status !== 'OPEN' || !slot.schedule.doctor.isActive) throw new BadRequestException('Khung giờ khám mới không khả dụng');
  if (slot.id === appointment.scheduleSlotId) throw new BadRequestException('Khung giờ mới trùng với khung giờ hiện tại');
  if (!appointment.scheduleSlot || slot.schedule.doctorId !== appointment.scheduleSlot.schedule.doctorId) throw new BadRequestException('Đổi lịch phải giữ nguyên bác sĩ phụ trách');
  if (slot.schedule.branchId !== appointment.branchId) throw new BadRequestException('Đổi lịch phải giữ nguyên cơ sở khám');
  if (appointmentDateTime(slot.schedule.workDate, slot.startTime) <= now) throw new BadRequestException('Không thể đổi sang khung giờ trong quá khứ');
  const pkg = appointment.servicePackage;
  if (pkg) {
    const deployments = [pkg.branchBookingMethod, ...pkg.branchBookingMethods.map(link => link.branchBookingMethod)];
    if (!pkg.isActive || !deployments.some(method => method?.branchId === slot.schedule.branchId && method.isEnabled)) throw new BadRequestException('Gói khám không còn áp dụng tại cơ sở này');
    assertPackageReception(pkg.receptionSchedules, slot);
  }
}

// Slot mutations
export async function releaseAppointmentSlot(tx: Prisma.TransactionClient, slotId?: string | null) {
  if (!slotId) return;
  await tx.$executeRaw`
    UPDATE "doctor_schedule_slots"
    SET "occupied_count" = GREATEST("occupied_count" - 1, 0), "updated_at" = NOW()
    WHERE "id" = ${slotId}::uuid
  `;
}

/** The caller supplies its policy checks; all slot transfers share one atomic mutation. */
export async function transferAppointmentSlot(
  tx: Prisma.TransactionClient,
  appointment: { id: string; status: AppointmentStatus; scheduleSlotId: string | null; rescheduleCount: number },
  newSlot: { id: string; schedule: { branchId: string } },
  actorId: string,
  reason: string,
) {
  if (appointment.scheduleSlotId === newSlot.id) throw new BadRequestException('Khung giờ mới trùng với khung giờ hiện tại');
  if (!['HOLD', 'CONFIRMED'].includes(appointment.status)) throw new BadRequestException('Lịch hẹn không còn ở trạng thái có thể đổi lịch');
  const claimed = await tx.appointment.updateMany({
    where: {
      id: appointment.id, status: appointment.status,
      scheduleSlotId: appointment.scheduleSlotId, rescheduleCount: appointment.rescheduleCount,
    },
    data: { scheduleSlotId: newSlot.id, branchId: newSlot.schedule.branchId, rescheduleCount: { increment: 1 }, reminderSent24h: false, reminderSent2h: false },
  });
  if (claimed.count !== 1) throw new ConflictException('Lịch hẹn vừa được cập nhật, vui lòng tải lại');
  const reserved = await tx.$executeRaw`
    UPDATE "doctor_schedule_slots"
    SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
    WHERE "id" = ${newSlot.id}::uuid AND "is_active" = TRUE AND "occupied_count" < "capacity"
  `;
  if (reserved !== 1) throw new ConflictException('Khung giờ mới vừa hết chỗ, vui lòng chọn khung giờ khác');
  await releaseAppointmentSlot(tx, appointment.scheduleSlotId);
  const queueNumber = await computeQueueNumber(tx, appointment.id, newSlot.id);
  return tx.appointment.update({
    where: { id: appointment.id },
    data: {
      queueNumber,
      statusHistories: { create: { fromStatus: appointment.status, toStatus: appointment.status, actorId, reason } },
    },
  });
}

// Appointment statuses
const ALIASES: Record<string, AppointmentStatus> = {
  PENDING: 'HOLD', BOOKED: 'CONFIRMED', EXAMINED: 'COMPLETED',
};
const TRANSITIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  HOLD: ['HOLD', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'],
  CHECKED_IN: ['CHECKED_IN', 'COMPLETED', 'CANCELLED'],
  IN_EXAMINATION: ['IN_EXAMINATION', 'COMPLETED'],
  COMPLETED: ['COMPLETED'], CANCELLED: ['CANCELLED'],
};

export function appointmentStatus(value: unknown): AppointmentStatus {
  const key = String(value || '').trim().toUpperCase();
  const status = ALIASES[key] || key;
  if (!Object.values(AppointmentStatus).includes(status as AppointmentStatus)) throw new BadRequestException('Trạng thái lịch khám không hợp lệ');
  return status as AppointmentStatus;
}

export function appointmentStatusFilter(value?: string, groupConfirmed = false): Prisma.AppointmentWhereInput {
  if (!value || value.trim().toUpperCase() === 'ALL') return {};
  const status = appointmentStatus(value);
  return { status: groupConfirmed && status === 'CONFIRMED' ? { in: ['CONFIRMED', 'CHECKED_IN'] } : status };
}

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus) {
  if (!TRANSITIONS[from]?.includes(to)) throw new BadRequestException(`Không thể chuyển lịch khám từ ${from} sang ${to}`);
}

// Dates and reminders
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function parseAppointmentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Ngày khám không hợp lệ');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Ngày khám không hợp lệ');
  }
  return date;
}

export function appointmentDateTime(workDate: Date, startTime: Date) {
  return new Date(`${workDate.toISOString().slice(0, 10)}T${startTime.toISOString().slice(11, 19)}+07:00`);
}

/** PostgreSQL DATE and TIME must be filtered separately, in clinic local time. */
export function reminderSlotWindows(now: Date, hoursAhead: 2 | 24) {
  const target = now.getTime() + hoursAhead * 60 * 60 * 1000 + VN_OFFSET_MS;
  const start = new Date(target - 30 * 60 * 1000);
  const end = new Date(target + 30 * 60 * 1000);
  const startDay = start.toISOString().slice(0, 10);
  const endDay = end.toISOString().slice(0, 10);
  const time = (date: Date) => new Date(`1970-01-01T${date.toISOString().slice(11, 23)}Z`);
  if (startDay === endDay) return [{
    schedule: { workDate: parseAppointmentDate(startDay) }, startTime: { gte: time(start), lt: time(end) },
  }];
  return [
    { schedule: { workDate: parseAppointmentDate(startDay) }, startTime: { gte: time(start) } },
    { schedule: { workDate: parseAppointmentDate(endDay) }, startTime: { lt: time(end) } },
  ];
}

// Response serialization
export function statusForClient(status: string) {
  if (status === 'HOLD') return 'pending'
  if (['CONFIRMED', 'CHECKED_IN'].includes(status)) return 'confirmed'
  if (status === 'COMPLETED') return 'examined'
  if (status === 'CANCELLED') return 'cancelled'
  return status.toLowerCase()
}

export function serialize(row: any) {
  const invoice = row.invoice ?? row.bookingOrder?.invoice
  const payment = invoice?.payments?.[0]
  const doctorSlot = row.scheduleSlot
  const bookedDoctor = row.doctor ?? doctorSlot?.schedule?.doctor
  const appointmentDate = doctorSlot?.schedule?.workDate
  const room = doctorSlot?.schedule?.room
  const creator = row.statusHistories?.[0]?.actor
  const createdAtClinic = creator && creator.role !== 'PATIENT'
  const specialty = row.servicePackage?.specialty ?? bookedDoctor?.specialties?.find((item: any) => item.isPrimary)?.specialty ?? bookedDoctor?.specialties?.[0]?.specialty
  const bookingMethod = row.bookingMethod
    ? {
      code: row.bookingMethod.code,
      name: row.bookingMethod.name,
    }
    : row.servicePackage?.branchBookingMethod?.bookingMethod
      ? {
        code: row.servicePackage.branchBookingMethod.bookingMethod.code,
        name: row.servicePackage.branchBookingMethod.bookingMethod.name,
      }
      : { code: 'DOCTOR', name: 'Khám với bác sĩ' }
  const isTelehealth = Boolean(row.telehealthSession || bookingMethod.code === 'ONLINE_CONSULTATION')
  const bookingOrder = row.bookingOrder
  return {
    id: row.id,
    ticket: row.bookingCode,
    bookingCode: row.bookingCode,
    bookingOrderId: row.bookingOrderId ?? null,
    orderCode: bookingOrder?.orderCode ?? null,
    groupType: bookingOrder?.groupType ?? 'SINGLE',
    createdAt: row.createdAt,
    checkedInAt: row.checkedInAt ? new Date(row.checkedInAt).toISOString() : null,
    source: createdAtClinic ? 'clinic' : 'online',
    bookingSource: createdAtClinic ? 'clinic' : 'online',
    createdByStaff: createdAtClinic ? { id: creator.id, fullName: creator.fullName, email: creator.email, role: creator.role } : null,
    appointmentDate: appointmentDate?.toISOString().slice(0, 10) ?? null,
    startTime: doctorSlot?.startTime ? formatTime(doctorSlot.startTime) : null,
    endTime: doctorSlot?.endTime ? formatTime(doctorSlot.endTime) : null,
    status: statusForClient(row.status),
    workflowStatus: row.status,
    symptoms: row.symptomsDescription || '',
    visitQueueNumber: row.queueNumber,
    // Telehealth uses the doctor's time slot, not its physical room.
    clinicRoom: isTelehealth ? '' : room?.id || '',
    clinicRoomName: isTelehealth ? '' : room?.name || room?.code || '',
    patient: {
      id: row.patientProfile.id,
      patientCode: row.patientProfile.patientCode || row.patientProfile.nationalId || row.patientProfile.id,
      fullName: row.patientProfile.fullName,
      dateOfBirth: row.patientProfile.dateOfBirth,
      gender: row.patientProfile.gender?.toLowerCase(),
      email: row.patientProfile.account?.email,
      phone: row.patientProfile.phoneNumber || row.patientProfile.account?.phoneNumber || '',
      address: row.patientProfile.address || '',
      nationalId: row.patientProfile.nationalId,
      healthInsuranceNumber: row.patientProfile.healthInsuranceNumber,
    },
    doctor: bookedDoctor ? {
      id: bookedDoctor.id,
      fullName: bookedDoctor.user?.fullName || bookedDoctor.fullName || '',
      department: bookedDoctor.department?.name,
      specialtyId: specialty?.id,
      specialtyName: specialty?.name,
    } : null,
    specialty: specialty ? { id: specialty.id, name: specialty.name, department: specialty.department?.name } : null,
    servicePackage: row.servicePackage ? {
      id: row.servicePackage.id,
      code: row.servicePackage.code,
      name: row.servicePackage.name,
    } : null,
    bookingMethod,
    isTelehealth,
    branch: row.branch ? { id: row.branch.id, code: row.branch.code, name: row.branch.name, address: row.branch.address } : null,
    invoice: invoice ? {
      id: invoice.id,
      totalAmount: Number(invoice.totalAmount),
      status: invoice.status,
      paidAt: invoice.paidAt,
      items: (invoice.items || []).map((item: any) => ({
        id: String(item.id),
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
      })),
    } : null,
    payment: invoice ? {
      status: invoice.status === 'PAID' ? 'paid' : (invoice.status === 'REFUNDED' ? 'refunded' : 'unpaid'),
      paid: invoice.status === 'PAID',
      amount: Number(invoice.totalAmount),
      method: payment?.method?.toLowerCase(),
      provider: payment?.provider,
      transactionId: payment?.providerTransactionId,
      paidAt: invoice.paidAt,
      refundBank: payment?.rawPayload?.refundBank || null,
    } : null,
    medicalVisit: null,
  }
}

export function appointmentInclude() {
  return {
    patientProfile: {
      select: {
        id: true,
        patientCode: true,
        fullName: true,
        phoneNumber: true,
        nationalId: true,
        healthInsuranceNumber: true,
        dateOfBirth: true,
        gender: true,
        address: true,
        account: { select: { id: true, email: true, phoneNumber: true } },
      },
    },
    branch: { select: { id: true, code: true, name: true, address: true } },
    bookingOrder: {
      select: {
        orderCode: true,
        groupType: true,
        invoice: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
            paidAt: true,
            payments: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { method: true, provider: true, providerTransactionId: true, paidAt: true, rawPayload: true } },
          },
        },
      },
    },
    scheduleSlot: {
      select: {
        startTime: true,
        endTime: true,
        schedule: {
          select: {
            doctorId: true,
            workDate: true,
            room: { select: { id: true, code: true, name: true } },
            doctor: {
              select: {
                id: true,
                academicRank: true,
                user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
                specialties: {
                  select: {
                    isPrimary: true,
                    specialty: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    },
    servicePackage: {
      select: {
        id: true,
        code: true,
        name: true,
        specialtyId: true,
        specialty: { select: { id: true, name: true } },
        branchBookingMethod: { select: { bookingMethod: { select: { code: true, name: true } } } },
      },
    },
    telehealthSession: {
      select: { id: true },
    },
    bookingMethod: {
      select: { id: true, code: true, name: true },
    },
    invoice: {
      select: {
        id: true,
        totalAmount: true,
        status: true,
        paidAt: true,
        payments: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { method: true, provider: true, providerTransactionId: true, paidAt: true, rawPayload: true } },
      },
    },
    statusHistories: {
      orderBy: { createdAt: 'asc' as const },
      take: 1,
      select: { actor: { select: { id: true, fullName: true, email: true, role: true } } },
    },
  }
}
export async function assertPatientSlotAvailable(
  tx: Prisma.TransactionClient,
  patientProfileId: string,
  slot: { startTime: Date; endTime: Date; schedule: { workDate: Date } },
) {
  const conflict = await tx.appointment.findFirst({
    where: {
      patientProfileId,
      status: { in: ['HOLD', 'CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION'] },
      scheduleSlot: {
        startTime: { lt: slot.endTime }, endTime: { gt: slot.startTime },
        schedule: { workDate: slot.schedule.workDate },
      },
    },
    select: { id: true },
  });
  if (conflict) throw new ConflictException('Người bệnh đã có lịch khám trùng giờ. Vui lòng chọn khung giờ khác.');
}
