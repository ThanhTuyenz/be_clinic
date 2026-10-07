import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Services } from 'src/common/utils/constants';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import type { IUsersService } from 'src/modules/auth/users/users';
import { TokenBlacklistService } from '../../jwt-auth-core/token-blacklist.service.js';
import { RedisService } from '../../../../infrastructure/redis/redis.service.js';

type JwtPayload = {
  id: string;
  sessionId?: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
};

type CachedUserStatus = {
  email?: string | null;
  role?: string | null;
  isBlocked: boolean;
  isDeleted: boolean;
};

export type RequestUser = {
  id: string;
  sessionId: string;
  email?: string;
  role?: string;
  userType?: string;
  permissions?: string[];
};

interface RequestWithUser extends Request {
  user?: RequestUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(Services.USERS) private readonly usersService: IUsersService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly redis: RedisService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Token không hợp lệ hoặc thiếu');
    }

    try {
      const user = await this.validateAndBuildUser(token);
      request.user = user;
      return true;
    } catch (error) {
      // Nếu là public route mà token lỗi/hết hạn thì vẫn cho qua bình thường
      if (isPublic) {
        return true;
      }
      // Giữ nguyên exception cụ thể (ví dụ: đã bị khóa, đã bị thu hồi)
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Lỗi xác thực token: ${(error as Error).message}`);
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
  }

  // 1. Tách riêng logic bóc tách token
  private extractToken(request: Request): string | undefined {
    if (request.cookies?.token) return request.cookies.token;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }

    if (typeof request.query?.token === 'string') {
      return request.query.token;
    }
    return undefined;
  }

  // 2. Gom toàn bộ pipeline xác thực token & user về một chỗ
  private async validateAndBuildUser(token: string): Promise<RequestUser> {
    // Check blacklist token (logout)
    const isBlacklisted = await this.tokenBlacklistService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new UnauthorizedException('Token đã bị thu hồi, vui lòng đăng nhập lại');
    }

    // Verify chữ ký và hạn dùng JWT
    const decoded = this.jwtService.verify<JwtPayload>(token);
    if (!decoded?.id) {
      throw new UnauthorizedException('Token không hợp lệ');
    }

    // Check đổi mật khẩu / thu hồi toàn bộ session theo iat
    const isRevoked = await this.tokenBlacklistService.isUserRevoked(decoded.id, decoded.iat);
    if (isRevoked) {
      throw new UnauthorizedException('Phiên đăng nhập đã hết hiệu lực do thay đổi bảo mật');
    }

    // Cache user status trong Redis 60s để tránh DB hit mỗi request
    // Khi admin block/soft-delete user → gọi invalidateUserStatusCache(userId) để xóa cache ngay
    const cacheKey = `user:status:${decoded.id}`;
    let status = await this.redis.get<CachedUserStatus>(cacheKey);

    if (!status) {
      const user = await this.usersService.findOneUser({ id: decoded.id });
      if (!user) {
        throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
      }
      status = {
        email: user.email,
        role: user.role ?? undefined,
        isBlocked: user.isBlocked ?? false,
        isDeleted: user.isDeleted ?? false,
      };
      // Cache 60 giây — đủ ngắn để phát hiện block, đủ dài để giảm tải DB
      await this.redis.set(cacheKey, status, 60);
    }

    if (status.isDeleted) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
    }
    if (status.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    return {
      id: decoded.id,
      sessionId: decoded.sessionId || '',
      email: status.email ?? decoded.email,
      role: status.role ?? decoded.role,
      userType: status.role ?? decoded.role,
    };
  }
}