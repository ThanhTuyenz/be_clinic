import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../mails/mails.service.js';

/**
 * Cron job tự động nhắc lịch hẹn bệnh nhân.
 *
 * Chạy mỗi giờ đúng, quét 2 mốc thời gian:
 *  - 24 giờ trước giờ khám → gửi reminder + hướng dẫn y tế
 *  -  2 giờ trước giờ khám → gửi reminder cuối
 *
 * Dùng flag `reminderSent24h` / `reminderSent2h` trên Appointment
 * để đảm bảo mỗi bệnh nhân chỉ nhận 1 lần.
 */
@Injectable()
export class AppointmentReminderTask {
  private readonly logger = new Logger(AppointmentReminderTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mails: MailsService,
  ) {}

  // Chạy mỗi giờ đúng (:00)
  @Cron('0 * * * *')
  async handleReminders() {
    this.logger.debug('Bắt đầu quét nhắc lịch...');
    await Promise.allSettled([
      this.sendReminders(24),
      this.sendReminders(2),
    ]);
  }

  private async sendReminders(hoursAhead: 24 | 2) {
    const now = new Date();
    // Cửa sổ quét: [targetTime - 30min, targetTime + 30min]
    const targetMs = now.getTime() + hoursAhead * 60 * 60 * 1000;
    const windowStart = new Date(targetMs - 30 * 60 * 1000);
    const windowEnd = new Date(targetMs + 30 * 60 * 1000);

    const flagField = hoursAhead === 24 ? 'reminderSent24h' : 'reminderSent2h';

    // Tìm tất cả lịch hẹn BOOKED chưa được nhắc, có giờ khám trong cửa sổ
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'BOOKED',
        [flagField]: false,
        OR: [
          // Lịch theo bác sĩ
          {
            scheduleSlot: {
              startTime: { gte: windowStart, lt: windowEnd },
              schedule: { workDate: { gte: new Date(now.toISOString().slice(0, 10)) } },
            },
          },
          // Lịch theo gói dịch vụ
          {
            servicePackageScheduleSlot: {
              startTime: { gte: windowStart, lt: windowEnd },
              schedule: { examDate: { gte: new Date(now.toISOString().slice(0, 10)) } },
            },
          },
        ],
      },
      include: {
        patientProfile: {
          include: { account: { select: { email: true, phoneNumber: true } } },
        },
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: { select: { fullName: true, academicRank: true } },
                branch: { select: { name: true, address: true, phoneNumber: true } },
              },
            },
          },
        },
        servicePackageScheduleSlot: {
          include: {
            schedule: {
              include: {
                servicePackage: { select: { name: true } },
                room: { select: { name: true } },
              },
            },
          },
        },
        branch: { select: { name: true, address: true, phoneNumber: true } },
      },
      take: 200, // Giới hạn mỗi lần chạy
    });

    if (appointments.length === 0) return;
    this.logger.log(`Gửi nhắc ${hoursAhead}h cho ${appointments.length} lịch hẹn`);

    for (const appt of appointments) {
      const email = appt.patientProfile.account?.email;
      if (!email) continue;

      try {
        const doctorSlot = appt.scheduleSlot;
        const packageSlot = appt.servicePackageScheduleSlot;
        const branch = doctorSlot?.schedule.branch ?? appt.branch;
        const appointmentDate =
          doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ??
          packageSlot?.schedule.examDate?.toISOString().slice(0, 10) ??
          '?';
        const startTime =
          doctorSlot?.startTime?.toISOString().slice(11, 16) ??
          packageSlot?.startTime?.toISOString().slice(11, 16) ??
          '?';
        const doctorName = doctorSlot?.schedule.doctor
          ? `${doctorSlot.schedule.doctor.academicRank ?? ''} ${doctorSlot.schedule.doctor.fullName}`.trim()
          : null;
        const serviceName = packageSlot?.schedule.servicePackage?.name ?? null;

        const medicalNote = this.buildMedicalNote(hoursAhead, doctorName, serviceName);

        await this.mails.sendAppointmentReminder({
          to: email,
          data: {
            patientName: appt.patientProfile.fullName,
            bookingCode: appt.bookingCode ?? appt.id,
            appointmentDate,
            startTime,
            branchName: branch?.name ?? 'VitaCare Clinic',
            branchAddress: branch?.address ?? '',
            branchPhone: branch?.phoneNumber ?? '',
            doctorName,
            serviceName,
            medicalNote,
            hoursAhead,
          },
        });

        // Đánh dấu đã gửi
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { [flagField]: true },
        });
      } catch (err) {
        this.logger.error(`Không gửi được nhắc lịch cho appointment ${appt.id}`, err);
      }
    }
  }

  private buildMedicalNote(hoursAhead: number, doctorName: string | null, serviceName: string | null): string {
    const notes: string[] = [];
    if (hoursAhead === 24) {
      notes.push('📋 Chuẩn bị CMND/Căn cước công dân và thẻ BHYT (nếu có).');
      if (serviceName?.toLowerCase().includes('siêu âm') || serviceName?.toLowerCase().includes('xét nghiệm')) {
        notes.push('⚠️ Vui lòng nhịn ăn ít nhất 6 giờ trước khi đến khám.');
      }
      notes.push('🕐 Đến trước giờ hẹn 15 phút để làm thủ tục.');
    } else {
      notes.push('⏰ Lịch khám của bạn diễn ra trong khoảng 2 giờ nữa.');
      notes.push('📍 Vui lòng đến đúng giờ và mang theo mã QR check-in.');
    }
    return notes.join(' ');
  }
}
