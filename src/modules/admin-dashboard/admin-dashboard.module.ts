import { Module } from '@nestjs/common'
import { AdminDashboardController } from './admin-dashboard.controller.js'
import { AdminDashboardService } from './admin-dashboard.service.js'
import { ReceptionDashboardController } from './reception-dashboard.controller.js'
import { ReceptionDashboardService } from './reception-dashboard.service.js'
import { DoctorDashboardController } from './doctor-dashboard.controller.js'
import { DoctorDashboardService } from './doctor-dashboard.service.js'

@Module({
  controllers: [
    AdminDashboardController,
    ReceptionDashboardController,
    DoctorDashboardController,
  ],
  providers: [
    AdminDashboardService,
    ReceptionDashboardService,
    DoctorDashboardService,
  ],
})
export class AdminDashboardModule {}

