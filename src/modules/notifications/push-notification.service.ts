import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private expo = new Expo();

  async sendPushNotifications(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    if (!tokens || tokens.length === 0) return;

    const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));
    if (validTokens.length === 0) {
      this.logger.debug(`Không có ExpoPushToken hợp lệ trong danh sách (${tokens.length} token)`);
      return;
    }

    const messages: ExpoPushMessage[] = validTokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data: data || {},
      badge: 1,
      priority: 'high',
      channelId: 'default',
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        this.logger.log(`Đã gửi thành công ${ticketChunk.length} push notifications`);
      } catch (error) {
        this.logger.error('Lỗi gửi push notification qua Expo Server SDK', error);
      }
    }
  }
}
