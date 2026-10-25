import { Module } from '@nestjs/common';
import { HttpSmsService } from './httpsms.service.js';

@Module({
  providers: [HttpSmsService],
  exports: [HttpSmsService],
})
export class HttpSmsModule {}
