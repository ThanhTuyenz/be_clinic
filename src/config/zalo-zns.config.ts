import { registerAs } from '@nestjs/config';
import { ZaloZnsConfig } from './config.type.js';

export default registerAs<ZaloZnsConfig>('zaloZns', () => {
  const enabled = process.env.ZALO_ZNS_ENABLED !== 'false';
  const isSandbox =
    process.env.ZALO_ZNS_SANDBOX === 'true' ||
    !process.env.ZALO_ZNS_ACCESS_TOKEN;

  return {
    enabled,
    isSandbox,
    oaId: process.env.ZALO_OA_ID,
    appId: process.env.ZALO_APP_ID,
    appSecret: process.env.ZALO_APP_SECRET,
    accessToken: process.env.ZALO_ZNS_ACCESS_TOKEN,
    templateBookingConfirm:
      process.env.ZALO_ZNS_TEMPLATE_BOOKING_CONFIRM || 'VC_BOOKING_CONFIRM',
    templateReminder:
      process.env.ZALO_ZNS_TEMPLATE_REMINDER || 'VC_APPOINTMENT_REMINDER',
    endpoint:
      process.env.ZALO_ZNS_ENDPOINT ||
      'https://business.openapi.zalo.me/message/template',
  };
});
