import { SetMetadata } from '@nestjs/common'
import { AppPermission } from '../../modules/auth/permissions/constants/permissions.constant.js'

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions'

export const RequirePermissions = (...permissions: (AppPermission | string)[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions)
