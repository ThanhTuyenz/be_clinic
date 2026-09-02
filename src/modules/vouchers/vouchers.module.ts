import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { VouchersController } from './vouchers.controller.js';
import { VouchersService } from './vouchers.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
