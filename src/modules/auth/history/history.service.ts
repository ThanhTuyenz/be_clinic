import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name)

  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    action: string
    message?: string
    actorId?: string
    actorEmail?: string
    targetType?: string
    targetId?: string
    metadata?: any
  }) {
    try {
      return await this.prisma.auditLog.create({
        data: {
          action: input.action,
          actorId: input.actorId,
          targetType: input.targetType || 'user',
          targetId: input.targetId || input.actorId,
          metadata: {
            message: input.message,
            actorEmail: input.actorEmail,
            ...(input.metadata || {}),
          },
        },
      })
    } catch (err: any) {
      this.logger.warn(`Failed to record audit log: ${err?.message}`)
    }
  }
}