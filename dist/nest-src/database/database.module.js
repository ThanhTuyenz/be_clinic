"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const typeorm_1 = require("@nestjs/typeorm");
const buildMongoUriFromEnvUri = (mongoUri, databaseName) => {
    const [base, query] = mongoUri.split('?', 2);
    const schemeSeparatorIndex = base.indexOf('://');
    if (schemeSeparatorIndex === -1) {
        return mongoUri;
    }
    const afterScheme = base.slice(schemeSeparatorIndex + 3);
    const firstSlashIndex = afterScheme.indexOf('/');
    if (firstSlashIndex === -1) {
        return `${base}/${encodeURIComponent(databaseName)}${query ? `?${query}` : ''}`;
    }
    const path = afterScheme.slice(firstSlashIndex);
    if (path === '/' || path.length === 0) {
        const hostPart = base.slice(0, schemeSeparatorIndex + 3) +
            afterScheme.slice(0, firstSlashIndex);
        return `${hostPart}/${encodeURIComponent(databaseName)}${query ? `?${query}` : ''}`;
    }
    return mongoUri;
};
let DatabaseModule = class DatabaseModule {
    async onModuleInit() {
        console.log('Đang kết nối MongoDB (Mongoose + TypeORM - Mongo) ...');
        console.log('DatabaseModule đã khởi động và kết nối cấu hình xong.');
    }
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: async (configService) => ({
                    uri: configService.get('MONGO_URI'),
                }),
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: async (configService) => {
                    const isProduction = configService.get('NODE_ENV') === 'production';
                    const mongoUri = configService.get('MONGO_URI') || '';
                    const database = configService.get('MONGO_DB_NAME') ??
                        configService.get('DB_NAME') ??
                        'restaurant';
                    console.log("MONGO_URI", mongoUri);
                    console.log("MONGO_DB_NAME", database);
                    const fullUri = buildMongoUriFromEnvUri(mongoUri, database);
                    return {
                        type: 'mongodb',
                        url: fullUri,
                        database,
                        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
                        synchronize: !isProduction,
                        autoLoadEntities: true,
                        logging: isProduction
                            ? ['error', 'warn']
                            : ['query', 'error', 'warn', 'info', 'log'],
                        maxQueryExecutionTime: 100,
                        connectTimeoutMS: 10000,
                        socketTimeoutMS: 45000,
                        autoIndex: !isProduction,
                        useUnifiedTopology: true,
                    };
                },
            }),
        ],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map