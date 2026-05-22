import ClinicRoom from '../models/ClinicRoom.js'

/** Danh sách phòng cho lễ tân / đăng ký chọn (public read). */
export async function listClinicRooms(req, res) {
  try {
    const activeOnly = String(req.query.activeOnly || 'true').toLowerCase() !== 'false'
    const q = activeOnly ? { isActive: { $ne: false } } : {}
    const rows = await ClinicRoom.find(q)
      .sort({ sortOrder: 1, name: 1, roomID: 1 })
      .lean()

    return res.status(200).json({
      rooms: (rows || []).map((r) => ({
        roomID: String(r.roomID || '').trim(),
        name: String(r.name || '').trim(),
        building: String(r.building || '').trim(),
        floor: String(r.floor || '').trim(),
        notes: String(r.notes || '').trim(),
        sortOrder: Number(r.sortOrder) || 0,
        isActive: r.isActive !== false,
      })),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
