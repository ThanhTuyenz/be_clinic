"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const node_path_1 = require("node:path");
const core_1 = require("@nestjs/core");
const express_1 = __importDefault(require("express"));
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const app_module_js_1 = require("./app.module.js");
const all_exception_filter_js_1 = require("./common/filters/all-exception.filter.js");
const http_exception_filter_js_1 = require("./common/filters/http-exception.filter.js");
const logging_interceptor_js_1 = require("./common/interceptors/logging.interceptor.js");
const metrics_interceptor_js_1 = require("./common/interceptors/metrics.interceptor.js");
const timeout_interceptor_js_1 = require("./common/interceptors/timeout.interceptor.js");
const transform_interceptor_js_1 = require("./common/interceptors/transform.interceptor.js");
const validation_options_js_1 = __importDefault(require("./common/utils/validation-options.js"));
const swagger_1 = require("@nestjs/swagger");
async function bootstrap() {
    try {
        const app = await core_1.NestFactory.create(app_module_js_1.AppModule);
        const expressApp = app.getHttpAdapter().getInstance();
        const configService = app.get(config_1.ConfigService);
        const appConfig = configService.get('app');
        const allowedOrigins = configService.get('ALLOWED_ORIGINS') || '*';
        const nodeEnv = configService.get('NODE_ENV') || 'development';
        const port = appConfig?.port || configService.get('PORT') || 5000;
        const mediaLocalDir = configService.get('MEDIA_LOCAL_DIR') || 'uploads';
        const corsAllowlist = [
            process.env.CORS_ORIGIN,
            appConfig?.frontendDomain,
            allowedOrigins,
        ]
            .filter(Boolean)
            .join(',')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .filter((value, index, origins) => origins.indexOf(value) === index);
        expressApp.set('etag', false);
        expressApp.set('trust proxy', 1);
        app.useGlobalFilters(new all_exception_filter_js_1.AllExceptionFilter(), new http_exception_filter_js_1.HttpExceptionFilter());
        app.use((0, cookie_parser_1.default)());
        app.use((0, helmet_1.default)({
            crossOriginResourcePolicy: { policy: 'cross-origin' },
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", 'data:', 'https:'],
                },
            },
        }));
        app.useGlobalInterceptors(new logging_interceptor_js_1.LoggingInterceptor(), new metrics_interceptor_js_1.MetricsInterceptor(), new timeout_interceptor_js_1.TimeoutInterceptor(), new transform_interceptor_js_1.TransformInterceptor());
        app.enableCors({
            origin(origin, callback) {
                if (!origin)
                    return callback(null, true);
                if (corsAllowlist.includes('*'))
                    return callback(null, true);
                if (corsAllowlist.includes(origin))
                    return callback(null, true);
                return callback(new Error(`CORS blocked for origin: ${origin}`), false);
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
        });
        app.use((0, morgan_1.default)('combined', { skip: () => nodeEnv === 'test' }));
        app.use(express_1.default.json({
            limit: '10mb',
            verify: (req, _res, buf) => {
                req.rawBody = buf;
            },
        }));
        app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
        app.use('/api', (_req, res, next) => {
            res.setHeader('Cache-Control', 'no-store');
            next();
        });
        app.use(`/${mediaLocalDir}`, express_1.default.static((0, node_path_1.join)(process.cwd(), mediaLocalDir)));
        app.setGlobalPrefix(appConfig?.apiPrefix || 'api');
        app.enableVersioning({
            type: common_1.VersioningType.URI,
            defaultVersion: '1',
        });
        const swaggerConfig = new swagger_1.DocumentBuilder()
            .setTitle('Clinic API')
            .setDescription('API cho hệ thống một phòng khám đa cơ sở, đặt lịch, thanh toán và check-in.')
            .setVersion('1.0')
            .addBearerAuth({
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Nhập access token, không cần thêm tiền tố Bearer',
        }, 'access-token')
            .addTag('System', 'Kiểm tra trạng thái hệ thống')
            .addTag('Auth', 'Đăng ký, đăng nhập và quản lý phiên')
            .addTag('Users', 'Quản lý người dùng và phân quyền')
            .addTag('Appointments', 'Đặt lịch và quản lý lịch khám')
            .addTag('Doctors', 'Danh sách bác sĩ')
            .addTag('Clinic rooms', 'Danh sách phòng khám')
            .addTag('Medical visits', 'Hồ sơ từng lần khám')
            .addTag('Permissions', 'Quyền của người dùng hiện tại')
            .addTag('Payments', 'Thanh toán phí khám và webhook')
            .addTag('Check-in', 'Quét QR và cấp số thứ tự')
            .addTag('Branches', 'Danh sách cơ sở')
            .addTag('Patient profiles', 'Hồ sơ bệnh nhân và người thân')
            .build();
        const swaggerDocument = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
        swagger_1.SwaggerModule.setup('docs', app, swaggerDocument, {
            jsonDocumentUrl: 'docs-json',
            customSiteTitle: 'Clinic API Documentation',
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
                filter: true,
            },
        });
        app.useGlobalPipes(new common_1.ValidationPipe(validation_options_js_1.default));
        app.useStaticAssets((0, node_path_1.join)(process.cwd(), 'uploads'), {
            prefix: '/uploads',
        });
        await app.listen(port);
        console.log(`Server running on port ${port}`);
        console.log(`Environment: ${nodeEnv}`);
        console.log(`API Allows Using: ${corsAllowlist.join(', ')}`);
        console.log(`Swagger documentation: http://localhost:${port}/docs`);
        const signals = ['SIGTERM', 'SIGINT'];
        signals.forEach((signal) => {
            process.on(signal, async () => {
                console.log(`${signal} received, shutting down gracefully`);
                await app.close();
                console.log('Process terminated');
                process.exit(0);
            });
        });
    }
    catch (error) {
        console.error('Error starting application:', error);
        process.exit(1);
    }
}
void bootstrap();
//# sourceMappingURL=main.js.map