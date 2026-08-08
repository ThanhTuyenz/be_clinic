import { resolve } from 'node:path'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'

dotenv.config({ path: resolve(process.cwd(), '.env.development') })
dotenv.config()

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'
const dbName = process.env.MONGO_DB_NAME || 'clinic'
const defaultPassword = 'VitaCare@123'
const password = await bcrypt.hash(defaultPassword, 10)

const accounts = [
  ['00000000-0000-4000-8000-000000000002', 'admin', 'Quản trị viên', 'admin@vitacare.vn', '0910000002'],
  ['00000000-0000-4000-8000-000000000003', 'branch_manager', 'Quản lý chi nhánh', 'manager@vitacare.vn', '0910000003'],
  ['00000000-0000-4000-8000-000000000004', 'doctor', 'Bác sĩ Demo', 'doctor@vitacare.vn', '0910000004'],
  ['00000000-0000-4000-8000-000000000005', 'pharmacist', 'Dược sĩ Demo', 'pharmacist@vitacare.vn', '0910000005'],
  ['00000000-0000-4000-8000-000000000006', 'cashier', 'Thu ngân Demo', 'cashier@vitacare.vn', '0910000006'],
  ['00000000-0000-4000-8000-000000000007', 'receptionist', 'Nhân viên tiếp nhận', 'receptionist@vitacare.vn', '0910000007'],
  ['00000000-0000-4000-8000-000000000008', 'patient', 'Bệnh nhân Demo', 'patient@vitacare.vn', '0910000008'],
]

const descriptions = {
  admin: 'Quản trị viên',
  branch_manager: 'Quản lý chi nhánh',
  doctor: 'Bác sĩ',
  pharmacist: 'Dược sĩ',
  cashier: 'Thu ngân',
  receptionist: 'Nhân viên tiếp nhận',
  patient: 'Bệnh nhân',
}

const legacyCompatibleRoles = new Set([
  'admin', 'branch_manager', 'doctor', 'pharmacist',
  'cashier', 'receptionist', 'patient',
])

const client = new MongoClient(uri)
await client.connect()
try {
  const db = client.db(dbName)
  const now = new Date()
  const roleIds = new Map()
  const removedRoles = ['staff', 'user', 'super_admin']

  await db.collection('user').deleteMany({ role: { $in: removedRoles } })
  await db.collection('users').deleteMany({ userType: { $in: removedRoles } })
  await db.collection('roles').deleteMany({ name: { $in: removedRoles } })

  for (const role of Object.keys(descriptions)) {
    const roleDoc = await db.collection('roles').findOneAndUpdate(
      { name: role },
      { $set: { description: descriptions[role], updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    )
    roleIds.set(role, roleDoc._id)
  }

  for (const [id, role, fullName, email, phone] of accounts) {
    await db.collection('user').updateOne(
      { email },
      {
        $set: {
          id,
          email,
          password,
          provider: 'email',
          status: 'active',
          role,
          roleId: String(roleIds.get(role)),
          fullName,
          socialId: null,
          customPermissions: null,
          hash: null,
          emailOtpHash: null,
          emailOtpExpiresAt: null,
          emailOtpLastSentAt: null,
          emailOtpAttempts: 0,
          isBlocked: false,
          blockedAt: null,
          isDeleted: false,
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now, lastLoginAt: null },
      },
      { upsert: true },
    )

    if (legacyCompatibleRoles.has(role)) {
      const nameParts = fullName.split(' ')
      const firstName = nameParts.pop() || fullName
      const lastName = nameParts.join(' ')
      await db.collection('users').updateOne(
        { email },
        {
          $set: {
            email,
            passwordHash: password,
            roleId: roleIds.get(role),
            userType: role,
            isActive: true,
            emailVerified: true,
            firstName,
            lastName,
            phone,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      )
    }
  }

  console.log(`Seed hoàn tất ${accounts.length} tài khoản Nest và ${legacyCompatibleRoles.size} tài khoản legacy tương thích.`)
  console.log(`Mật khẩu chung: ${defaultPassword}`)
  for (const [, role, , email] of accounts) console.log(`${role.padEnd(15)} ${email}`)
} finally {
  await client.close()
}
