import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator.js';

type RequestUser = {
  id?: string;
  role?: string;
  effectivePermissions?: string[];
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user || !user.role) {
      return false;
    }

    const userRole = String(user.role).toUpperCase();
    if (userRole === 'ADMIN') {
      return true;
    }

    // 1. Kiểm tra khớp Role cơ bản
    if (requiredRoles.some((r) => r.toUpperCase() === userRole)) {
      return true;
    }

    // 2. Hỗ trợ Fine-grained RBAC: Nếu endpoint có gắn @RequirePermissions và người dùng đã được cấp quyền qua customPermissions
    const requiredAppPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      requiredAppPermissions &&
      requiredAppPermissions.length > 0 &&
      Array.isArray(user.effectivePermissions)
    ) {
      const hasPermission = requiredAppPermissions.every((p) =>
        user.effectivePermissions!.includes(p),
      );
      if (hasPermission) return true;
    }

    return false;
  }
}
