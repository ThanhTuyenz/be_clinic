import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { IntegrationsController } from './integrations.controller.js'
import { IntegrationsService } from './integrations.service.js'

@Module({ imports: [ConfigModule], controllers: [IntegrationsController], providers: [IntegrationsService] })
export class IntegrationsModule {}
