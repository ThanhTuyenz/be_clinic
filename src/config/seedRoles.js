import Role from '../models/Role.js'

const DEFAULT_ROLES = [
  { name: 'patient', description: 'Bệnh nhân' },
  { name: 'doctor', description: 'Bác sĩ' },
  { name: 'pharmacist', description: 'Dược sĩ' },
  { name: 'cashier', description: 'Thu ngân' },
  { name: 'receptionist', description: 'Lễ tân' },
  { name: 'branch_manager', description: 'Quản lý chi nhánh' },
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
