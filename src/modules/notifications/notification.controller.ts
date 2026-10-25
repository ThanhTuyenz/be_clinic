import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { NotificationService } from './notification.service.js';
import { QueryNotificationsDto, SaveDeviceTokenDto } from './dtos/notification.dto.js';
import { SkipPermissions } from 'src/common/decorators';

interface RequestWithUser extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
@SkipPermissions()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('device-token')
  @ApiOperation({ summary: 'Lưu hoặc cập nhật Push Token thiết bị (Expo Push Token)' })
  async saveDeviceToken(@Req() req: RequestWithUser, @Body() dto: SaveDeviceTokenDto) {
    const userId = req.user?.id;
    if (!userId) return { success: false, message: 'Chưa xác thực' };
    const result = await this.notificationService.saveDeviceToken(userId, dto);
    return { success: true, data: result };
  }

  @Delete('device-token')
  @ApiOperation({ summary: 'Xóa Push Token thiết bị khi đăng xuất' })
  async removeDeviceToken(@Body('token') token: string) {
    if (!token) return { success: false, message: 'Thiếu token' };
    await this.notificationService.removeDeviceToken(token);
    return { success: true, message: 'Đã xóa device token' };
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thông báo phân trang của người dùng hiện tại' })
  async getNotifications(@Req() req: RequestWithUser, @Query() query: QueryNotificationsDto) {
    const userId = req.user?.id;
    if (!userId) return { items: [], total: 0, unreadCount: 0, page: 1, limit: 20, totalPages: 0 };
    return this.notificationService.getNotifications(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Lấy số lượng thông báo chưa đọc' })
  async getUnreadCount(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) return { unreadCount: 0 };
    return this.notificationService.getUnreadCount(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu 1 thông báo là đã đọc' })
  async markAsRead(@Req() req: RequestWithUser, @Param('id') id: string) {
    const userId = req.user?.id;
    if (!userId) return { success: false };
    return this.notificationService.markAsRead(userId, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo của người dùng là đã đọc' })
  async markAllAsRead(@Req() req: RequestWithUser) {
    const userId = req.user?.id;
    if (!userId) return { success: false };
    return this.notificationService.markAllAsRead(userId);
  }
}
