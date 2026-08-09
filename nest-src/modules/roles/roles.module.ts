import { Module } from '@nestjs/common'
import { Services } from 'src/common/utils/constants'
import { RolesService } from './roles.service.js'

@Module({
  providers: [
    {
      provide: Services.ROLES,
      useClass: RolesService,
    },
  ],
  exports: [
    {
      provide: Services.ROLES,
      useClass: RolesService,
    },
  ],
})
export class RolesModule {}