import Medicine from '../models/Medicine.js'

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Tìm thuốc trong danh mục (collection `medicine`).
 * Bác sĩ / nhân viên đăng nhập đều được tra cứu.
 */
export async function listMedicines(req, res) {
  try {
    const q = String(req.query.q || '').trim()
    const limitRaw = Number(req.query.limit)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 25

    const filter = { active: { $ne: false } }
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i')
      filter.$or = [{ name: rx }, { code: rx }, { strength: rx }]
    }

    const rows = await Medicine.find(filter)
      .sort({ name: 1 })
      .limit(limit)
      .lean()

    return res.status(200).json({
      medicines: (rows || []).map((m) => ({
        id: m._id,
        code: String(m.code || '').trim(),
        name: String(m.name || '').trim(),
        unit: String(m.unit || '').trim(),
        strength: String(m.strength || '').trim(),
        form: String(m.form || '').trim(),
        manufacturer: String(m.manufacturer || '').trim(),
        notes: String(m.notes || '').trim(),
        active: m.active !== false,
      })),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
