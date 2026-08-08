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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.log('Public route, skipping authentication');
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    // Try to get token from cookie first, then Authorization header, then query parameter
    let token: string | undefined;

    if (request.cookies?.token) {
      token = request.cookies.token;
      this.logger.log('Token found in cookie');
    } else {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
        this.logger.log('Token found in Authorization header');
      } else if (request.query?.token && typeof request.query.token === 'string') {
        token = request.query.token;
        this.logger.log('Token found in query parameter');
      }
    }

    if (!token) {
      this.logger.warn(
        'Không tìm thấy token trong cookie hoặc Authorization header.',
      );
      throw new UnauthorizedException('Token không hợp lệ hoặc thiếu');
    }

    try {
      const decoded = this.jwtService.verify<JwtPayload>(token);

      if (!decoded?.id) {
        this.logger.warn('Token thiếu thông tin user id.');
        throw new UnauthorizedException('Token không hợp lệ hoặc thiếu');
      }

      const requestUser: RequestUser = {
        id: decoded.id,
        sessionId: decoded.sessionId || '',
        email: decoded.email,
        role: decoded.role,
      };

      // Token hiện tại chỉ có { id, sessionId } nên cần fallback lấy thêm thông tin.
      if (!requestUser.email || !requestUser.role) {
        const user = await this.usersService.findOneUser({ id: decoded.id });
        if (!user) {
          this.logger.warn(`Không tìm thấy user với id=${decoded.id}`);
          throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
        }
        if (user.isDeleted) {
          this.logger.warn(`User đã bị xóa mềm, id=${decoded.id}`);
          throw new UnauthorizedException(
            'Tài khoản không tồn tại hoặc đã bị xóa',
          );
        }
        if (user.isBlocked) {
          this.logger.warn(`User đã bị khóa, id=${decoded.id}`);
          throw new UnauthorizedException('Tài khoản đã bị khóa');
        }

        requestUser.email = user.email ?? undefined;
        requestUser.role = user.role ?? undefined;
      }

      request.user = requestUser;
      this.logger.log(`Xác thực thành công: ID ${decoded.id}`);

      return true;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Lỗi xác thực token: ${error.message}`);
      } else {
        this.logger.error(`Lỗi xác thực token: Không xác định`);
      }
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
  }
}
