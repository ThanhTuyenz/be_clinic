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

type JwtPayload = {
  id: string;
  sessionId?: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
};

type RequestUser = {
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Try to get token from cookie first, then Authorization header, then query parameter
    let token: string | undefined;

    if (request.cookies?.token) {
      token = request.cookies.token;
    } else {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      } else if (request.query?.token && typeof request.query.token === 'string') {
        token = request.query.token;
      }
    }

    // Với route Public, nếu có token thì giải mã gắn vào user, nếu không có thì vẫn cho qua
    if (isPublic) {
      if (token) {
        try {
          const isBlacklisted = await this.tokenBlacklistService.isTokenBlacklisted(token);
          if (!isBlacklisted) {
            const decoded = this.jwtService.verify<JwtPayload>(token);
            if (decoded?.id) {
              const isRevoked = await this.tokenBlacklistService.isUserRevoked(decoded.id, decoded.iat);
              if (!isRevoked) {
                request.user = {
                  id: decoded.id,
                  sessionId: decoded.sessionId || '',
                  email: decoded.email,
                  role: decoded.role,
                  userType: decoded.role,
                };
              }
            }
          }
        } catch {
          // Token không hợp lệ trên public route thì bỏ qua
        }
      }
      return true;
    }

    if (!token) {
      this.logger.warn('Không tìm thấy token trong cookie hoặc Authorization header.');
      throw new UnauthorizedException('Token không hợp lệ hoặc thiếu');
    }

    // 1. Kiểm tra Token Blacklist (đã Logout chưa)
    const isBlacklisted = await this.tokenBlacklistService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      this.logger.warn('Token đã bị thu hồi (nằm trong Blacklist).');
      throw new UnauthorizedException('Token đã bị thu hồi, vui lòng đăng nhập lại');
    }

    try {
      const decoded = this.jwtService.verify<JwtPayload>(token);

      if (!decoded?.id) {
        this.logger.warn('Token thiếu thông tin user id.');
        throw new UnauthorizedException('Token không hợp lệ hoặc thiếu');
      }

      // 2. Kiểm tra tài khoản có bị thu hồi toàn bộ phiên (Đổi mật khẩu / Khóa tài khoản)
      const isRevoked = await this.tokenBlacklistService.isUserRevoked(decoded.id, decoded.iat);
      if (isRevoked) {
        this.logger.warn(`Token của user ${decoded.id} đã bị vô hiệu do thay đổi bảo mật.`);
        throw new UnauthorizedException('Phiên đăng nhập đã hết hiệu lực do thay đổi bảo mật');
      }

      const requestUser: RequestUser = {
        id: decoded.id,
        sessionId: decoded.sessionId || '',
        email: decoded.email,
        role: decoded.role,
        userType: decoded.role,
      };

      if (!requestUser.email || !requestUser.role) {
        const user = await this.usersService.findOneUser({ id: decoded.id });
        if (!user) {
          this.logger.warn(`Không tìm thấy user với id=${decoded.id}`);
          throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
        }
        if (user.isDeleted) {
          this.logger.warn(`User đã bị xóa mềm, id=${decoded.id}`);
          throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
        }
        if (user.isBlocked) {
          this.logger.warn(`User đã bị khóa, id=${decoded.id}`);
          throw new UnauthorizedException('Tài khoản đã bị khóa');
        }

        requestUser.email = user.email ?? undefined;
        requestUser.role = user.role ?? undefined;
        requestUser.userType = user.role ?? undefined;
      }

      requestUser.userType ||= requestUser.role;
      request.user = requestUser;
      return true;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Lỗi xác thực token: ${error.message}`);
      }
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
  }
}
