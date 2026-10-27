import { PermissionResourceTarget } from '../enums/resource-target.enum.js';
import { PermissionAction } from '../enums/action.enum.js';
import { PermissionEffect } from '../enums/effect.enum.js';

export interface Permission {
  readonly resourceType?: string;
  readonly resourceTarget: PermissionResourceTarget | string;
  readonly action: PermissionAction;
  readonly effect: PermissionEffect;
}
