"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const app_config_js_1 = __importDefault(require("./config/app.config.js"));
const auth_config_js_1 = __importDefault(require("./config/auth.config.js"));
const google_config_js_1 = __importDefault(require("./config/google.config.js"));
const mailer_config_js_1 = __importDefault(require("./config/mailer.config.js"));
const rabbitmq_config_js_1 = __importDefault(require("./infrastructure/messaging/rabbitmq/rabbitmq.config.js"));
const redis_config_js_1 = __importDefault(require("./infrastructure/cache/redis/redis.config.js"));
const app_module_js_1 = require("./modules/app/app.module.js");
const appointments_module_js_1 = require("./modules/appointments/appointments.module.js");
const auth_module_js_1 = require("./modules/auth/auth-local/auth.module.js");
const jwt_auth_core_module_js_1 = require("./modules/auth/jwt-auth-core/jwt-auth-core.module.js");
const clinic_rooms_module_js_1 = require("./modules/clinic-rooms/clinic-rooms.module.js");
const doctors_module_js_1 = require("./modules/doctors/doctors.module.js");
const examinations_module_js_1 = require("./modules/examinations/examinations.module.js");
const permissions_guard_js_1 = require("./modules/permissions/guards/permissions.guard.js");
const jwt_auth_guard_js_1 = require("./modules/auth/auth-local/guards/jwt-auth.guard.js");
const database_module_js_1 = require("./database/database.module.js");
const contacts_module_js_1 = require("./modules/contacts/contacts.module.js");
const prisma_module_js_1 = require("./infrastructure/database/prisma/prisma.module.js");
const rabbitmq_module_js_1 = require("./infrastructure/messaging/rabbitmq/rabbitmq.module.js");
const patients_module_js_1 = require("./modules/patients/patients.module.js");
const redis_module_js_1 = require("./infrastructure/cache/redis/redis.module.js");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                cache: true,
                load: [app_config_js_1.default, auth_config_js_1.default, mailer_config_js_1.default, google_config_js_1.default, rabbitmq_config_js_1.default, redis_config_js_1.default],
                envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
            }),
            throttler_1.ThrottlerModule.forRoot([
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
            database_module_js_1.DatabaseModule,
            prisma_module_js_1.PrismaModule,
            redis_module_js_1.RedisModule,
            app_module_js_1.AppFeatureModule,
            jwt_auth_core_module_js_1.JwtAuthCoreModule,
            auth_module_js_1.AuthModule,
            doctors_module_js_1.DoctorsModule,
            clinic_rooms_module_js_1.ClinicRoomsModule,
            appointments_module_js_1.AppointmentsModule,
            examinations_module_js_1.ExaminationsModule,
            contacts_module_js_1.ContactsModule,
            rabbitmq_module_js_1.RabbitMqModule,
            patients_module_js_1.PatientsModule,
        ],
        controllers: [],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: jwt_auth_guard_js_1.JwtAuthGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: permissions_guard_js_1.PermissionsGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map