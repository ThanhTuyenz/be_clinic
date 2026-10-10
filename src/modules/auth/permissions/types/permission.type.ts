import {
  PermissionResourceTarget,
  PermissionAction,
  PermissionEffect,
} from '../enums';

export interface Permission {
  readonly resourceType?: string;
  readonly resourceTarget: PermissionResourceTarget | string;
  readonly action: PermissionAction;
  readonly effect: PermissionEffect;
}
