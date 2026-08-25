import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.development' })
dotenv.config()

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/vitacare?schema=public'

const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('--- Đang thêm cột patient_code vào patient_profiles ---')
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "patient_profiles" 
    ADD COLUMN IF NOT EXISTS "patient_code" VARCHAR(30);
  `)
  
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "patient_profiles_patient_code_key" 
    ON "patient_profiles"("patient_code");
  `)

  console.log('✅ Đã thêm cột patient_code và Unique Index thành công!')

  // Tự động sinh mã cho các hồ sơ chưa có mã BN
  const profilesWithoutCode = await prisma.patientProfile.findMany({
    where: { patientCode: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true },
  })

  console.log(`Tìm thấy ${profilesWithoutCode.length} hồ sơ chưa có mã BN. Bắt đầu gán mã...`)

  let count = 1
  const yy = String(new Date().getFullYear()).slice(-2)
  for (const p of profilesWithoutCode) {
    const code = `BN${yy}${String(count).padStart(5, '0')}`
    await prisma.patientProfile.update({
      where: { id: p.id },
      data: { patientCode: code },
    })
    count++
  }

  console.log('🎉 Hoàn tất gán mã bệnh nhân cho toàn bộ dữ liệu hiện có!')
}

main()
  .catch((e) => {
    console.error('Lỗi khi migrate:', e)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
