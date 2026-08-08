import { Module } from '@nestjs/common'
import { BranchesController, DoctorsController } from '../../controllers/doctors.controller.js'
import { DirectoryService } from './directory.service.js'

@Module({
  controllers: [DoctorsController, BranchesController],
  providers: [DirectoryService],
})
export class DoctorsModule {}
