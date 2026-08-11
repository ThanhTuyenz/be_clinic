import {
  PermissionResource,
  PermissionResourceTarget,
  PermissionAction,
  PermissionEffect,
} from '../enums';

export interface Permission {
  readonly resourceType: PermissionResource;
  readonly resourceTarget: PermissionResourceTarget | string;
  readonly action: PermissionAction;
  readonly effect: PermissionEffect;
}
