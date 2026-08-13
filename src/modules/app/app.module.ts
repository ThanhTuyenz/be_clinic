import { Module } from '@nestjs/common'
import { AppController } from '../../controllers/app.controller.js'

@Module({
  controllers: [AppController],
})
export class AppFeatureModule {}