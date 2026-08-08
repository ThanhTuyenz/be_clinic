import 'reflect-metadata'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import express from 'express'
import { VersioningType, ValidationPipe } from '@nestjs/common'
import { type NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import morgan from 'morgan'
import { AppModule } from './app.module.js'
import { AllExceptionFilter } from './common/filters/all-exception.filter.js'
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js'
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor.js'
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor.js'
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js'
import validationOptions from './common/utils/validation-options.js'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

type AppConfigValue = {
  apiPrefix?: string
  frontendDomain?: string
  port?: number
}

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule)
    const expressApp = app.getHttpAdapter().getInstance()
    const configService = app.get(ConfigService)
    const appConfig = configService.get<AppConfigValue>('app')
    const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS') || '*'
    const nodeEnv = configService.get<string>('NODE_ENV') || 'development'
    const port = appConfig?.port || configService.get<number>('PORT') || 5000
    const mediaLocalDir = configService.get<string>('MEDIA_LOCAL_DIR') || 'uploads'

    const corsOriginRaw =
      process.env.CORS_ORIGIN || appConfig?.frontendDomain || allowedOrigins
    const corsAllowlist = String(corsOriginRaw)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    expressApp.set('etag', false)
    expressApp.set('trust proxy', 1)

    app.useGlobalFilters(new AllExceptionFilter(), new HttpExceptionFilter())
    app.use(cookieParser())
    app.use(
      helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
          },
        },
      }),
    )

    app.useGlobalInterceptors(
      new LoggingInterceptor(),
      new MetricsInterceptor(),
      new TimeoutInterceptor(),
      new TransformInterceptor(),
    )

    app.enableCors({
      origin(origin, callback) {
        if (!origin) return callback(null, true)
        if (corsAllowlist.includes('*')) return callback(null, true)
        if (corsAllowlist.includes(origin)) return callback(null, true)
        return callback(new Error(`CORS blocked for origin: ${origin}`), false)
      },
      credentials: true,
      methods: ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'X-Webhook-Signature',
        'Accept',
        'Cache-Control',
      ],
      exposedHeaders: ['Content-Type', 'Cache-Control', 'Connection', 'X-Accel-Buffering'],
    })

    app.use(morgan('combined', { skip: () => nodeEnv === 'test' }))

    app.use(
      express.json({
        limit: '10mb',
        verify: (req: any, _res, buf: Buffer) => {
          req.rawBody = buf
        },
      }),
    )
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    app.use('/api', (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store')
      next()
    })

    app.use(`/${mediaLocalDir}`, express.static(join(process.cwd(), mediaLocalDir)))

    app.setGlobalPrefix(appConfig?.apiPrefix || 'api')

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    })

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Clinic API')
      .setDescription(
        'API cho hệ thống đặt lịch hẹn và quản lý khám bệnh trực tuyến đa bệnh viện.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Nhập access token, không cần thêm tiền tố Bearer',
        },
        'access-token',
      )
      .addTag('System', 'Kiểm tra trạng thái hệ thống')
      .addTag('Auth', 'Đăng ký, đăng nhập và quản lý phiên')
      .addTag('Users', 'Quản lý người dùng và phân quyền')
      .addTag('Appointments', 'Đặt lịch và quản lý lịch khám')
      .addTag('Doctors', 'Danh sách bác sĩ')
      .addTag('Clinic rooms', 'Danh sách phòng khám')
      .addTag('Examinations', 'Hồ sơ khám bệnh')
      .addTag('Permissions', 'Quyền của người dùng hiện tại')
      .build()
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('docs', app, swaggerDocument, {
      jsonDocumentUrl: 'docs-json',
      customSiteTitle: 'Clinic API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
      },
    })

    app.useGlobalPipes(new ValidationPipe(validationOptions))

    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads',
    })

    await app.listen(port)

    console.log(`Server running on port ${port}`)
    console.log(`Environment: ${nodeEnv}`)
    console.log(`API Allows Using: ${corsAllowlist.join(', ')}`)
    console.log(`Swagger documentation: http://localhost:${port}/docs`)

    const signals = ['SIGTERM', 'SIGINT']
    signals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`${signal} received, shutting down gracefully`)
        await app.close()
        console.log('Process terminated')
        process.exit(0)
      })
    })
  } catch (error) {
    console.error('Error starting application:', error)
    process.exit(1)
  }
}

void bootstrap()
