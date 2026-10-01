import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { MailsService } from '../../infrastructure/mail/mails.service.js';
import { HttpSmsService } from '../../infrastructure/httpsms/httpsms.service.js';

/**
 * Cron job tự động nhắc lịch hẹn bệnh nhân.
 *  - 24 giờ trước giờ khám → gửi reminder qua Email & SMS (httpSMS) + hướng dẫn y tế
 */
@Injectable()
export class AppointmentReminderTask {
  private readonly logger = new Logger(AppointmentReminderTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mails: MailsService,
    private readonly httpSms: HttpSmsService,
  ) { }

  // Chạy mỗi giờ đúng (:00) - quét và gửi nhắc hẹn trước 24 giờ qua Zalo ZNS & Email
  @Cron('0 * * * *')
  async handleReminders() {
    this.logger.debug('Bắt đầu quét nhắc lịch 24h...');
    await this.sendReminders(24);
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
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        [hoursAhead === 24 ? 'reminderSent24h' : 'reminderSent2h']: false,
        scheduleSlot: {
          startTime: { gte: windowStart, lt: windowEnd },
          schedule: { workDate: { gte: new Date(now.toISOString().slice(0, 10)) } },
        },
      },
      include: {
        patientProfile: {
          include: { account: { select: { email: true, phoneNumber: true } } },
        },
        scheduleSlot: {
          include: {
            schedule: {
              include: {
                doctor: { select: { academicRank: true, user: { select: { fullName: true } } } },
                branch: { select: { name: true, address: true, phoneNumber: true } },
              },
            },
          },
        },
        servicePackage: { select: { name: true } },
        branch: { select: { name: true, address: true, phoneNumber: true } },
      },
      take: 200, // Giới hạn mỗi lần chạy
    });

    if (appointments.length === 0) return;
    this.logger.log(`Gửi nhắc ${hoursAhead}h cho ${appointments.length} lịch hẹn`);

    for (const appt of appointments) {
      const email = appt.patientProfile.account?.email;
      const phone = appt.patientProfile.phoneNumber || appt.patientProfile.account?.phoneNumber;
      if (!email && !phone) continue;

      try {
        const doctorSlot = appt.scheduleSlot;
        const branch = doctorSlot?.schedule.branch ?? appt.branch;
        const appointmentDate =
          doctorSlot?.schedule.workDate?.toISOString().slice(0, 10) ??
          '?';
        const startTime =
          doctorSlot?.startTime?.toISOString().slice(11, 16) ??
          '?';
        const doctorName = doctorSlot?.schedule.doctor
          ? `${doctorSlot.schedule.doctor.academicRank ?? ''} ${doctorSlot.schedule.doctor.user?.fullName ?? ''}`.trim()
          : null;
        const serviceName = appt.servicePackage?.name ?? null;

        const tasks: Promise<any>[] = [];

        if (email) {
          const medicalNote = this.buildMedicalNote(hoursAhead, doctorName, serviceName);
          tasks.push(
            this.mails.sendAppointmentReminder({
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
            }).catch((mailErr) => {
              this.logger.error(`Lỗi gửi mail nhắc lịch cho ${email}: ${mailErr?.message}`);
            })
          );
        }

        if (phone) {
          tasks.push(
            this.httpSms.sendAppointmentReminder({
              to: phone,
              patientName: appt.patientProfile.fullName,
              bookingCode: appt.bookingCode ?? appt.id,
              hoursAhead,
              appointmentDate,
              startTime,
              branchName: branch?.name ?? 'VitaCare Clinic',
              branchAddress: branch?.address ?? undefined,
              branchPhone: branch?.phoneNumber ?? undefined,
              doctorName,
              serviceName,
              medicalNote: this.buildMedicalNote(hoursAhead, doctorName, serviceName),
            }).catch((smsErr) => {
              this.logger.error(`Lỗi gửi SMS httpSMS nhắc lịch cho ${phone}: ${smsErr?.message}`);
            })
          );
        }

        await Promise.allSettled(tasks);

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
      notes.push('📋 Vui lòng mang theo CCCD/mã khám bệnh (phiếu hẹn) hoặc thẻ BHYT (nếu có) để check-in nhanh tại quầy tiếp tân.');
      if (serviceName?.toLowerCase().includes('siêu âm') || serviceName?.toLowerCase().includes('xét nghiệm')) {
        notes.push('⚠️ Vui lòng nhịn ăn ít nhất 6 giờ trước khi đến khám.');
      }
      notes.push('🕐 Đến trước giờ hẹn 15 phút để làm thủ tục tiếp nhận.');
    } else {
      notes.push('⏰ Lịch khám của bạn diễn ra trong khoảng 2 giờ nữa.');
      notes.push('📍 Vui lòng đến đúng giờ và mang theo CCCD hoặc mã check-in.');
    }
    return notes.join(' ');
  }
}
