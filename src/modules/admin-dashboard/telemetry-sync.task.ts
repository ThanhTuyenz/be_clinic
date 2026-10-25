import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { analyticsRange, vietnamDateKey } from '../search-analytics/analytics-time.js';
import { conversionPercent, demandTelemetry, SUCCESSFUL_BOOKING_STATUSES } from '../search-analytics/demand-telemetry.js';

@Injectable()
export class TelemetrySyncTask {
  private readonly logger = new Logger(TelemetrySyncTask.name);
  constructor(private readonly prisma: PrismaService) {}
  @Cron('*/5 * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handlePeriodicSync() { await this.syncTelemetryToDatabase(); }
  @Cron('59 23 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleDailySnapshot() { await this.syncTelemetryToDatabase(); }
  async syncTelemetryToDatabase(dateKey = vietnamDateKey(new Date())) {
    try {
      const { start, end } = analyticsRange({ startDate: dateKey, endDate: dateKey });
      const telemetry = await demandTelemetry(this.prisma, start, end);
      const appointments = await this.prisma.appointment.findMany({
        where: { createdAt: { gte: start, lt: end }, status: { in: SUCCESSFUL_BOOKING_STATUSES } },
        select: {
          servicePackage: { select: { specialty: { select: { name: true } } } },
          scheduleSlot: { select: { schedule: { select: { doctor: { select: { specialties: { select: { specialty: { select: { name: true } } } } } } } } } },
        },
      });
      const specialties = new Map<string, number>();
      for (const appointment of appointments) {
        const name = appointment.servicePackage?.specialty?.name || appointment.scheduleSlot?.schedule.doctor.specialties[0]?.specialty.name || 'Chưa phân loại';
        specialties.set(name, (specialties.get(name) || 0) + 1);
      }
      const data = {
        totalSearches: telemetry.searchFunnel.executed, unmatchedSearches: telemetry.searchFunnel.empty,
        totalPackageViews: telemetry.totalViews, totalBookings: appointments.length,
        overallConversionRate: conversionPercent(telemetry.convertedViewCount, telemetry.totalViews),
        topSpecialtyDemand: [...specialties.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      };
      await this.prisma.dailyDemandSnapshot.upsert({ where: { dateKey }, update: data, create: { dateKey, ...data } });
    } catch (error: any) { this.logger.error('Không thể tổng hợp snapshot analytics', error.stack); }
  }
}
