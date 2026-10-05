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
import rabbitMqConfig from './config/rabbitmq.config.js'
import redisConfig from './infrastructure/redis/redis.config.js'
import zaloZnsConfig from './config/zalo-zns.config.js'
import httpsmsConfig from './config/httpsms.config.js'
import { AppointmentsModule } from './modules/appointments/appointments.module.js'
import { AuthModule } from './modules/auth/auth-local/auth.module.js'
import { AuthGoogleModule } from './modules/auth/auth-google/auth-google.module.js'
import { AuthZaloModule } from './modules/auth/auth-zalo/auth-zalo.module.js'
import { JwtAuthCoreModule } from './modules/auth/jwt-auth-core/jwt-auth-core.module.js'
import { BookingModule } from './modules/bookings/booking.module.js'
import { BranchesModule } from './modules/branches/branches.module.js'
import { ClinicRoomsModule } from './modules/clinic-rooms/clinic-rooms.module.js'
import { DoctorsModule } from './modules/doctors/doctors.module.js'
import { PermissionsGuard } from './modules/auth/permissions/guards/permissions.guard.js'
import { JwtAuthGuard } from './modules/auth/auth-local/guards/jwt-auth.guard.js'
import { ContactsModule } from './modules/contacts/contacts.module.js'
import { PrismaModule } from './infrastructure/database/prisma/prisma.module.js'
import { RabbitMqModule } from './infrastructure/messaging/rabbitmq/rabbitmq.module.js'
import { RealtimeModule } from './infrastructure/realtime/realtime.module.js'
import { PatientsModule } from './modules/patients/patients.module.js'
import { PaymentsModule } from './modules/payments/payments.module.js'
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module.js'
import { SpecialtiesModule } from './modules/specialties/specialties.module.js'
import { SystemCatalogModule } from './modules/system-catalog/system-catalog.module.js'
import { SchedulesModule } from './modules/schedules/schedules.module.js'
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module.js'
import { VouchersModule } from './modules/vouchers/vouchers.module.js'
import { RecommendationModule } from './modules/recommendations/recommendation.module.js'
import { ZaloZnsModule } from './infrastructure/zalo-zns/zalo-zns.module.js'
import { HttpSmsModule } from './infrastructure/httpsms/httpsms.module.js'
import { MediaModule } from './infrastructure/media/media.module.js'
import { NotificationModule } from './modules/notifications/notification.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, authConfig, mailerConfig, googleConfig, geminiConfig, rabbitMqConfig, redisConfig, zaloZnsConfig, httpsmsConfig],
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
    JwtAuthCoreModule,
    AuthModule,
    AuthGoogleModule,
    AuthZaloModule,
    BookingModule,
    BranchesModule,
    DoctorsModule,
    ClinicRoomsModule,
    AppointmentsModule,
    ContactsModule,
    RabbitMqModule,
    RealtimeModule,
    PatientsModule,
    PaymentsModule,
    AdminDashboardModule,
    SpecialtiesModule,
    SystemCatalogModule,
    SchedulesModule,
    AiAssistantModule,
    VouchersModule,
    RecommendationModule,
    ZaloZnsModule,
    HttpSmsModule,
    MediaModule,
    NotificationModule,
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
