// src/database/database.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

const buildMongoUriFromEnvUri = (
  mongoUri: string,
  databaseName: string,
): string => {
  const [base, query] = mongoUri.split('?', 2);
  const schemeSeparatorIndex = base.indexOf('://');
  if (schemeSeparatorIndex === -1) {
    return mongoUri;
  }

  const afterScheme = base.slice(schemeSeparatorIndex + 3);
  const firstSlashIndex = afterScheme.indexOf('/');

  // No path at all: mongodb+srv://host  -> mongodb+srv://host/<db>
  if (firstSlashIndex === -1) {
    return `${base}/${encodeURIComponent(databaseName)}${query ? `?${query}` : ''}`;
  }

  const path = afterScheme.slice(firstSlashIndex);
  // Path is empty or just "/": mongodb://host/ -> mongodb://host/<db>
  if (path === '/' || path.length === 0) {
    const hostPart =
      base.slice(0, schemeSeparatorIndex + 3) +
      afterScheme.slice(0, firstSlashIndex);
    return `${hostPart}/${encodeURIComponent(databaseName)}${query ? `?${query}` : ''}`;
  }

  // Already has a path (/db or /db/collection...). Keep it.
  return mongoUri;
};

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';
        const mongoUri = configService.get<string>('MONGO_URI') || '';
        const database =
          configService.get<string>('MONGO_DB_NAME') ??
          configService.get<string>('DB_NAME') ??
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
export class DatabaseModule implements OnModuleInit {
  async onModuleInit() {
    // Đảm bảo kết nối MongoDB khởi tạo xong trước khi chạy các module tiếp theo
    // Với TypeORM và MongoDB, nếu pool chưa active, truy vấn đầu dễ chậm/timeout
    console.log('Đang kết nối MongoDB (Mongoose + TypeORM - Mongo) ...');
    // TypeORM tự động quản lý pool – không cần gọi initialize thủ công nếu sử dụng forRootAsync
    // Có thể chờ 1 truy vấn dummy để warm-up, hoặc chỉ log status :
    // Nên chỉ log, không exit process tại đây, vì TypeORM throw error nếu kết nối lỗi lúc startup
    console.log('DatabaseModule đã khởi động và kết nối cấu hình xong.');
  }
}
