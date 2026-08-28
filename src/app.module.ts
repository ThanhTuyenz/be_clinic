import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import appConfig from './config/app.config.js'
import authConfig from './config/auth.config.js'
import googleConfig from './config/google.config.js'
import geminiConfig from './config/gemini.config.js'
import mailerConfig from './config/mailer.config.js'
import rabbitMqConfig from './infrastructure/messaging/rabbitmq/rabbitmq.config.js'
import redisConfig from './infrastructure/cache/redis/redis.config.js'
import { AppFeatureModule } from './modules/app/app.module.js'
import { AppointmentsModule } from './modules/appointments/appointments.module.js'
import { AuthModule } from './modules/auth/auth-local/auth.module.js'
import { JwtAuthCoreModule } from './modules/auth/jwt-auth-core/jwt-auth-core.module.js'
import { ClinicRoomsModule } from './modules/clinic-rooms/clinic-rooms.module.js'
import { DoctorsModule } from './modules/doctors/doctors.module.js'
import { PermissionsGuard } from './modules/permissions/guards/permissions.guard.js'
import { JwtAuthGuard } from './modules/auth/auth-local/guards/jwt-auth.guard.js'
import { ContactsModule } from './modules/contacts/contacts.module.js'
import { PrismaModule } from './infrastructure/database/prisma/prisma.module.js'
import { RabbitMqModule } from './infrastructure/messaging/rabbitmq/rabbitmq.module.js'
import { PatientsModule } from './modules/patients/patients.module.js'
import { PaymentsModule } from './modules/payments/payments.module.js'
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module.js'
import { SpecialtiesModule } from './modules/specialties/specialties.module.js'
import { SystemCatalogModule } from './modules/system-catalog/system-catalog.module.js'
import { SchedulesModule } from './modules/schedules/schedules.module.js'
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, authConfig, mailerConfig, googleConfig, geminiConfig, rabbitMqConfig, redisConfig],
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),

    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 1000,
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    // RedisModule,
    AppFeatureModule,
    JwtAuthCoreModule,
    AuthModule,
    DoctorsModule,
    ClinicRoomsModule,
    AppointmentsModule,
    ContactsModule,
    RabbitMqModule,
    PatientsModule,
    PaymentsModule,
    AdminDashboardModule,
    SpecialtiesModule,
    SystemCatalogModule,
    SchedulesModule,
    AiAssistantModule,
  ],

  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
