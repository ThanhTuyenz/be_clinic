/**
 * Sinh khung giờ từ doctorSchedule + shift, trừ slot đã đặt.
 */

export const DEFAULT_SLOT_MINUTES = 12

export function isValidIsoDateOnly(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export function isValidHHmm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00')
    .split(':')
    .map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function minutesToHHmm(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Sinh các mốc startTime trong ca (chưa gồm endTime). */
export function buildSlotTimesFromRange(startTime, endTime, slotMinutes = DEFAULT_SLOT_MINUTES) {
  const start = hhmmToMinutes(startTime)
  const end = hhmmToMinutes(endTime)
  if (end <= start) return []
  const out = []
  for (let t = start; t + slotMinutes <= end; t += slotMinutes) {
    out.push(minutesToHHmm(t))
  }
  return out
}

function dateKeyFromValue(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    return value.includes('T') ? value.slice(0, 10) : value.slice(0, 10)
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function scheduleDateQuery(dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00`)
  const dayEnd = new Date(`${dateStr}T23:59:59.999`)
  return {
    $or: [{ date: dateStr }, { date: { $gte: dayStart, $lte: dayEnd } }],
  }
}

export async function findDoctorSchedulesForDate(db, doctorId, dateStr) {
  const coll = db.collection('doctorSchedule')
  return coll
    .find({
      doctorID: String(doctorId).trim(),
      isActive: { $ne: false },
      ...scheduleDateQuery(dateStr),
    })
    .toArray()
}

export async function findDoctorScheduleDateKeys(db, doctorId, fromStr, toStr) {
  const coll = db.collection('doctorSchedule')
  const from = new Date(`${fromStr}T00:00:00`)
  const to = new Date(`${toStr}T23:59:59.999`)
  const rows = await coll
    .find({
      doctorID: String(doctorId).trim(),
      isActive: { $ne: false },
      $or: [
        { date: { $gte: fromStr, $lte: toStr } },
        { date: { $gte: from, $lte: to } },
      ],
    })
    .project({ date: 1, _id: 0 })
    .toArray()

  const keys = new Set()
  for (const row of rows) {
    const k = dateKeyFromValue(row.date)
    if (k && k >= fromStr && k <= toStr) keys.add(k)
  }
  return Array.from(keys).sort()
}

export async function loadShiftMap(db, shiftIds) {
  const ids = [...new Set(shiftIds.map((s) => String(s).trim()).filter(Boolean))]
  if (!ids.length) return new Map()
  const rows = await db.collection('shift').find({ shiftID: { $in: ids } }).toArray()
  return new Map(rows.map((r) => [String(r.shiftID), r]))
}

/**
 * @param {object} params
 * @param {import('mongodb').Db} params.db
 * @param {string} params.doctorId
 * @param {string} params.dateStr YYYY-MM-DD
 * @param {Set<string>} params.bookedSet
 * @param {Date} [params.now]
 */
export async function computeAvailabilityFromSchedule({ db, doctorId, dateStr, bookedSet, now = new Date() }) {
  const schedules = await findDoctorSchedulesForDate(db, doctorId, dateStr)
  if (!schedules.length) {
    return { slots: [], shifts: [], hasSchedule: false }
  }

  const shiftMap = await loadShiftMap(
    db,
    schedules.map((s) => s.shiftID),
  )

  const todayKey = dateKeyFromValue(now)
  const isToday = dateStr === todayKey
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const shifts = []
  const slotSet = new Set()

  for (const sched of schedules) {
    const shift = shiftMap.get(String(sched.shiftID || ''))
    if (!shift || shift.isActive === false) continue

    const startTime = String(shift.startTime || '').slice(0, 5)
    const endTime = String(shift.endTime || '').slice(0, 5)
    const slotMinutes = Number(shift.slotMinutes) > 0 ? Number(shift.slotMinutes) : DEFAULT_SLOT_MINUTES
    if (!isValidHHmm(startTime) || !isValidHHmm(endTime)) continue

    let times = buildSlotTimesFromRange(startTime, endTime, slotMinutes)
    const maxPatients = Number(sched.maxPatients)
    if (Number.isFinite(maxPatients) && maxPatients > 0 && times.length > maxPatients) {
      times = times.slice(0, maxPatients)
    }

    const freeInShift = []
    for (const t of times) {
      if (bookedSet.has(t)) continue
      if (isToday && hhmmToMinutes(t) <= nowMinutes) continue
      slotSet.add(t)
      freeInShift.push(t)
    }

    shifts.push({
      shiftID: String(shift.shiftID || ''),
      name: String(shift.name || shift.shiftID || 'Ca khám'),
      startTime,
      endTime,
      slots: freeInShift,
    })
  }

  const slots = Array.from(slotSet).sort((a, b) => hhmmToMinutes(a) - hhmmToMinutes(b))
  return { slots, shifts, hasSchedule: true }
}
