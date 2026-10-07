import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AllConfigType } from '../../../../config/config.type.js';
import { ttlToMilliseconds } from '../../../../config/auth.config.js';
import { ISessionService } from '../../session/session.js';
import { Session } from '../../session/entities/session.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { LoginResponseType } from '../types/login-response.type.js';
import { JwtRefreshPayloadType } from '../strategies/types/jwt-refresh-payload.type.js';
import { TokenBlacklistService } from '../../jwt-auth-core/token-blacklist.service.js';
import { Services } from '../../../../common/utils/constants.js';
import { Inject } from '@nestjs/common';

/**
 * AuthTokenService — Đơn trách nhiệm: Quản lý vòng đời JWT (ký, refresh, blacklist, logout).
 *
 * Tách khỏi AuthService để isolate hoàn toàn logic token — giảm coupling và dễ test.
 */
@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
    @Inject(Services.SESSION) private readonly sessionService: ISessionService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  // ─── Token signing ────────────────────────────────────────────────────────

  /**
   * Ký access token + refresh token song song (Promise.all thực sự).
   */
  async getTokensData(data: {
    id: User['id'];
    sessionId: Session['id'];
  }): Promise<{ token: string; refreshToken: string; tokenExpires: number }> {
    const tokenExpiresIn = this.configService.getOrThrow<string>('auth.expires', { infer: true });
    const tokenExpires = Date.now() + this.parseDurationToMs(tokenExpiresIn);

    const [token, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { id: data.id, sessionId: data.sessionId },
        {
          secret: this.configService.getOrThrow<string>('auth.secret', { infer: true }),
          expiresIn: tokenExpiresIn as never,
        },
      ),
      this.jwtService.signAsync(
        { id: data.id, sessionId: data.sessionId },
        {
          secret: this.configService.getOrThrow<string>('auth.refreshSecret', { infer: true }),
          expiresIn: this.configService.getOrThrow<string>('auth.refreshExpires', { infer: true }) as never,
        },
      ),
    ]);

    return { token, refreshToken, tokenExpires };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────

  /**
   * Refresh token từ sessionId + userId — dùng sau khi đã validate user vẫn còn hợp lệ.
   */
  async refreshBySession(
    data: Pick<JwtRefreshPayloadType, 'sessionId' | 'id'>,
  ): Promise<Omit<LoginResponseType, 'user'>> {
    this.logger.log(`Refreshing token for sessionId=${data.sessionId ?? 'missing'}`);

    const session = await this.sessionService.findOne({ where: { id: data.sessionId } });
    if (!session) {
      this.logger.warn(`Refresh failed: session not found for sessionId=${data.sessionId ?? 'missing'}`);
      throw new UnauthorizedException();
    }

    const userId = this.resolveUserId(session, data.id);
    if (!userId) {
      this.logger.warn(`Refresh failed: missing user reference for sessionId=${session.id}`);
      throw new UnauthorizedException();
    }

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: userId,
      sessionId: session.id,
    });

    this.logger.log(`Refresh succeeded for userId=${userId}, sessionId=${session.id}`);
    return { token, refreshToken, tokenExpires };
  }

  /**
   * Verify refresh token từ cookie, blacklist token cũ (rotation), rồi issue tokens mới.
   */
  async refreshFromCookie(refreshToken: string): Promise<Omit<LoginResponseType, 'user'>> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtRefreshPayloadType>(refreshToken, {
        secret: this.configService.getOrThrow<string>('auth.refreshSecret', { infer: true }),
      });

      // Blacklist token cũ ngay sau khi verify thành công — ngăn reuse sau rotation
      await this.tokenBlacklistService.blacklistToken(refreshToken, payload.exp);

      return this.refreshBySession({ sessionId: payload.sessionId, id: payload.id });
    } catch (error) {
      this.logger.warn('Refresh token verification failed from cookie', error);
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(data: { sessionId?: string; token?: string }): Promise<void> {
    if (data.sessionId) {
      await this.sessionService.softDelete({ id: data.sessionId });
    }
    if (data.token) {
      try {
        const decoded = this.jwtService.decode(data.token) as { exp?: number };
        await this.tokenBlacklistService.blacklistToken(data.token, decoded?.exp);
      } catch (err: any) {
        this.logger.warn(`Failed to blacklist token on logout: ${err?.message}`);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private parseDurationToMs(duration: string): number {
    try {
      return ttlToMilliseconds(duration);
    } catch {
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, errors: { auth: `invalidTokenExpires:${duration}` } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Lấy userId từ session.user (có thể là object hoặc string ID).
   */
  private resolveUserId(
    session: Session & { user?: { id?: User['id'] } | User['id'] | null; userId?: User['id'] },
    fallbackId?: User['id'],
  ): User['id'] | undefined {
    const u = (session as any).user;
    if (typeof u === 'string' && u.length > 0) return u;
    if (typeof u === 'object' && u && typeof u.id === 'string' && u.id.length > 0) return u.id;
    return fallbackId ?? (session as any).userId ?? undefined;
  }
}
