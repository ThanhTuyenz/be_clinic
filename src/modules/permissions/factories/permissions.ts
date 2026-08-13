import { Inject, Injectable } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request as ExpressRequest } from 'express';

import {
  PermissionAction,
  PermissionResourceTarget,
  PermissionResource,
} from '../enums';
import {
  generatePermission,
  grantedMatchRequired,
} from '../permissions.helpers';

export const PERMISSIONS = Symbol('PERMISSIONS');

@Injectable()
export class Permissions {
  constructor(@Inject(REQUEST) private readonly request: ExpressRequest) {}

  /**
   * In-controller helper for permissions checks after the initial
   * decorator-based permission has been evaluated
   * @param requiredPermission the permission to evaluate against
   * @returns true if the current user has the required permission
   */
  canActivate(
    resourceType: PermissionResource,
    action: PermissionAction,
    target: PermissionResourceTarget | string,
  ): boolean {
    if (!this.context) {
      return false;
    }
    const requiredPermission = generatePermission(resourceType, action, target);
    return grantedMatchRequired(
      this.context.grantedPermissions,
      requiredPermission,
    );
  }

  get allowedResourcesIds(): string[] | null {
    return this.context?.allowedResourcesIds ?? null;
  }

  get deniedResourcesIds(): string[] | null {
    return this.context?.deniedResourcesIds ?? null;
  }

  private get context(): ExpressRequest['permissionsContext'] | undefined {
    return this.request.permissionsContext;
  }
}
