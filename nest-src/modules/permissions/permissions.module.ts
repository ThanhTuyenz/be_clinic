import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/users/entities/user.entity';
import { RolesModule } from '../roles/roles.module';

import { Permissions, PERMISSIONS } from './factories/permissions';
import { PermissionsFactory } from './factories/permissions.factory';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { AuditLogService } from './services/audit-log.service';
import { PermissionsCacheService } from './services/permissions-cache.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User]), RolesModule],
  providers: [
    PermissionsService,
    Permissions,
    PermissionsFactory,
    AuditLogService,
    PermissionsCacheService,
  ],
  controllers: [PermissionsController],
  exports: [
    PermissionsService,
    PERMISSIONS,
    AuditLogService,
    PermissionsCacheService,
  ],
})
export class PermissionsModule {}
