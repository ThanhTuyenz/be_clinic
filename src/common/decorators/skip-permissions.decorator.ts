import { SetMetadata } from '@nestjs/common';
import { CustomDecorator } from '@nestjs/common/decorators/core/set-metadata.decorator';

export const SKIP_PERMISSIONS_KEY = 'skipPermissions';

/**
 * Decorator dùng để bỏ qua bước kiểm tra quyền PermissionsGuard cho route hoặc controller
 */
export const SkipPermissions = (): CustomDecorator<string> =>
  SetMetadata(SKIP_PERMISSIONS_KEY, true);
