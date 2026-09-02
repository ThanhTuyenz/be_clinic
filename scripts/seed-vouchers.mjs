import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seedVouchers() {
  console.log('Seeding vouchers...');
  const now = new Date();
  const nextYear = new Date();
  nextYear.setFullYear(now.getFullYear() + 2);

  const sampleVouchers = [
    {
      code: 'CHAOBANMOI',
      name: 'Ưu đãi chào bạn mới',
      description: 'Giảm ngay 20.000đ cho lượt đặt lịch khám đầu tiên',
      discountType: 'FIXED_AMOUNT',
      discountValue: 20000,
      minOrderValue: 0,
      maxDiscount: null,
      usageLimit: 1000,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextYear,
      isActive: true,
    },
    {
      code: 'MEDPRO10',
      name: 'Ưu đãi tiện ích Medpro 10%',
      description: 'Giảm 10% tổng chi phí khám (tối đa 50.000đ)',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minOrderValue: 100000,
      maxDiscount: 50000,
      usageLimit: 500,
      userUsageLimit: 2,
      startDate: now,
      endDate: nextYear,
      isActive: true,
    },
    {
      code: 'TRIAN2025',
      name: 'Tri ân người bệnh 2025',
      description: 'Giảm 30.000đ cho đơn khám từ 200.000đ',
      discountType: 'FIXED_AMOUNT',
      discountValue: 30000,
      minOrderValue: 200000,
      maxDiscount: null,
      usageLimit: 300,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextYear,
      isActive: true,
    },
    {
      code: 'KHAMONLINE',
      name: 'Khuyến mãi đặt khám trực tuyến',
      description: 'Giảm 50.000đ cho các gói khám và chuyên khoa từ 300.000đ',
      discountType: 'FIXED_AMOUNT',
      discountValue: 50000,
      minOrderValue: 300000,
      maxDiscount: null,
      usageLimit: 200,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextYear,
      isActive: true,
    },
  ];

  for (const v of sampleVouchers) {
    await prisma.voucher.upsert({
      where: { code: v.code },
      update: {
        name: v.name,
        description: v.description,
        discountType: v.discountType,
        discountValue: v.discountValue,
        minOrderValue: v.minOrderValue,
        maxDiscount: v.maxDiscount,
        usageLimit: v.usageLimit,
        userUsageLimit: v.userUsageLimit,
        startDate: v.startDate,
        endDate: v.endDate,
        isActive: v.isActive,
      },
      create: v,
    });
    console.log(`✓ Voucher ${v.code} (${v.name})`);
  }

  console.log('Seeding vouchers completed!');
}

seedVouchers()
  .catch((e) => {
    console.error('Error seeding vouchers:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
