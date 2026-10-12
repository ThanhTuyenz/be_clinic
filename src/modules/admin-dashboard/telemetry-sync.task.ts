import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

@Injectable()
export class TelemetrySyncTask {
  private readonly logger = new Logger(TelemetrySyncTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Chạy đồng bộ mỗi 5 phút và chốt sổ lúc 23:59 hàng đêm
  @Cron('*/5 * * * *')
  async handlePeriodicSync() {
    this.logger.log('Bắt đầu đồng bộ Telemetry từ Redis vào Database PostgreSQL (Every 5 minutes)...');
    await this.syncTelemetryToDatabase();
  }

  @Cron('59 23 * * *')
  async handleDailySnapshot() {
    this.logger.log('Bắt đầu chốt sổ Daily Demand Snapshot (23:59)...');
    await this.syncTelemetryToDatabase();
  }

  /**
   * Đồng bộ toàn bộ dữ liệu telemetry từ Redis vào PostgreSQL:
   * 1. Đồng bộ SearchLog (kèm cờ hasResults)
   * 2. Đồng bộ viewCount vào ServicePackage
   * 3. Chốt sổ DailyDemandSnapshot
   */
  async syncTelemetryToDatabase(targetDateKey?: string) {
    const now = new Date();
    const dateKey = targetDateKey || now.toISOString().slice(0, 10);

    try {
      const client = this.redis.getClient();
      if (!client) {
        this.logger.warn('Redis client is not available for telemetry sync');
        return;
      }

      // 1. Thống kê Từ khóa tìm kiếm trong ngày (SearchLog)
      let totalSearchesToday = 0;
      let unmatchedSearchesToday = 0;

      const dbSearchLogsToday = await this.prisma.searchLog.findMany({
        where: { dateKey },
        select: { count: true, hasResults: true },
      });

      for (const log of dbSearchLogsToday) {
        if (log.hasResults) {
          totalSearchesToday += log.count;
        } else {
          unmatchedSearchesToday += log.count;
        }
      }

      // 2. Đồng bộ lượt xem gói (viewCount) vào ServicePackage
      const pkgViewItems = await client.zrevrange('rec:global:package_views', 0, 500, 'WITHSCORES');
      let totalViewsToday = 0;
      const updateTasks: Promise<any>[] = [];

      for (let i = 0; i < pkgViewItems.length; i += 2) {
        const packageId = pkgViewItems[i];
        const count = parseInt(pkgViewItems[i + 1], 10) || 0;
        if (!packageId || count <= 0) continue;

        totalViewsToday += count;
        updateTasks.push(
          this.prisma.servicePackage
            .updateMany({
              where: { id: packageId },
              data: { viewCount: count },
            })
            .catch(() => {}),
        );
      }
      if (updateTasks.length > 0) {
        await Promise.all(updateTasks);
      }

      // 3. Đếm số lịch đặt trong ngày từ PostgreSQL
      const startOfDay = new Date(`${dateKey}T00:00:00.000Z`);
      const endOfDay = new Date(`${dateKey}T23:59:59.999Z`);

      const totalBookingsToday = await this.prisma.appointment.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
      });

      const overallConversionRate = totalViewsToday > 0
        ? +((totalBookingsToday / totalViewsToday) * 100).toFixed(1)
        : 0;

      // Tìm top chuyên khoa hot nhất hôm nay bằng SUM viewCount các gói thuộc chuyên khoa
      const topPackages = await this.prisma.servicePackage.findMany({
        where: { isActive: true },
        select: {
          viewCount: true,
          specialty: { select: { name: true } },
        },
      });

      const specSumMap = new Map<string, number>();
      for (const p of topPackages) {
        const name = p.specialty?.name || 'Khám tổng quát';
        specSumMap.set(name, (specSumMap.get(name) || 0) + (p.viewCount || 0));
      }

      let topSpecialtyDemand = 'Khám tổng quát';
      let maxViews = -1;
      for (const [name, views] of specSumMap.entries()) {
        if (views > maxViews) {
          maxViews = views;
          topSpecialtyDemand = name;
        }
      }

      // 4. Lưu Daily Demand Snapshot
      await this.prisma.dailyDemandSnapshot.upsert({
        where: { dateKey },
        update: {
          totalSearches: totalSearchesToday,
          unmatchedSearches: unmatchedSearchesToday,
          totalPackageViews: totalViewsToday,
          totalBookings: totalBookingsToday,
          overallConversionRate,
          topSpecialtyDemand,
        },
        create: {
          dateKey,
          totalSearches: totalSearchesToday,
          unmatchedSearches: unmatchedSearchesToday,
          totalPackageViews: totalViewsToday,
          totalBookings: totalBookingsToday,
          overallConversionRate,
          topSpecialtyDemand,
        },
      });

      this.logger.log(
        `Đã đồng bộ telemetry xong cho [${dateKey}]: Searches=${totalSearchesToday} (Unmatched=${unmatchedSearchesToday}), Views=${totalViewsToday}, Bookings=${totalBookingsToday}, CVR=${overallConversionRate}%`,
      );
    } catch (err: any) {
      this.logger.error(`Lỗi đồng bộ telemetry: ${err?.message}`, err.stack);
    }
  }
}
