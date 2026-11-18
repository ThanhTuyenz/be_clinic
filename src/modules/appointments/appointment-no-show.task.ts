import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

const BATCH_SIZE = 200;
const VN_OFFSET_MS = 7 * 60 * 60_000;

@Injectable()
export class AppointmentNoShowTask {
  private readonly logger = new Logger(AppointmentNoShowTask.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('59 23 * * *', { name: 'appointment-no-show', timeZone: 'Asia/Ho_Chi_Minh' })
  async handleNoShows() {
    if (this.running) return;
    this.running = true;
    let total = 0;
    try {
      // Slot dates and times are separate PostgreSQL date/time columns.
      // Freeze the cutoff for this run, using the clinic's Vietnam time zone.
      const localNow = new Date(Date.now() + VN_OFFSET_MS).toISOString();
      const today = new Date(`${localNow.slice(0, 10)}T00:00:00.000Z`);
      const time = new Date(`1970-01-01T${localNow.slice(11)}`);
      const eligible: Prisma.AppointmentWhereInput = {
        status: 'CONFIRMED',
        checkedInAt: null,
        checkedInById: null,
        OR: [
          { receptionSlot: { OR: [
            { date: { lt: today } },
            { date: today, endTime: { lte: time } },
          ] } },
          { receptionSlotId: null, scheduleSlot: { OR: [
            { schedule: { workDate: { lt: today } } },
            { schedule: { workDate: today }, endTime: { lte: time } },
          ] } },
        ],
      };

      let cursor: string | undefined;
      while (true) {
        const appointments = await this.prisma.appointment.findMany({
          where: { AND: [eligible, ...(cursor ? [{ id: { gt: cursor } }] : [])] },
          select: { id: true, updatedAt: true },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
        });
        if (!appointments.length) break;

        const changed = await this.prisma.$transaction(async tx => {
          // Recheck eligibility and the version read above. Concurrent check-in,
          // rescheduling, cancellation or another worker must not be overwritten.
          const updated = await tx.appointment.updateManyAndReturn({
            where: { AND: [eligible, { OR: appointments.map(({ id, updatedAt }) => ({ id, updatedAt })) }] },
            data: { status: 'NO_SHOW' },
            select: { id: true },
          });
          if (updated.length) {
            await tx.appointmentStatusHistory.createMany({
              data: updated.map(({ id }) => ({
                appointmentId: id,
                fromStatus: 'CONFIRMED',
                toStatus: 'NO_SHOW',
                actorId: null,
                reason: 'AUTO_NO_SHOW: Hết ngày khám, bệnh nhân chưa check-in. Hệ thống tự động ghi nhận không đến khám.',
              })),
            });
          }
          // No-show keeps payment, voucher and historical slot occupancy intact.
          return updated.length;
        });
        total += changed;
        cursor = appointments[appointments.length - 1].id;
        if (appointments.length < BATCH_SIZE) break;
      }
      this.logger.log({ event: 'appointment_no_show_completed', count: total });
    } catch (error) {
      this.logger.error(`Không thể hoàn tất job ghi nhận không đến khám (đã xử lý ${total} lịch)`,
        error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
