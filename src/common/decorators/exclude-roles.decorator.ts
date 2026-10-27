import { SetMetadata } from '@nestjs/common';

export const EXCLUDED_ROLES_KEY = 'excluded_roles';

export const ExcludeRoles = (...roles: string[]) =>
  SetMetadata(EXCLUDED_ROLES_KEY, roles);
