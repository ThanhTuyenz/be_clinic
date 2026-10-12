import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request as ExpressRequest } from 'express';
import { REQUIRE_PERMISSIONS_KEY } from '../../../../common/decorators/require-permissions.decorator.js';
import { SKIP_PERMISSIONS_KEY } from '../../../../common/decorators/skip-permissions.decorator.js';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator.js';
import { AppPermission } from '../constants/permissions.constant.js';
import { PermissionsService } from '../permissions.service.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Bỏ qua nếu route được đánh dấu @SkipPermissions()
    const skipPermissions = this.reflector.getAllAndOverride<boolean>(
      SKIP_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipPermissions) {
      return true;
    }

    // 2. Bỏ qua nếu route công khai @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ExpressRequest>();
    const user = request.user as { id?: string; role?: string } | undefined;

    if (!user || !user.id || !user.role) {
      this.logger.warn('No authenticated user found in request');
      return false;
    }

    const userRole = String(user.role).toUpperCase();

    // 3. Admin luôn có toàn quyền trên toàn hệ thống
    if (userRole === 'ADMIN') {
      (request.user as any).effectivePermissions = Object.values(AppPermission);
      return true;
    }

    // 4. Kiểm tra quyền nguyên tử theo chuẩn RBAC (@RequirePermissions)
    const requiredPermissions = this.reflector.getAllAndOverride<(AppPermission | string)[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermissions && requiredPermissions.length > 0) {
      const userPerms = await this.permissionsService.getUserPermissions(user.id);
      (request.user as any).effectivePermissions = userPerms.effectivePermissions;

      const hasAllPermissions = requiredPermissions.every((p) =>
        userPerms.effectivePermissions.includes(String(p)),
      );

      if (!hasAllPermissions) {
        this.logger.warn(
          `Permission denied for user ${user.id} (${userRole}). Required: ${requiredPermissions.join(', ')}`,
        );
        throw new ForbiddenException(
          `Bạn không có quyền thực hiện thao tác này (${requiredPermissions.join(', ')})`,
        );
      }

      return true;
    }

    return true;
  }
}
