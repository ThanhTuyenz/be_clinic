import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { Services } from 'src/common/utils/constants';

@Module({
  providers: [
    {
      provide: Services.SESSION,
      useClass: SessionService,
    },
  ],
  exports: [
    {
      provide: Services.SESSION,
      useClass: SessionService,
    },
  ],
})
export class SessionModule {}
