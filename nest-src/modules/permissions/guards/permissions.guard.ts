import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request as ExpressRequest } from 'express';
import { isUUID } from 'class-validator';

import {
  REQUIRED_PERMISSION,
  RequiredPermission,
} from '../decorators/permissions.decorator';
import { SKIP_PERMISSIONS_KEY } from '../decorators/skip-permissions.decorator';
import {
  PermissionEffect,
  PermissionResourceTarget,
  PermissionRole,
} from '../enums';
import {
  getPermittedResourcesIds,
  grantedMatchRequired,
} from '../permissions.helpers';
import { PermissionsService } from '../permissions.service';
import { Permission } from '../types/permission.type';
import {
  InsufficientPermissionsException,
  InvalidResourceIdException,
  MissingPermissionDefinitionException,
} from '../exceptions/permission.exceptions';
import { AuditLogService } from '../services/audit-log.service';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if permissions should be skipped
    const skipPermissions = this.reflector.getAllAndOverride<boolean>(
      SKIP_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipPermissions) {
      this.logger.log('Skipping permission check for this route');
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ExpressRequest>();

    const userRole = request.user?.role;

    if (!userRole) {
      this.logger.warn('No user found in request');
      return false;
    }

    if (userRole === PermissionRole.ADMIN) {
      return true;
    }

    // const request = context.switchToHttp().getRequest() as ExpressRequest;

    if (!request.user?.id) {
      this.logger.warn('No user found in request');
      return false;
    }

    const requiredPermission = this.getRequiredPermission(context);
    const ipAddress = this.getClientIp(request);
    const userAgent = request.headers['user-agent'];

    const { role, permissions: grantedPermissions } =
      await this.permissionsService.getMany(request.user.id);

    if (!grantedPermissions.length) {
      this.logger.warn(`No permissions found for user ${request.user.id}`);

      this.auditLogService.logPermissionDenied(
        request.user.id,
        request.user.email,
        request.user.role,
        requiredPermission,
        'No permissions found for user',
        ipAddress,
        userAgent,
      );

      throw new InsufficientPermissionsException(
        requiredPermission.resourceType,
        requiredPermission.action,
        requiredPermission.resourceTarget,
      );
    }

    const permitted = grantedMatchRequired(
      grantedPermissions,
      requiredPermission,
    );

    if (!permitted) {
      this.logger.warn(
        `Permission denied for user ${request.user.id}: ${requiredPermission.action} on ${requiredPermission.resourceType}:${requiredPermission.resourceTarget}`,
      );

      this.auditLogService.logPermissionDenied(
        request.user.id,
        request.user.email,
        request.user.role,
        requiredPermission,
        'Insufficient permissions',
        ipAddress,
        userAgent,
      );

      throw new InsufficientPermissionsException(
        requiredPermission.resourceType,
        requiredPermission.action,
        requiredPermission.resourceTarget,
      );
    }

    let allowedResourcesIds: string[] | null = null;
    let deniedResourcesIds: string[] | null = null;

    if (requiredPermission.resourceTarget === PermissionResourceTarget.SOME) {
      if ([PermissionRole.PATIENT, PermissionRole.EMPLOYEE].includes(role)) {
        allowedResourcesIds = getPermittedResourcesIds(
          grantedPermissions,
          requiredPermission,
          PermissionEffect.ALLOW,
        );
      } else if (role === PermissionRole.ADMIN) {
        deniedResourcesIds = getPermittedResourcesIds(
          grantedPermissions,
          requiredPermission,
          PermissionEffect.DENY,
        );
      }
    }

    request.permissionsContext = {
      allowedResourcesIds,
      deniedResourcesIds,
      grantedPermissions,
    };

    this.auditLogService.logPermissionGranted(
      request.user.id,
      request.user.email,
      request.user.role,
      requiredPermission,
      ipAddress,
      userAgent,
    );

    this.logger.log(
      `Permission granted for user ${request.user.id}: ${requiredPermission.action} on ${requiredPermission.resourceType}:${requiredPermission.resourceTarget}`,
    );

    return true;
  }

  /**
   * Computes permission required to access controller action, based on
   * controller permissions decorator. If resource target is dynamic (based on
   * incoming request), evaluate it.
   * @param context request context
   * @returns computed required permission
   */
  private getRequiredPermission(context: ExecutionContext): Permission {
    const permission = this.reflector.get<RequiredPermission>(
      REQUIRED_PERMISSION,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest();

    if (!permission) {
      throw new MissingPermissionDefinitionException(
        request.method,
        request.url,
      );
    }

    if (permission.resourceTarget instanceof Function) {
      const resourceId = permission.resourceTarget(request);

      if (!isUUID(resourceId)) {
        throw new InvalidResourceIdException(
          resourceId,
          'Resource ID must be a valid UUID',
        );
      }

      return {
        ...permission,
        resourceTarget: resourceId,
      };
    }

    return permission as Permission;
  }

  /**
   * Extract client IP address from request
   */
  private getClientIp(request: ExpressRequest): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    }
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
