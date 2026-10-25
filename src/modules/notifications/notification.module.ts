import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RealtimeModule } from '../../infrastructure/realtime/realtime.module.js';
import { PushNotificationService } from './push-notification.service.js';
import { NotificationService } from './notification.service.js';
import { NotificationController } from './notification.controller.js';

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [PushNotificationService, NotificationService],
  exports: [NotificationService, PushNotificationService],
})
export class NotificationModule {}
