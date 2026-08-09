import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './types/jwt-refresh-payload.type';
import { OrNeverType } from 'src/common/utils/types/or-never.type';
import { AllConfigType } from '../../../../config/config.type';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  private readonly logger = new Logger(JwtRefreshStrategy.name);

  constructor(private configService: ConfigService<AllConfigType>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:
        configService.get<string>('auth.refreshSecret', {
          infer: true,
        }) || '',
    });
  }

  public validate(
    payload: JwtRefreshPayloadType,
  ): OrNeverType<JwtRefreshPayloadType> {
    this.logger.log(
      `Refresh strategy validate called, sessionId=${payload?.sessionId ?? 'missing'}`,
    );

    if (!payload.sessionId) {
      this.logger.warn('Refresh strategy rejected payload: missing sessionId');
      throw new UnauthorizedException();
    }

    this.logger.log(
      `Refresh strategy accepted payload for sessionId=${payload.sessionId}`,
    );
    return payload;
  }
}
