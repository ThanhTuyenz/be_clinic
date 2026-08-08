import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Services } from 'src/common/utils/constants';
import { RolesModule } from '../../roles/roles.module';
import { HistoryModule } from '../../history/history.module';
import { PermissionsModule } from '../../permissions/permissions.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RolesModule, HistoryModule, PermissionsModule],
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
