import { Module } from '@nestjs/common'
import { Services } from 'src/common/utils/constants'
import { MailsService } from './mails.service.js'

@Module({
  providers: [
    MailsService,
    {
      provide: Services.MAILS,
      useClass: MailsService,
    },
  ],
  exports: [
    MailsService,
    {
      provide: Services.MAILS,
      useClass: MailsService,
    },
  ],
})
export class MailsModule {}