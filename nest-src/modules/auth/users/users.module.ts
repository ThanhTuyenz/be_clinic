import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { Services } from 'src/common/utils/constants';
import { RolesModule } from '../../roles/roles.module';
import { HistoryModule } from '../../history/history.module';
import { PermissionsModule } from '../../permissions/permissions.module';

@Module({
  imports: [RolesModule, HistoryModule, PermissionsModule],
  controllers: [UsersController],
  providers: [
    {
      provide: Services.USERS,
      useClass: UsersService,
    },
  ],
  exports: [
    {
      provide: Services.USERS,
      useClass: UsersService,
    },
  ],
})
export class UsersModule {}
