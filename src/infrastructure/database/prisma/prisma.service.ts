import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name)
  private readonly pool: pg.Pool

  constructor() {
    const connectionString = process.env.DATABASE_URL || ''

    // Cấu hình Connection Pool tối ưu hiệu năng và chịu tải
    const pool = new pg.Pool({
      connectionString,
      max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 20, // Số connection tối đa
      idleTimeoutMillis: 30000, // Giải phóng connection nhàn rỗi sau 30s
      connectionTimeoutMillis: 10000, // Timeout 10s tránh treo request khi database nghẽn
    })

    // Bắt lỗi kết nối đột ngột tránh crash tiến trình
    pool.on('error', (err) => {
      this.logger.error('Lỗi kết nối PostgreSQL Pool:', err.message)
    })

    const adapter = new PrismaPg(pool)
    super({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? ['error', 'warn']
          : ['error'],
    })

    this.pool = pool
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect()
      this.logger.log('✅ Đã kết nối cơ sở dữ liệu PostgreSQL (Prisma 7 Pool).')
    } catch (error) {
      this.logger.error('❌ Lỗi kết nối PostgreSQL:', (error as Error).message)
      throw error
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect()
      await this.pool.end()
      this.logger.log('Đã đóng kết nối PostgreSQL Pool an toàn.')
    } catch (error) {
      this.logger.error('Lỗi khi đóng kết nối PostgreSQL:', (error as Error).message)
    }
  }
}
