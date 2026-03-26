import bcrypt from 'bcryptjs'
import Role from '../models/Role.js'
import User from '../models/User.js'

const DEFAULT_DOCTORS = [
  {
    firstName: 'Văn',
    lastName: 'Nguyễn',
    email: 'dr.nguyen@clinicabc.vn',
    phone: '0901002003',
    bio: 'Bác sĩ Nội tổng quát — kinh nghiệm 10 năm.',
  },
  {
    firstName: 'Quang',
    lastName: 'Trần',
    email: 'dr.tran@clinicabc.vn',
    phone: '0901002004',
    bio: 'Bác sĩ Ngoại — chuyên về khám ngoại trú.',
  },
  {
    firstName: 'Minh',
    lastName: 'Lê',
    email: 'dr.le@clinicabc.vn',
    phone: '0901002005',
    bio: 'Bác sĩ Da liễu — điều trị các vấn đề da thường gặp.',
  },
]

const DEFAULT_PASSWORD = '12345678'

export async function seedDoctors() {
  const role = await Role.findOne({ name: 'doctor' })
  if (!role) return

  const existing = await User.find({ userType: 'doctor' }).select('email phone')
  const existsByEmail = new Set(existing.map((u) => String(u.email).toLowerCase()))
  const existsByPhone = new Set(existing.map((u) => String(u.phone).trim()))

  for (const d of DEFAULT_DOCTORS) {
    const emailLower = d.email.toLowerCase()
    if (existsByEmail.has(emailLower) || existsByPhone.has(d.phone)) continue

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10)

    await User.create({
      email: emailLower,
      passwordHash,
      roleId: role._id,
      userType: 'doctor',
      isActive: true,
      emailVerified: true,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone,
      bio: d.bio,
      // Các field khác theo class diagram có thể seed sau (specialtyId, shiftId, ...).
    })
  }
}

