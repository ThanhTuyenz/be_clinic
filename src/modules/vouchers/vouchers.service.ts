import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service.js';

export interface VoucherCalculationResult {
  valid: boolean;
  discountAmount: number;
  voucher: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discountValue: number;
    maxDiscount: number | null;
    minOrderValue: number | null;
  };
  message: string;
}

@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async getAvailableVouchers(accountId?: string) {
    const now = new Date();
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results = [];
    for (const v of vouchers) {
      if (v.usageLimit !== null && v.usedCount >= v.usageLimit) {
        continue;
      }

      if (accountId && v.userUsageLimit > 0) {
        const usedByUser = await this.prisma.voucherUsage.count({
          where: { voucherId: v.id, accountId },
        });
        if (usedByUser >= v.userUsageLimit) {
          continue;
        }
      }

      results.push({
        id: v.id,
        code: v.code,
        name: v.name,
        description: v.description,
        discountType: v.discountType,
        discountValue: Number(v.discountValue),
        minOrderValue: v.minOrderValue ? Number(v.minOrderValue) : 0,
        maxDiscount: v.maxDiscount ? Number(v.maxDiscount) : null,
        endDate: v.endDate,
      });
    }

    return results;
  }

  async validateVoucher(
    rawCode: string,
    subtotal: number,
    accountId?: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<VoucherCalculationResult> {
    const code = rawCode.trim().toUpperCase();
    const voucher = await client.voucher.findUnique({
      where: { code },
    });

    if (!voucher || !voucher.isActive) {
      throw new NotFoundException(`Mã giảm giá "${rawCode}" không tồn tại hoặc đã bị vô hiệu`);
    }

    const now = new Date();
    if (voucher.startDate > now) {
      throw new BadRequestException(`Mã giảm giá "${code}" chưa đến ngày áp dụng`);
    }

    if (voucher.endDate < now) {
      throw new BadRequestException(`Mã giảm giá "${code}" đã hết hạn sử dụng`);
    }

    if (voucher.usageLimit !== null && voucher.usedCount >= voucher.usageLimit) {
      throw new BadRequestException(`Mã giảm giá "${code}" đã hết lượt sử dụng`);
    }

    if (voucher.minOrderValue && subtotal < Number(voucher.minOrderValue)) {
      const minValStr = new Intl.NumberFormat('vi-VN').format(Number(voucher.minOrderValue));
      throw new BadRequestException(
        `Đơn khám chưa đạt giá trị tối thiểu ${minValStr}đ để áp dụng mã "${code}"`,
      );
    }

    if (accountId && voucher.userUsageLimit > 0) {
      const userUsageCount = await client.voucherUsage.count({
        where: { voucherId: voucher.id, accountId },
      });
      if (userUsageCount >= voucher.userUsageLimit) {
        throw new BadRequestException(
          `Bạn đã sử dụng hết số lần cho phép (${voucher.userUsageLimit} lần) của mã "${code}"`,
        );
      }
    }

    let discountAmount = 0;
    if (voucher.discountType === 'PERCENTAGE') {
      const pct = Number(voucher.discountValue);
      discountAmount = Math.round((subtotal * pct) / 100);
      if (voucher.maxDiscount) {
        discountAmount = Math.min(discountAmount, Number(voucher.maxDiscount));
      }
    } else {
      discountAmount = Number(voucher.discountValue);
    }

    // Không được giảm quá tổng tiền subtotal
    discountAmount = Math.min(discountAmount, subtotal);

    return {
      valid: true,
      discountAmount,
      voucher: {
        id: voucher.id,
        code: voucher.code,
        name: voucher.name,
        description: voucher.description,
        discountType: voucher.discountType as 'PERCENTAGE' | 'FIXED_AMOUNT',
        discountValue: Number(voucher.discountValue),
        maxDiscount: voucher.maxDiscount ? Number(voucher.maxDiscount) : null,
        minOrderValue: voucher.minOrderValue ? Number(voucher.minOrderValue) : null,
      },
      message: `Áp dụng thành công mã ${voucher.code}, giảm ${new Intl.NumberFormat('vi-VN').format(discountAmount)}đ`,
    };
  }

  async recordVoucherUsage(
    tx: Prisma.TransactionClient,
    voucherId: string,
    accountId: string,
    discountAmount: number,
    details: { appointmentId?: string; bookingOrderId?: string },
  ) {
    await tx.voucher.update({
      where: { id: voucherId },
      data: { usedCount: { increment: 1 } },
    });

    await tx.voucherUsage.create({
      data: {
        voucherId,
        accountId,
        discountAmount: new Prisma.Decimal(discountAmount),
        appointmentId: details.appointmentId,
        bookingOrderId: details.bookingOrderId,
      },
    });
  }
}

export async function releaseVoucherUsage(
  tx: Prisma.TransactionClient,
  reference: { appointmentId: string } | { bookingOrderId: string },
) {
  const usages = await tx.voucherUsage.findMany({ where: reference, select: { id: true, voucherId: true } });
  for (const usage of usages) {
    const removed = await tx.voucherUsage.deleteMany({ where: { id: usage.id } });
    if (removed.count === 1) await tx.voucher.updateMany({
      where: { id: usage.voucherId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } },
    });
  }
}
