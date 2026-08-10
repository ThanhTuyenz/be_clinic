import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class ClinicalCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertStaff(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!user || user.role === 'PATIENT') throw new ForbiddenException('Chỉ nhân viên được truy cập danh mục')
  }

  async medicines(userId: string, q = '', limit = 25) {
    await this.assertStaff(userId)
    const term = q.trim()
    const rows = await this.prisma.medicine.findMany({
      where: {
        isActive: true,
        ...(term ? { OR: [{ code: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }, { activeIngredient: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { name: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    })
    return { medicines: rows }
  }

  async icd10(userId: string, q = '', limit = 20, departmentId?: number) {
    await this.assertStaff(userId)
    const term = q.trim()
    const rows = await this.prisma.icd10Code.findMany({
      where: {
        isActive: true,
        ...(departmentId ? { departmentId } : {}),
        ...(term ? { OR: [{ code: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { code: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    })
    return { items: rows }
  }

  async clinicalServices(userId: string, q = '', limit = 25, departmentId?: number) {
    await this.assertStaff(userId)
    const term = q.trim()
    const rows = await this.prisma.medicalService.findMany({
      where: {
        isActive: true,
        ...(departmentId ? { departmentId } : {}),
        ...(term ? {
          OR: [
            { code: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    })
    return { items: rows.map((row) => ({ ...row, price: Number(row.price) })) }
  }
}
