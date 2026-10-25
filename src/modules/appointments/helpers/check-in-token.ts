import { createHmac } from 'node:crypto';

export function checkInToken(appointmentId: string, secret?: string) {
  if (!secret) throw new Error('Thiếu AUTH_JWT_SECRET để phát hành QR check-in');
  return createHmac('sha256', secret).update(`check-in:${appointmentId}`).digest('base64url');
}
