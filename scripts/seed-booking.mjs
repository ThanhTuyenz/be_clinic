import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'

dotenv.config({ path: resolve(process.cwd(), '.env.development') })
dotenv.config()

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'
const dbName = process.env.MONGO_DB_NAME || 'clinic'
const passwordHash = await bcrypt.hash('Doctor@123', 10)

const specialties = [
  ['SPEC-001', 'Nội Tổng Quát'],
  ['SPEC-002', 'Tim Mạch'],
  ['SPEC-003', 'Nhi Khoa'],
  ['SPEC-004', 'Thần Kinh'],
  ['SPEC-005', 'Sản Phụ Khoa'],
  ['SPEC-006', 'Da Liễu'],
]

const doctors = [
  ['66b000000000000000000001', 'An', 'Nguyễn Hoàng', 'dr.an@vitacare.vn', '0901002001', 'SPEC-001', 12, 4.9],
  ['66b000000000000000000002', 'Minh', 'Trần Quang', 'dr.minh@vitacare.vn', '0901002002', 'SPEC-002', 15, 4.9],
  ['66b000000000000000000003', 'Lan', 'Lê Thu', 'dr.lan@vitacare.vn', '0901002003', 'SPEC-003', 10, 4.8],
  ['66b000000000000000000004', 'Huy', 'Phạm Đức', 'dr.huy@vitacare.vn', '0901002004', 'SPEC-004', 11, 4.8],
  ['66b000000000000000000005', 'Mai', 'Vũ Ngọc', 'dr.mai@vitacare.vn', '0901002005', 'SPEC-005', 14, 4.9],
  ['66b000000000000000000006', 'Khoa', 'Đặng Anh', 'dr.khoa@vitacare.vn', '0901002006', 'SPEC-006', 9, 4.7],
]

const client = new MongoClient(uri)
await client.connect()
try {
  const db = client.db(dbName)
  const now = new Date()
  const doctorRole = await db.collection('roles').findOneAndUpdate(
    { name: 'doctor' },
    { $set: { description: 'Bác sĩ', updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true, returnDocument: 'after' },
  )

  await db.collection('department').updateOne(
    { deptID: 'DEPT-CLINICAL' },
    { $set: { deptName: 'Khối lâm sàng', description: 'Khoa khám bệnh', updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )

  for (const [specialtyID, specialtyName] of specialties) {
    await db.collection('specialties').updateOne(
      { specialtyID },
      { $set: { specialtyName, deptID: 'DEPT-CLINICAL', description: `Khám và điều trị ${specialtyName}`, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
  }

  await db.collection('shift').updateMany({ shiftID: { $in: ['SHIFT-AM', 'SHIFT-PM'] } }, { $set: { isActive: true } })
  await db.collection('shift').updateOne({ shiftID: 'SHIFT-AM' }, { $set: { name: 'Ca sáng', startTime: '08:00', endTime: '11:30', slotMinutes: 30, isActive: true } }, { upsert: true })
  await db.collection('shift').updateOne({ shiftID: 'SHIFT-PM' }, { $set: { name: 'Ca chiều', startTime: '13:30', endTime: '17:00', slotMinutes: 30, isActive: true } }, { upsert: true })

  for (const [id, firstName, lastName, email, phone, specialtyID, experienceYears, rating] of doctors) {
    const _id = new ObjectId(id)
    await db.collection('users').updateOne(
      { _id },
      { $set: { firstName, lastName, email, phone, specialtyID, experienceYears, rating, passwordHash, roleId: doctorRole._id, userType: 'doctor', isActive: true, emailVerified: true, consultationFee: 200000, bio: `Bác sĩ ${specialtyID} với ${experienceYears} năm kinh nghiệm.`, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )

    for (let offset = 1; offset <= 28; offset += 1) {
      const date = new Date()
      date.setDate(date.getDate() + offset)
      if (date.getDay() === 0) continue
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      for (const shiftID of ['SHIFT-AM', 'SHIFT-PM']) {
        await db.collection('doctorSchedule').updateOne(
          { doctorID: String(_id), date: dateKey, shiftID },
          { $set: { isActive: true, maxPatients: 7, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true },
        )
      }
    }
  }

  console.log(`Seed booking hoàn tất: ${doctors.length} bác sĩ, ${specialties.length} chuyên khoa, lịch 28 ngày.`)
  console.log('Tài khoản bác sĩ dùng mật khẩu: Doctor@123')
} finally {
  await client.close()
}
