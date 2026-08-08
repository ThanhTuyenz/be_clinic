import { SetMetadata } from '@nestjs/common';
import { CustomDecorator } from '@nestjs/common/decorators/core/set-metadata.decorator';

export const SKIP_PERMISSIONS_KEY = 'skipPermissions';

export const SkipPermissions = (): CustomDecorator<string> =>
  SetMetadata(SKIP_PERMISSIONS_KEY, true);
