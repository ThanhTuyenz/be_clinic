import { Module } from '@nestjs/common'
import { ExaminationsController } from '../../controllers/examinations.controller.js'
import { ExaminationsService } from './examinations.service.js'

@Module({
  controllers: [ExaminationsController],
  providers: [ExaminationsService],
})
export class ExaminationsModule {}
