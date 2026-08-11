import { Module } from '@nestjs/common';
import { ForgotPasswordService } from './forgot-password.service';
import { Services } from 'src/common/utils/constants';

@Module({
  providers: [
    {
      provide: Services.FORGOT_PASSWORD,
      useClass: ForgotPasswordService,
    },
  ],
  exports: [
    {
      provide: Services.FORGOT_PASSWORD,
      useClass: ForgotPasswordService,
    },
  ],
})
export class ForgotPasswordModule {}
