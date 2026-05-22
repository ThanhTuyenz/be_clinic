import ClinicRoom from '../models/ClinicRoom.js'

/** Map roomID -> { name, ... } cho các doctor / appointment đã có mã phòng. */
export async function getClinicRoomMetaMap(roomIds) {
  const ids = [
    ...new Set(
      (roomIds || []).filter(Boolean).map((id) => String(id).trim()).filter(Boolean),
    ),
  ]
  if (!ids.length) return new Map()
  const rows = await ClinicRoom.find(
    { roomID: { $in: ids }, isActive: { $ne: false } },
    { roomID: 1, name: 1, building: 1, floor: 1 },
  ).lean()
  const map = new Map()
  for (const r of rows || []) {
    map.set(String(r.roomID).trim(), {
      name: String(r.name || '').trim(),
      building: String(r.building || '').trim(),
      floor: String(r.floor || '').trim(),
    })
  }
  return map
}

export function clinicRoomDisplayLabel(roomID, meta) {
  const id = String(roomID || '').trim()
  if (!id) return ''
  if (!meta) return id
  const name = String(meta.name || '').trim()
  const bits = [name || id]
  const loc = [meta.building, meta.floor].filter(Boolean).join(', ')
  if (loc) bits.push(`(${loc})`)
  return bits.join(' ')
}
