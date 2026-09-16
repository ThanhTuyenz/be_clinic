import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { OrNeverType } from 'src/common/utils/types/or-never.type';
import { AllConfigType } from '../../../../config/config.type';
import { JwtPayloadType } from './types/jwt-payload.type';

import { TokenBlacklistService } from '../../jwt-auth-core/token-blacklist.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService<AllConfigType>,
    private tokenBlacklistService: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.token || null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey:
        configService.get<string>('auth.secret', {
          infer: true,
        }) || '',
    });
  }

  public async validate(req: Request, payload: JwtPayloadType): Promise<OrNeverType<JwtPayloadType>> {
    if (!payload.id) {
      throw new UnauthorizedException();
    }

    const token =
      req?.cookies?.token ||
      (req?.headers?.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (token) {
      const isBlacklisted = await this.tokenBlacklistService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token đã bị thu hồi');
      }
    }

    if (payload.iat) {
      const isRevoked = await this.tokenBlacklistService.isUserRevoked(payload.id, payload.iat);
      if (isRevoked) {
        throw new UnauthorizedException('Phiên đăng nhập đã hết hiệu lực do thay đổi bảo mật');
      }
    }

    return payload;
  }
}
