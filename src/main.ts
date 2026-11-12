import 'reflect-metadata'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
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
import type { AppConfig } from './config/config.type.js'

async function bootstrap() {
  try {
    const logLevels = (process.env.LOG_LEVEL || 'log')
      .split(',')
      .map(l => l.trim()) as ('log' | 'error' | 'warn' | 'debug' | 'verbose')[];
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: logLevels })
    const expressApp = app.getHttpAdapter().getInstance()
    const configService = app.get(ConfigService)
    const { apiPrefix, frontendDomain, port, nodeEnv } = configService.getOrThrow<AppConfig>('app')
    const allowedOrigins = configService.get<string>('ALLOWED_ORIGINS') || '*'
    const mediaLocalDir = configService.get<string>('MEDIA_LOCAL_DIR') || 'uploads'

    const corsAllowlist = [...new Set(
      [configService.get<string>('CORS_ORIGIN'), frontendDomain, allowedOrigins]
        .flatMap((origins) => origins?.split(',') || [])
        .map((origin) => origin.trim())
        .filter(Boolean),
    )]

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
        // Tự động cho phép tất cả các domain Vercel và Ngrok
        if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true)
        if (/^https:\/\/.*\.ngrok(-free)?\.(app|dev)$/.test(origin)) return callback(null, true)
        if (/^https:\/\/.*\.ngrok\.io$/.test(origin)) return callback(null, true)
        if (nodeEnv !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true)
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

    app.useBodyParser('json', { limit: '10mb' })
    app.useBodyParser('urlencoded', { extended: true, limit: '10mb' })

    app.use(`/${apiPrefix}`, (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store')
      next()
    })

    for (const directory of new Set([mediaLocalDir, 'uploads'])) {
      app.useStaticAssets(join(process.cwd(), directory), { prefix: `/${directory}` })
    }

    app.setGlobalPrefix(apiPrefix)

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    })

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Clinic API')
      .setDescription(
        'API cho hệ thống một phòng khám đa cơ sở, đặt lịch, thanh toán và check-in.',
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
      .addTag('Auth', 'Đăng ký, đăng nhập và quản lý phiên')
      .addTag('Users', 'Quản lý người dùng và phân quyền')
      .addTag('Appointments', 'Đặt lịch và quản lý lịch khám')
      .addTag('Doctors', 'Danh sách bác sĩ')
      .addTag('Clinic rooms', 'Danh sách phòng khám')
      .addTag('Permissions', 'Quyền của người dùng hiện tại')
      .addTag('Payments', 'Thanh toán phí khám và webhook')
      .addTag('Branches', 'Danh sách cơ sở')
      .addTag('Patient profiles', 'Hồ sơ bệnh nhân và người thân')
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

    app.enableShutdownHooks(['SIGTERM', 'SIGINT'])

    await app.listen(port)

    console.log(`Server running on port ${port}`)
    console.log(`Environment: ${nodeEnv}`)
    console.log(`API Allows Using: ${corsAllowlist.join(', ')}`)
    console.log(`Swagger documentation: http://localhost:${port}/docs`)
  } catch (error) {
    console.error('Error starting application:', error)
    process.exit(1)
  }
}

void bootstrap()
