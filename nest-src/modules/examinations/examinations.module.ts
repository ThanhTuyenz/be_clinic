import { Module } from '@nestjs/common'
import { ExaminationsController } from '../../controllers/examinations.controller.js'

@Module({
  controllers: [ExaminationsController],
})
export class ExaminationsModule {}
