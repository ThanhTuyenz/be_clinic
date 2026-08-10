import { Module } from '@nestjs/common'
import { BranchesController, DoctorsController, PublicDirectoryController } from '../../controllers/doctors.controller.js'
import { DirectoryService } from './directory.service.js'

@Module({
  controllers: [DoctorsController, BranchesController, PublicDirectoryController],
  providers: [DirectoryService],
})
export class DoctorsModule {}
