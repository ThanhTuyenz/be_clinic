import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatTime } from '../../common/utils/staff.utils.js';
import { ReceptionAvailabilityQueryDto } from '../bookings/dtos/reception-booking.dto.js';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import {
  APPOINTMENT_STAFF_ROLES,
  appointmentScope,
  loadAppointmentActor,
  assertRescheduleDestination,
  parseAppointmentDate,
  appointmentInclude,
  serialize,
} from '../appointments/helpers/appointment.helper.js';
import { packageAcceptsSlot, PACKAGE_RECEPTION_SELECT } from '../bookings/helpers/package-reception.helper.js';

@Injectable()
export class ScheduleAvailabilityService {
  constructor(private readonly prisma: PrismaService) { }

  async availability(userId: string, doctorId: string | undefined, date: string, options: Partial<ReceptionAvailabilityQueryDto> = {}) {
    const actor = await loadAppointmentActor(this.prisma, userId, APPOINTMENT_STAFF_ROLES);
    if (actor.role === 'DOCTOR' && actor.doctor?.id !== doctorId) throw new ForbiddenException('Chỉ được xem lịch của bác sĩ hiện tại');
    const workDate = parseAppointmentDate(date);
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const currentTime = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(11, 19);
    const scoped = !['CHAIN_MANAGER', 'DOCTOR'].includes(actor.role);
    const staffBranches = actor.branchAssignments.map(link => link.branchId);
    if (scoped && (!staffBranches.length || (options.branchId && !staffBranches.includes(options.branchId)))) {
      throw new ForbiddenException('Chỉ được xem lịch tại chi nhánh phụ trách');
    }
    let specialtyId = options.specialtyId;
    let allowedBranches: string[] | undefined;
    const method = specialtyId || options.servicePackageId ? await this.prisma.bookingMethod.findFirst({
      where: { code: 'SPECIALTY_EXAM', isActive: true }, select: { id: true },
    }) : null;
    if ((specialtyId || options.servicePackageId) && !method) throw new BadRequestException('Hình thức khám chuyên khoa không khả dụng');
    const service = options.servicePackageId ? await this.prisma.servicePackage.findUnique({
      where: { id: options.servicePackageId }, select: PACKAGE_RECEPTION_SELECT,
    }) : null;
    if (options.servicePackageId) {
      if (!service?.isActive || !service.specialtyId) throw new NotFoundException('Dịch vụ khám chuyên khoa không khả dụng');
      if (specialtyId && specialtyId !== service.specialtyId) throw new BadRequestException('Dịch vụ khám không thuộc chuyên khoa đã chọn');
      specialtyId = service.specialtyId;
      allowedBranches = [service.branchBookingMethod, ...service.branchBookingMethods.map(link => link.branchBookingMethod)]
        .filter(link => link?.isEnabled && link.bookingMethodId === method!.id)
        .map(link => link.branchId);
    }
    const branchIds = scoped
      ? staffBranches.filter(id => !allowedBranches || allowedBranches.includes(id))
      : allowedBranches;
    const requestedBranches = options.branchId
      ? (branchIds ? branchIds.filter(id => id === options.branchId) : [options.branchId])
      : branchIds;
    const scheduleWhere = {
      ...(doctorId ? { doctorId } : {}),
      status: 'OPEN' as const,
      ...(requestedBranches ? { branchId: { in: requestedBranches } } : {}),
      doctor: { isActive: true, ...(specialtyId ? { specialties: { some: { specialtyId } } } : {}) },
      branch: {
        isActive: true,
        ...(specialtyId ? { specialties: { some: { specialtyId, isActive: true, specialty: { isActive: true } } } } : {}),
        ...(method ? { bookingMethods: { some: { bookingMethodId: method.id, isEnabled: true } } } : {}),
      },
    };
    const firstDate = parseAppointmentDate(today);
    const lastDate = new Date(firstDate);
    lastDate.setUTCDate(lastDate.getUTCDate() + 30);
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { ...scheduleWhere, workDate: { gte: firstDate, lte: lastDate } },
      select: {
        workDate: true, branchId: true,
        slots: {
          where: { isActive: true, slotStatus: 'AVAILABLE' },
          select: { capacity: true, occupiedCount: true, startTime: true, endTime: true },
        },
      },
      orderBy: { workDate: 'asc' },
    });
    const hasCapacity = (slot: { capacity: number; occupiedCount: number; endTime: Date }, day: string) =>
      slot.occupiedCount < slot.capacity && (day !== today || slot.endTime.toISOString().slice(11, 19) >= currentTime);
    const availableDates = [...new Set(schedules.filter(schedule => {
      const day = schedule.workDate.toISOString().slice(0, 10);
      return schedule.slots.some(slot => hasCapacity(slot, day)
        && (!service || packageAcceptsSlot(service.receptionSchedules, schedule.branchId, schedule.workDate, slot.startTime)));
    }).map(schedule => schedule.workDate.toISOString().slice(0, 10)))];
    const slots = await this.prisma.doctorScheduleSlot.findMany({
      where: {
        isActive: true, slotStatus: 'AVAILABLE',
        ...(options.startTime ? { startTime: new Date(`1970-01-01T${options.startTime}:00.000Z`) } : {}),
        occupiedCount: { lt: this.prisma.doctorScheduleSlot.fields.capacity },
        schedule: { ...scheduleWhere, workDate },
      },
      include: { schedule: { select: {
        branchId: true, workDate: true, branch: { select: { name: true } },
        doctor: { select: { id: true, academicRank: true, user: { select: { fullName: true } } } },
        room: { select: { id: true, name: true } },
      } } },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
    });
    const available = date < today ? [] : slots.filter(slot =>
      slot.occupiedCount < slot.capacity
      && (date !== today || slot.endTime.toISOString().slice(11, 19) >= currentTime)
      && (!service || packageAcceptsSlot(service.receptionSchedules, slot.schedule.branchId, slot.schedule.workDate, slot.startTime)),
    );
    return {
      availableDates,
      freeSlots: [...new Set(available.map(slot => formatTime(slot.startTime)))],
      slots: available.map(slot => ({
        id: slot.id, scheduleSlotId: slot.id, time: formatTime(slot.startTime),
        startTime: formatTime(slot.startTime), endTime: formatTime(slot.endTime),
        branchId: slot.schedule.branchId, branchName: slot.schedule.branch.name,
        doctorId: slot.schedule.doctor.id, doctorName: slot.schedule.doctor.user.fullName,
        academicRank: slot.schedule.doctor.academicRank, roomId: slot.schedule.room?.id, roomName: slot.schedule.room?.name,
        remainingSlots: slot.capacity - slot.occupiedCount,
      })),
    };
  }

  async doctorLeaveImpactAnalysis(userId: string, body: { doctorId: string; fromDate: string; toDate: string }) {
    const actor = await loadAppointmentActor(this.prisma, userId, APPOINTMENT_STAFF_ROLES);
    const scope = appointmentScope(actor);
    const start = parseAppointmentDate(body.fromDate || '');
    const end = parseAppointmentDate(body.toDate || '');
    if (start > end) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    const doctorId = body.doctorId;
    if (actor.role === 'DOCTOR' && actor.doctor?.id !== doctorId) throw new ForbiddenException('Không có quyền xem lịch bác sĩ khác');
    const doctor = await this.prisma.doctor.findUnique({
      where: { id: doctorId }, select: {
        id: true, user: { select: { fullName: true } }, specialties: { take: 1, select: { specialty: { select: { name: true } } } },
      }
    });
    if (!doctor) throw new NotFoundException('Không tìm thấy bác sĩ');
    const affected = await this.prisma.appointment.findMany({
      where: { AND: [scope, { status: 'CONFIRMED', scheduleSlot: { schedule: { doctorId, workDate: { gte: start, lte: end } } } }] },
      include: {
        ...appointmentInclude(), servicePackage: {
          select: {
            ...PACKAGE_RECEPTION_SELECT, code: true, specialty: { select: { id: true, name: true } },
            branchBookingMethod: { select: { ...PACKAGE_RECEPTION_SELECT.branchBookingMethod.select, bookingMethod: { select: { code: true, name: true } } } },
          }
        }
      },
      orderBy: { scheduleSlot: { schedule: { workDate: 'asc' } } },
    });
    const searchStart = new Date(end);
    searchStart.setUTCDate(searchStart.getUTCDate() + 1);
    const searchEnd = new Date(searchStart);
    searchEnd.setUTCDate(searchEnd.getUTCDate() + 5);
    const branchIds = [...new Set(affected.map(appointment => appointment.branchId))];
    const [slots, exceptions] = branchIds.length ? await Promise.all([
      this.prisma.doctorScheduleSlot.findMany({
        where: {
          isActive: true, occupiedCount: { lt: this.prisma.doctorScheduleSlot.fields.capacity }, schedule: {
            doctorId, doctor: { isActive: true }, status: 'OPEN', branchId: { in: branchIds }, workDate: { gte: searchStart, lt: searchEnd },
          }
        },
        include: { schedule: { include: { doctor: { select: { isActive: true, user: { select: { fullName: true } } } }, branch: { select: { name: true } }, room: { select: { name: true } } } } },
        orderBy: [{ schedule: { workDate: 'asc' } }, { startTime: 'asc' }], take: 500,
      }),
      this.prisma.doctorScheduleException.findMany({
        where: { doctorId, isClosed: true, date: { gte: searchStart, lt: searchEnd } }, select: { branchId: true, date: true },
      }),
    ]) : [[], []];
    const closed = new Set(exceptions.map(exception => exception.branchId + ':' + exception.date.toISOString().slice(0, 10)));
    const now = new Date();
    const impacts = affected.map(appointment => ({
      appointment: serialize(appointment),
      suggestedSlots: slots.filter(slot => {
        if (closed.has(slot.schedule.branchId + ':' + slot.schedule.workDate.toISOString().slice(0, 10))) return false;
        try { assertRescheduleDestination(appointment, slot, now); return true; } catch { return false; }
      }).slice(0, 5).map(slot => ({
        slotId: slot.id, doctorName: slot.schedule.doctor.user.fullName,
        workDate: slot.schedule.workDate.toISOString().slice(0, 10), startTime: slot.startTime.toISOString().slice(11, 16), endTime: slot.endTime.toISOString().slice(11, 16),
        branchName: slot.schedule.branch.name, roomName: slot.schedule.room?.name || '',
      })),
    }));
    return { doctor: { id: doctor.id, fullName: doctor.user.fullName, specialtyName: doctor.specialties[0]?.specialty.name || '' }, affectedCount: affected.length, impacts };
  }
}
