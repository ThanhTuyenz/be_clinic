import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway.js';
import { REALTIME_EVENTS, REALTIME_ROOMS } from '../../infrastructure/realtime/realtime.constants.js';
import { PushNotificationService } from './push-notification.service.js';
import { CreateNotificationDto, QueryNotificationsDto, SaveDeviceTokenDto } from './dtos/notification.dto.js';
import { NotificationType, Prisma } from '@prisma/client';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushNotificationService,
  ) {}

  /**
   * Lưu hoặc cập nhật Push Token của thiết bị người dùng
   */
  async saveDeviceToken(userId: string, dto: SaveDeviceTokenDto) {
    return this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        deviceType: dto.deviceType || 'mobile',
      },
      update: {
        userId,
        deviceType: dto.deviceType || 'mobile',
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Xóa push token khi người dùng đăng xuất
   */
  async removeDeviceToken(token: string) {
    try {
      await this.prisma.deviceToken.deleteMany({
        where: { token },
      });
    } catch (err) {
      this.logger.debug(`Device token not found or already deleted: ${token}`);
    }
  }

  /**
   * Tạo thông báo mới: Lưu DB -> Bắn Socket.IO -> Gửi Push Notification Mobile
   */
  async createNotification(dto: CreateNotificationDto) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: dto.userId,
          title: dto.title,
          content: dto.content,
          type: dto.type || NotificationType.SYSTEM,
          data: dto.data ? (dto.data as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      // 1. Gửi qua WebSocket Realtime cho Web & App đang mở
      try {
        const room = REALTIME_ROOMS.USER(dto.userId);
        this.realtime.emitToRoom(room, REALTIME_EVENTS.NOTIFICATION, notification);
      } catch (wsErr) {
        this.logger.error(`Lỗi emit websocket notification cho user ${dto.userId}`, wsErr);
      }

      // 2. Gửi Push Notification nổi tới Mobile App qua các token đã lưu
      try {
        const deviceTokens = await this.prisma.deviceToken.findMany({
          where: { userId: dto.userId },
          select: { token: true },
        });

        if (deviceTokens.length > 0) {
          const tokens = deviceTokens.map((d) => d.token);
          await this.push.sendPushNotifications(
            tokens,
            dto.title,
            dto.content,
            dto.data || { notificationId: notification.id },
          );
        }
      } catch (pushErr) {
        this.logger.error(`Lỗi push notification cho user ${dto.userId}`, pushErr);
      }

      return notification;
    } catch (error) {
      this.logger.error(`Lỗi khi tạo notification cho user ${dto.userId}`, error);
      throw error;
    }
  }

  /**
   * Lấy danh sách thông báo phân trang của người dùng
   */
  async getNotifications(userId: string, query: QueryNotificationsDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.isRead !== undefined ? { isRead: query.isRead } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      unreadCount,
    };
  }

  /**
   * Đếm số lượng thông báo chưa đọc
   */
  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  /**
   * Đánh dấu 1 thông báo đã đọc
   */
  async markAsRead(userId: string, notificationId: string) {
    const notif = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notif) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return updated;
  }

  /**
   * Đánh dấu tất cả thông báo của người dùng là đã đọc
   */
  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { success: true, message: 'Đã đánh dấu đọc tất cả thông báo' };
  }
}
