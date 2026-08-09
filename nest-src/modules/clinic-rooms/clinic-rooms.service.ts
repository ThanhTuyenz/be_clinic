import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class ClinicRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  list(activeOnly = true) {
    return this.prisma.clinicRoom.findMany({
      where: activeOnly ? { isActive: true, branch: { isActive: true } } : {},
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: [{ branch: { name: 'asc' } }, { code: 'asc' }],
    })
  }
}
