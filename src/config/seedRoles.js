import Role from '../models/Role.js'

const DEFAULT_ROLES = [
  { name: 'patient', description: 'Bệnh nhân' },
  { name: 'doctor', description: 'Bác sĩ' },
  { name: 'receptionist', description: 'Lễ tân' },
  { name: 'admin', description: 'Quản trị' },
]

export async function seedRoles() {
  for (const r of DEFAULT_ROLES) {
    const exists = await Role.findOne({ name: r.name })
    if (!exists) {
      await Role.create({ name: r.name, description: r.description })
    }
  }
}
