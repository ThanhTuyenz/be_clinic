import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class PaymentWebhookSignatureService {
  constructor(private readonly config: ConfigService) {}

  verify(provider: string, rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.config.get<string>(`PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase()}`) ?? this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret || !rawBody || !signature) throw new UnauthorizedException('Webhook signature configuration or header is missing');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const supplied = signature.replace(/^sha256=/i, '');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const suppliedBuffer = Buffer.from(supplied, 'hex');
    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) throw new UnauthorizedException('Webhook signature is invalid');
  }
}
