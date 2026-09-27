import { SetMetadata } from '@nestjs/common'
import { AppPermission } from '../constants/permissions.constant.js'

export const REQUIRE_PERMISSIONS_KEY = 'require_permissions'

/**
 * Decorator yêu cầu một hoặc nhiều quyền nguyên tử (Permissions) để truy cập API endpoint
 * Ví dụ: @RequirePermissions(AppPermission.APPOINTMENT_CANCEL)
 */
export const RequirePermissions = (...permissions: (AppPermission | string)[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions)
