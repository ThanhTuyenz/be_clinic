import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InventoryMovementType } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js'

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(userId: string, branchId: string, write: boolean) {
    if (!branchId) throw new BadRequestException('Thiếu branchId')
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, branchAssignments: { where: { branchId }, select: { id: true } } },
    })
    if (!user) throw new ForbiddenException('Tài khoản không hợp lệ')
    const globalRole = user.role === 'ADMIN'
    const branchRole = ['BRANCH_MANAGER', 'PHARMACIST'].includes(user.role) && user.branchAssignments.length > 0
    if (!globalRole && !branchRole) throw new ForbiddenException(`Không có quyền ${write ? 'cập nhật' : 'xem'} kho chi nhánh này`)
  }

  async stocks(userId: string, branchId: string, q: string) {
    await this.authorize(userId, branchId, false)
    const search = String(q || '').trim()
    const rows = await this.prisma.inventoryStock.findMany({
      where: {
        branchId,
        medicine: search ? { OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { activeIngredient: { contains: search, mode: 'insensitive' } },
        ] } : undefined,
      },
      include: { medicine: true },
      orderBy: { medicine: { name: 'asc' } },
    })
    return { items: rows.map((row) => ({ ...row, quantity: Number(row.quantity), medicine: { ...row.medicine, unitPrice: Number(row.medicine.unitPrice) } })) }
  }

  async createMovement(userId: string, body: Record<string, unknown>) {
    const branchId = String(body.branchId || '').trim()
    const medicineId = String(body.medicineId || '').trim()
    const type = String(body.type || '').trim().toUpperCase() as InventoryMovementType
    const rawQuantity = Number(body.quantity)
    await this.authorize(userId, branchId, true)
    if (!medicineId) throw new BadRequestException('Thiếu medicineId')
    if (!Object.values(InventoryMovementType).includes(type)) throw new BadRequestException('Loại giao dịch kho không hợp lệ')
    if (!Number.isFinite(rawQuantity) || rawQuantity === 0) throw new BadRequestException('Số lượng phải khác 0')
    const negativeTypes: InventoryMovementType[] = ['DISPENSE', 'EXPIRED']
    const quantity = negativeTypes.includes(type) ? -Math.abs(rawQuantity) : type === 'ADJUSTMENT' ? rawQuantity : Math.abs(rawQuantity)
    const medicine = await this.prisma.medicine.findFirst({ where: { id: medicineId, isActive: true }, select: { id: true } })
    if (!medicine) throw new NotFoundException('Thuốc không tồn tại hoặc đã ngừng sử dụng')

    return this.prisma.$transaction(async (tx) => {
      if (quantity < 0) {
        const changed = await tx.inventoryStock.updateMany({
          where: { branchId, medicineId, quantity: { gte: Math.abs(quantity) } },
          data: { quantity: { decrement: Math.abs(quantity) } },
        })
        if (changed.count !== 1) throw new BadRequestException('Tồn kho không đủ')
      } else {
        await tx.inventoryStock.upsert({
          where: { branchId_medicineId: { branchId, medicineId } },
          create: { branchId, medicineId, quantity },
          update: { quantity: { increment: quantity } },
        })
      }
      const movement = await tx.inventoryMovement.create({
        data: {
          branchId,
          medicineId,
          type,
          quantity,
          referenceId: String(body.referenceId || '').trim() || null,
          note: String(body.note || '').trim() || null,
          createdById: userId,
        },
      })
      const stock = await tx.inventoryStock.findUniqueOrThrow({ where: { branchId_medicineId: { branchId, medicineId } } })
      return { movement: { ...movement, quantity: Number(movement.quantity) }, stock: { ...stock, quantity: Number(stock.quantity) } }
    })
  }
}
