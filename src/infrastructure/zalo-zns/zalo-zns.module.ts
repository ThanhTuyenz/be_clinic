import { Module } from '@nestjs/common';
import { ZaloZnsService } from './zalo-zns.service.js';

@Module({
  providers: [ZaloZnsService],
  exports: [ZaloZnsService],
})
export class ZaloZnsModule {}
