import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { MongoClient, ObjectId } from 'mongodb'

const uri = String(process.env.MONGODB_URI || '').trim()
const dbName = String(process.env.MONGO_DB_NAME || 'clinic').trim()
const collName = String(process.env.MONGO_MED_COLLECTION || 'medicine').trim()
const usersColl = String(process.env.MONGO_USERS_COLLECTION || 'users').trim()
const apptsCollName = String(process.env.MONGO_APPOINTMENTS_COLLECTION || 'appointments').trim()
const specialtiesColl = String(process.env.MONGO_SPECIALTIES_COLLECTION || 'specialties').trim()
const jwtSecret = String(process.env.JWT_SECRET || '').trim()
const port = Number(process.env.PORT || 5000)

if (!uri) {
  console.error('Thiếu MONGODB_URI trong .env')
  process.exit(1)
}

const client = new MongoClient(uri)
const app = express()
app.use(cors({ origin: true }))
app.use(express.json())

/** OTP đăng ký bệnh nhân (RAM — dev; production nên dùng email/SMS thật). */
const OTP_TTL_MS = 30 * 60 * 1000
const regByVerifyToken = new Map()
const regByEmail = new Map()
const completeByToken = new Map()

function randomOtp6() {
  return String(100000 + Math.floor(Math.random() * 900000))
}

function maskEmail(email) {
  const e = String(email || '').trim()
  const at = e.indexOf('@')
  if (at <= 0) return e
  const local = e.slice(0, at)
  const dom = e.slice(at + 1)
  const keep = Math.min(3, local.length)
  return `${local.slice(0, keep)}***@${dom}`
}

function clearPendingReg(emailLower) {
  const prev = regByEmail.get(emailLower)
  if (prev?.verificationToken) regByVerifyToken.delete(prev.verificationToken)
  regByEmail.delete(emailLower)
}

function mongoHint(err) {
  const code = err?.code || ''
  const msg = String(err?.message || err)
  if (code === 'ECONNREFUSED' || msg.includes('querySrv') || msg.includes('ENOTFOUND')) {
    return (
      'Không kết nối được MongoDB (DNS/mạng). Thử: (1) Atlas → Network Access → thêm IP máy bạn hoặc 0.0.0.0/0 khi dev; ' +
      '(2) tắt VPN/chặn DNS; (3) kiểm tra lại URI trong .env.'
    )
  }
  if (code === 'EAUTH' || msg.includes('bad auth')) {
    return 'Sai user/mật khẩu trong MONGODB_URI (Atlas → Database Access).'
  }
  return msg
}

function normalizeDoc(doc) {
  if (!doc || typeof doc !== 'object') return null
  const id = doc._id != null ? String(doc._id) : ''
  return {
    id,
    code: doc.code != null ? String(doc.code) : '',
    name: doc.name != null ? String(doc.name) : '',
    unit: doc.unit != null ? String(doc.unit) : 'viên',
    strength: doc.strength != null ? String(doc.strength) : '',
    form: doc.form != null ? String(doc.form) : '',
    notes: doc.notes != null ? String(doc.notes) : '',
    active: doc.active !== false,
  }
}

function userTypeOf(doc) {
  return String(doc?.userType || doc?.role || '').trim().toLowerCase()
}

/** Chuẩn hoá để nhận diện "bác sĩ" / Doctor / role tương đương trong Mongo */
function isDoctorUser(doc) {
  if (!doc || typeof doc !== 'object') return false
  const raw = String(doc.userType || doc.role || '').trim()
  const ut = raw.toLowerCase()
  if (ut === 'doctor' || ut === 'physician') return true
  try {
    const nd = ut.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
    if (nd === 'bac si' || nd.replace(/\s/g, '') === 'bacsi') return true
  } catch {
    /* ignore */
  }
  return false
}

/** _id Mongo thường là ObjectId; một số dữ liệu cũ có thể lưu _id dạng string */
async function findUserByIdFlexible(db, idStr) {
  const s = String(idStr || '').trim()
  if (!s) return null
  const col = db.collection(usersColl)
  try {
    const oid = new ObjectId(s)
    const byOid = await col.findOne({ _id: oid })
    if (byOid) return byOid
  } catch {
    /* không phải ObjectId 24 ký tự hex */
  }
  return col.findOne({ _id: s })
}

async function findDoctorByIdFlexible(db, idStr) {
  const u = await findUserByIdFlexible(db, idStr)
  if (!u || !isDoctorUser(u)) return null
  return u
}

function publicUser(doc) {
  if (!doc || typeof doc !== 'object') return null
  const u = { ...doc }
  delete u.password
  delete u.passwordHash
  delete u.hash
  const id = String(doc._id)
  u.id = id
  u._id = id
  return u
}

const APPT_SLOT_MINUTES = 12

function appointmentsCollection(db) {
  return db.collection(apptsCollName)
}

/** DB chứa catalogue chuyên khoa (mặc định trùng MONGO_DB_NAME; Compass có thể để `test`). */
function specialtiesDatabase(mongoClient) {
  const alt = String(process.env.MONGO_SPECIALTIES_DB_NAME || '').trim()
  return mongoClient.db(alt || dbName)
}

function doctorSpecialtyCatalogKey(d) {
  if (!d || typeof d !== 'object') return ''
  return String(d.specialtyID || d.specialtyId || d.chuyenKhoaId || '').trim()
}

async function specialtyNameMapByIds(mongoClient, ids) {
  const uniq = [...new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean))]
  if (!uniq.length) return new Map()
  try {
    const sdb = specialtiesDatabase(mongoClient)
    const rows = await sdb
      .collection(specialtiesColl)
      .find({ specialtyID: { $in: uniq } })
      .project({ specialtyID: 1, specialtyName: 1 })
      .toArray()
    const m = new Map()
    for (const r of rows) {
      const k = String(r.specialtyID ?? '').trim()
      const n = String(r.specialtyName ?? '').trim()
      if (k && n) m.set(k, n)
    }
    return m
  } catch (e) {
    console.warn('[specialties] lookup failed:', e?.message || e)
    return new Map()
  }
}

function enrichDoctorSpecialtyFromMap(doctor, map) {
  if (!doctor || typeof doctor !== 'object' || !map || map.size === 0) return
  const key = doctorSpecialtyCatalogKey(doctor)
  if (!key) return
  const label = map.get(key)
  if (!label) return
  doctor.specialtyName = label
  doctor.specialty = label
}

async function enrichAppointmentsSpecialtyNames(mongoClient, appointments) {
  const arr = Array.isArray(appointments) ? appointments.filter(Boolean) : []
  if (!arr.length) return
  const keys = []
  for (const a of arr) {
    const k = doctorSpecialtyCatalogKey(a?.doctor)
    if (k) keys.push(k)
  }
  const map = await specialtyNameMapByIds(mongoClient, keys)
  if (!map.size) return
  for (const a of arr) {
    if (a?.doctor) enrichDoctorSpecialtyFromMap(a.doctor, map)
  }
}

async function enrichPublicDoctorsSpecialtyNames(mongoClient, doctors) {
  const arr = Array.isArray(doctors) ? doctors.filter(Boolean) : []
  if (!arr.length) return
  const keys = []
  for (const d of arr) {
    const k = doctorSpecialtyCatalogKey(d)
    if (k) keys.push(k)
  }
  const map = await specialtyNameMapByIds(mongoClient, keys)
  if (!map.size) return
  for (const d of arr) enrichDoctorSpecialtyFromMap(d, map)
}

function computeAppointmentEndTime(startTime, minutes = APPT_SLOT_MINUTES) {
  const parts = String(startTime || '')
    .trim()
    .split(':')
    .map((x) => Number(x))
  const hh = parts[0]
  const mm = parts[1]
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  const d = new Date(1970, 0, 1, hh, mm + minutes)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function specialtyNameFromUserDoc(u) {
  if (!u || typeof u !== 'object') return ''
  let s = String(
    u.specialtyName || u.specialty || u.specialisation || u.major || u.chuyenKhoa || '',
  ).trim()
  if (!s && u.bio) {
    const dash = String(u.bio).match(/(?:—|-)\s*([^\n]+)/)
    if (dash) s = String(dash[1]).trim().slice(0, 80)
  }
  if (!s) {
    const sid = String(u.specialtyID || u.specialtyId || u.chuyenKhoaId || '').trim()
    if (sid) s = sid
  }
  return s
}

function deptNameFromUserDoc(u) {
  if (!u || typeof u !== 'object') return ''
  return String(u.deptName || u.department || u.departmentName || u.khoa || '').trim()
}

function doctorSpecialtyIdsFromDoc(u) {
  if (!u || typeof u !== 'object') return ''
  return String(u.specialtyID || u.specialtyId || u.chuyenKhoaId || '').trim()
}

/** Thông tin BS đầy đủ cho lịch / tiếp đón (không dùng pickFromPool để tránh hiển thị sai). */
function doctorEmbedFromUserDoc(u) {
  if (!u || typeof u !== 'object') return null
  const id = String(u._id)
  const specialtyName = specialtyNameFromUserDoc(u)
  const deptName = deptNameFromUserDoc(u)
  const sid = doctorSpecialtyIdsFromDoc(u)
  return {
    id,
    _id: id,
    firstName: u.firstName != null ? String(u.firstName) : '',
    lastName: u.lastName != null ? String(u.lastName) : '',
    email: u.email != null ? String(u.email) : '',
    displayName: patientDisplayNameFromDoc(u),
    bio: u.bio != null ? String(u.bio) : '',
    specialtyName,
    specialtyID: sid,
    specialtyId: sid,
    deptName,
    avatarUrl: String(u.avatarUrl || u.avatarURL || '').trim(),
    userType: 'doctor',
  }
}

/** Gộp user BS hiện tại với snapshot lúc đặt lịch — tránh mất chuyên khoa / tên khi một nguồn thiếu. */
function mergeDoctorAppointmentEmbeds(fromUser, fromSnap) {
  if (!fromUser && !fromSnap) return null
  if (!fromSnap) return fromUser
  if (!fromUser) return fromSnap
  const pick = (a, b) => {
    const sa = String(a ?? '').trim()
    if (sa) return sa
    return String(b ?? '').trim()
  }
  const display =
    pick(fromUser.displayName, fromSnap.displayName) ||
    patientDisplayNameFromDoc({
      displayName: '',
      firstName: pick(fromUser.firstName, fromSnap.firstName),
      lastName: pick(fromUser.lastName, fromSnap.lastName),
      email: pick(fromUser.email, fromSnap.email),
    })
  const sid = pick(fromUser.specialtyID, fromSnap.specialtyID) || pick(fromUser.specialtyId, fromSnap.specialtyId)
  return {
    id: fromUser.id || fromUser._id,
    _id: fromUser._id || fromUser.id,
    firstName: pick(fromUser.firstName, fromSnap.firstName),
    lastName: pick(fromUser.lastName, fromSnap.lastName),
    email: pick(fromUser.email, fromSnap.email),
    displayName: display,
    bio: pick(fromUser.bio, fromSnap.bio),
    specialtyName: pick(fromUser.specialtyName, fromSnap.specialtyName),
    deptName: pick(fromUser.deptName, fromSnap.deptName),
    specialtyID: sid,
    specialtyId: sid,
    avatarUrl: pick(fromUser.avatarUrl, fromSnap.avatarUrl),
    userType: 'doctor',
  }
}

function doctorResolvedForAppointment(doc, doctorUser) {
  const fromUser = doctorUser && typeof doctorUser === 'object' ? doctorEmbedFromUserDoc(doctorUser) : null
  const fromSnap = doctorFromSnapshotDoc(doc)
  const merged = mergeDoctorAppointmentEmbeds(fromUser, fromSnap)
  if (merged) return merged
  return (
    fromUser ||
    fromSnap || {
      id: String(doc.doctorId),
      _id: String(doc.doctorId),
      displayName: 'Bác sĩ',
      firstName: '',
      lastName: '',
      email: '',
      bio: '',
      specialtyName: '',
      specialtyID: '',
      specialtyId: '',
      deptName: '',
      avatarUrl: '',
      userType: 'doctor',
    }
  )
}

/** Giống quy tắc fe_clinic_ad ReceptionHome — khi BN chưa có patientCode trong DB. */
function fallbackPatientCodeFromUserId(userId) {
  const raw = String(userId ?? '').replace(/[^a-fA-F0-9]/g, '')
  const yy = String(new Date().getFullYear()).slice(-2)
  const pad = (raw + '00000000').slice(0, 8).toUpperCase()
  return `YM${yy}${pad}`
}

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

async function findPatientByEmailNorm(db, emailNorm) {
  const e = String(emailNorm || '').trim().toLowerCase()
  if (!e || !looksLikeEmail(e)) return null
  const u = await findUserByLogin(db, e)
  if (u && userTypeOf(u) === 'patient') return u
  return null
}

/** BN đăng ký trực tiếp tại quầy — không bắt buộc email/mật khẩu; email trùng → lỗi. */
async function createWalkInPatientUser(db, pat) {
  const displayName = String(pat.displayName || '').trim()
  const phone = String(pat.phone || '').trim()
  const dobRaw = pat.dob
  if (!displayName || !phone || !dobRaw) {
    return { error: 'Thiếu họ tên, số điện thoại hoặc ngày sinh để tạo hồ sơ bệnh nhân mới.' }
  }

  const emailNorm = String(pat.email || '').trim().toLowerCase()
  if (emailNorm) {
    if (!looksLikeEmail(emailNorm)) {
      return { error: 'Email không hợp lệ.' }
    }
    const dup = await findPatientByEmailNorm(db, emailNorm)
    if (dup) return { error: 'Email trùng với bệnh nhân đã có trong hệ thống.' }
  }

  const parts = displayName.split(/\s+/).filter(Boolean)
  let firstName = ''
  let lastName = ''
  const dn = displayName
  if (parts.length >= 2) {
    lastName = parts[0]
    firstName = parts.slice(1).join(' ')
  } else {
    lastName = displayName
  }

  const dobDate = new Date(dobRaw)
  if (Number.isNaN(dobDate.getTime())) {
    return { error: 'Ngày sinh không hợp lệ.' }
  }

  const gStr = String(pat.gender || '').trim()
  const col = db.collection(usersColl)
  const now = new Date()
  const doc = {
    firstName,
    lastName,
    displayName: dn,
    phone,
    dob: dobDate,
    address: String(pat.address || ''),
    userType: 'patient',
    role: 'patient',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    walkInPatient: true,
  }
  if (gStr === 'Nam') doc.gender = true
  else if (gStr === 'Nữ') doc.gender = false

  if (emailNorm) doc.email = emailNorm

  const pc = String(pat.patientCode || '').trim()
  if (pc) doc.patientCode = pc

  const ins = await col.insertOne(doc)
  const id = ins.insertedId
  if (!doc.patientCode) {
    const code = fallbackPatientCodeFromUserId(id)
    await col.updateOne({ _id: id }, { $set: { patientCode: code, updatedAt: new Date() } })
  }
  return { id }
}

function patientDisplayNameFromDoc(p) {
  if (!p || typeof p !== 'object') return ''
  const dn = String(p.displayName || '').trim()
  if (dn) return dn
  const last = String(p.lastName || '').trim()
  const first = String(p.firstName || '').trim()
  const vi = `${last} ${first}`.trim()
  if (vi) return vi
  const en = `${first} ${last}`.trim()
  if (en) return en
  return String(p.email || '').trim()
}

/** Chuẩn hóa giới tính (Mongo có thể lưu boolean hoặc chuỗi). */
function patientGenderLabelVi(g) {
  if (g === true || g === 'true') return 'Nam'
  if (g === false || g === 'false') return 'Nữ'
  const raw = String(g ?? '').trim()
  if (!raw) return ''
  const s = raw.toLowerCase()
  if (s === 'male' || s === 'nam' || s === 'm') return 'Nam'
  if (s === 'female' || s === 'nữ' || s === 'nu' || s === 'f') return 'Nữ'
  if (raw === 'Nam' || raw === 'Nữ') return raw
  return raw
}

function patientDobIso(p) {
  const dob = p?.dob
  if (dob == null || dob === '') return null
  if (dob instanceof Date) return dob.toISOString()
  const s = String(dob).trim()
  return s || null
}

function patientAgeFromDob(dobVal) {
  if (dobVal == null || dobVal === '') return null
  const d = dobVal instanceof Date ? dobVal : new Date(dobVal)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1
  return age >= 0 ? age : null
}

/** Đồng bộ vài trường BN từ form đăng ký quầy (không đổi email). */
async function mergePatientProfileFromStaffPayload(db, patientDoc, payload) {
  if (!patientDoc || !payload || typeof payload !== 'object') return
  const pid = String(payload.id || payload._id || '').trim()
  if (!pid || pid !== String(patientDoc._id)) return
  const $set = {}
  const dn = String(payload.displayName || '').trim()
  if (dn) {
    $set.displayName = dn
    const parts = dn.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      $set.lastName = parts[0]
      $set.firstName = parts.slice(1).join(' ')
    } else {
      $set.lastName = dn
      $set.firstName = ''
    }
  }
  const ph = String(payload.phone || '').trim()
  if (ph) $set.phone = ph
  if (payload.address != null) $set.address = String(payload.address || '')
  if (payload.dob) {
    const d = new Date(payload.dob)
    if (!Number.isNaN(d.getTime())) $set.dob = d
  }
  const g = String(payload.gender || '').trim()
  if (g === 'Nam') $set.gender = true
  else if (g === 'Nữ') $set.gender = false
  const pc = String(payload.patientCode || '').trim()
  if (pc && !String(patientDoc.patientCode || '').trim()) $set.patientCode = pc
  if (Object.keys($set).length === 0) return
  $set.updatedAt = new Date()
  await db.collection(usersColl).updateOne({ _id: patientDoc._id }, { $set })
}

function patientEmbedFromUserDoc(p) {
  if (!p || typeof p !== 'object') return null
  const id = String(p._id)
  const codeRaw = p.patientCode != null ? String(p.patientCode).trim() : ''
  const patientCode = codeRaw || fallbackPatientCodeFromUserId(id)
  const dobIso = patientDobIso(p)
  const ageStored = p.age
  const ageNum =
    ageStored != null && ageStored !== '' && Number.isFinite(Number(ageStored)) ? Number(ageStored) : patientAgeFromDob(p.dob)
  return {
    id,
    _id: id,
    firstName: p.firstName != null ? String(p.firstName) : '',
    lastName: p.lastName != null ? String(p.lastName) : '',
    email: p.email != null ? String(p.email) : '',
    displayName: patientDisplayNameFromDoc(p),
    patientCode,
    dob: dobIso,
    phone: p.phone != null ? String(p.phone) : '',
    gender: patientGenderLabelVi(p.gender),
    address: p.address != null ? String(p.address) : '',
    age: ageNum != null ? ageNum : null,
    userType: 'patient',
  }
}

/** Lưu kèm lịch để FE luôn có tên bác sĩ dù sau này join users lệch kiểu _id */
function buildDoctorSnapshot(d) {
  if (!d || typeof d !== 'object') return null
  const specialtyId = String(d.specialtyID || d.specialtyId || '').trim()
  const specialtyNameRaw = String(d.specialtyName || d.specialty || '').trim()
  return {
    firstName: d.firstName != null ? String(d.firstName) : '',
    lastName: d.lastName != null ? String(d.lastName) : '',
    displayName: d.displayName != null ? String(d.displayName) : '',
    email: d.email != null ? String(d.email) : '',
    specialtyName: specialtyNameRaw || specialtyId,
    specialtyID: specialtyId,
    specialtyId,
    bio: d.bio != null ? String(d.bio) : '',
    avatarUrl: String(d.avatarUrl || d.avatarURL || '').trim(),
    deptName: String(d.deptName || d.department || d.departmentName || '').trim(),
  }
}

function doctorFromSnapshotDoc(doc) {
  const s = doc?.doctorSnapshot
  if (!s || typeof s !== 'object') return null
  const did = String(doc.doctorId ?? '')
  const sid = String(s.specialtyID || s.specialtyId || '').trim()
  const snapSpecName = String(s.specialtyName || s.specialty || '').trim()
  return {
    id: did,
    _id: did,
    firstName: s.firstName != null ? String(s.firstName) : '',
    lastName: s.lastName != null ? String(s.lastName) : '',
    email: s.email != null ? String(s.email) : '',
    displayName: s.displayName != null ? String(s.displayName) : '',
    bio: s.bio != null ? String(s.bio) : '',
    specialtyName: snapSpecName || sid,
    specialtyID: sid,
    specialtyId: sid,
    avatarUrl: String(s.avatarUrl || '').trim(),
    deptName: String(s.deptName || '').trim(),
    userType: 'doctor',
  }
}

function serializeAppointment(doc, doctorUser, patientUser) {
  const id = String(doc._id)
  const doctor = doctorResolvedForAppointment(doc, doctorUser)
  const out = {
    id,
    _id: id,
    ticket: doc.ticket != null ? String(doc.ticket) : `YMA${id.slice(-10).toUpperCase()}`,
    status: doc.status != null ? String(doc.status) : 'pending',
    appointmentDate: doc.appointmentDate != null ? String(doc.appointmentDate) : null,
    startTime: doc.startTime != null ? String(doc.startTime) : null,
    endTime: doc.endTime != null ? String(doc.endTime) : null,
    source: doc.source != null ? String(doc.source) : 'online',
    bookingSource: doc.bookingSource != null ? String(doc.bookingSource) : 'online',
    note: doc.note != null ? String(doc.note) : '',
    doctor,
    cancelReason: doc.cancelReason != null ? String(doc.cancelReason) : '',
    cancelledAt:
      doc.cancelledAt instanceof Date
        ? doc.cancelledAt.toISOString()
        : doc.cancelledAt
          ? String(doc.cancelledAt)
          : null,
    cancelledBy: doc.cancelledBy && typeof doc.cancelledBy === 'object' ? doc.cancelledBy : null,
    createdByStaff: doc.createdByStaff || null,
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : doc.createdAt
          ? String(doc.createdAt)
          : null,
    confirmedAt:
      doc.confirmedAt instanceof Date
        ? doc.confirmedAt.toISOString()
        : doc.confirmedAt
          ? String(doc.confirmedAt)
          : null,
    confirmedBy: doc.confirmedBy && typeof doc.confirmedBy === 'object' ? doc.confirmedBy : null,
  }
  const pe = patientEmbedFromUserDoc(patientUser)
  if (pe) out.patient = pe
  return out
}

/** Mongo có thể lưu _id / doctorId là ObjectId hoặc string cùng giá trị hex — $in cần cả hai dạng. */
function idValuesForInClause(ids) {
  const out = []
  const seen = new Set()
  for (const raw of ids) {
    const s = String(raw ?? '').trim()
    if (!s) continue
    if (!seen.has(`s:${s}`)) {
      seen.add(`s:${s}`)
      out.push(s)
    }
    try {
      const oid = new ObjectId(s)
      const key = `o:${String(oid)}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(oid)
      }
    } catch {
      /* không phải ObjectId 24 hex */
    }
  }
  return out
}

async function findUsersByIds(db, ids) {
  const inVals = idValuesForInClause(ids)
  if (!inVals.length) return []
  return db
    .collection(usersColl)
    .find({ _id: { $in: inVals } })
    .project({ password: 0, passwordHash: 0, hash: 0 })
    .toArray()
}

async function findUserByLogin(db, login) {
  const raw = String(login || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const col = db.collection(usersColl)
  return col.findOne({
    $or: [{ email: raw }, { email: lower }, { phone: raw }],
  })
}

async function verifyPassword(plain, stored) {
  const s = String(stored || '')
  if (!s || !plain) return false
  if (s.startsWith('$2a$') || s.startsWith('$2b$') || s.startsWith('$2y$')) {
    return bcrypt.compare(String(plain), s)
  }
  return false
}

function signUserToken(userDoc) {
  if (!jwtSecret) throw new Error('MISSING_JWT_SECRET')
  const sub = String(userDoc._id)
  const userType = userTypeOf(userDoc) || 'patient'
  return jwt.sign({ sub, userType, email: String(userDoc.email || '') }, jwtSecret, { expiresIn: '7d' })
}

function authBearer(req, res, next) {
  const h = req.headers.authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) {
    res.status(401).json({ message: 'Thiếu token.' })
    return
  }
  if (!jwtSecret) {
    res.status(500).json({ message: 'Thiếu JWT_SECRET trong .env.' })
    return
  }
  try {
    req.auth = jwt.verify(m[1], jwtSecret)
    next()
  } catch {
    res.status(401).json({ message: 'Token không hợp lệ.' })
  }
}

/** Đăng ký một bước (tùy chọn — fe_clinic có thể gọi trực tiếp) */
app.post('/api/auth/register', async (req, res) => {
  try {
    if (!jwtSecret) {
      res.status(500).json({ message: 'Thiếu JWT_SECRET trong .env.' })
      return
    }
    await client.connect()
    const firstName = String(req.body?.firstName || '').trim()
    const lastName = String(req.body?.lastName || '').trim()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')
    if (!email || !password || password.length < 6) {
      res.status(400).json({ message: 'Email và mật khẩu (≥6 ký tự) là bắt buộc.' })
      return
    }
    const db = client.db(dbName)
    const existing = await findUserByLogin(db, email)
    if (existing) {
      res.status(400).json({ message: 'Email đã được đăng ký.' })
      return
    }
    const hash = await bcrypt.hash(password, 10)
    const col = db.collection(usersColl)
    const doc = {
      email,
      firstName,
      lastName,
      phone,
      userType: 'patient',
      password: hash,
    }
    const r = await col.insertOne(doc)
    const user = await col.findOne({ _id: r.insertedId })
    const token = signUserToken(user)
    res.status(201).json({ token, user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Bước 1 đăng ký bệnh nhân — OTP in log console (dev) */
app.post('/api/auth/start-register', async (req, res) => {
  try {
    await client.connect()
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ message: 'Email không hợp lệ.' })
      return
    }
    const db = client.db(dbName)
    const user = await findUserByLogin(db, email)
    if (user) {
      res.status(400).json({ message: 'Email đã được sử dụng.' })
      return
    }
    clearPendingReg(email)
    const otp = randomOtp6()
    const verificationToken = randomBytes(20).toString('hex')
    const expires = Date.now() + OTP_TTL_MS
    regByVerifyToken.set(verificationToken, { email, otp, expires })
    regByEmail.set(email, { verificationToken, otp, expires })
    console.log(`[be_clinic] OTP đăng ký ${email}: ${otp}`)
    res.json({ verificationToken, emailMask: maskEmail(email) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email) {
      res.status(400).json({ message: 'Thiếu email.' })
      return
    }
    const pending = regByEmail.get(email)
    if (!pending?.verificationToken) {
      res.status(400).json({ message: 'Chưa có phiên OTP cho email này. Hãy bắt đầu đăng ký lại.' })
      return
    }
    const otp = randomOtp6()
    const expires = Date.now() + OTP_TTL_MS
    pending.otp = otp
    pending.expires = expires
    const s = regByVerifyToken.get(pending.verificationToken)
    if (s) {
      s.otp = otp
      s.expires = expires
    }
    console.log(`[be_clinic] OTP đăng ký (gửi lại) ${email}: ${otp}`)
    res.json({ verificationToken: pending.verificationToken, emailMask: maskEmail(email) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const verificationToken = String(req.body?.verificationToken || '').trim()
    const otp = String(req.body?.otp || '').trim()
    if (!verificationToken || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ message: 'Thiếu token hoặc OTP không hợp lệ (6 chữ số).' })
      return
    }
    const s = regByVerifyToken.get(verificationToken)
    if (!s || Date.now() > s.expires) {
      res.status(400).json({ message: 'OTP hết hạn hoặc phiên không hợp lệ.' })
      return
    }
    if (String(s.otp) !== otp) {
      res.status(401).json({ message: 'OTP không đúng.' })
      return
    }
    regByVerifyToken.delete(verificationToken)
    regByEmail.delete(s.email)
    const completeToken = randomBytes(24).toString('hex')
    completeByToken.set(completeToken, { email: s.email, expires: Date.now() + OTP_TTL_MS })
    res.json({ completeToken, emailMask: maskEmail(s.email) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.post('/api/auth/complete-register', async (req, res) => {
  try {
    if (!jwtSecret) {
      res.status(500).json({ message: 'Thiếu JWT_SECRET trong .env.' })
      return
    }
    const completeToken = String(req.body?.completeToken || '').trim()
    const firstName = String(req.body?.firstName || '').trim()
    const lastName = String(req.body?.lastName || '').trim()
    const phone = String(req.body?.phone || '').trim()
    const password = String(req.body?.password || '')
    if (!completeToken || !firstName || !lastName || !phone || password.length < 6) {
      res.status(400).json({ message: 'Thiếu thông tin hoặc mật khẩu quá ngắn.' })
      return
    }
    const sess = completeByToken.get(completeToken)
    if (!sess || Date.now() > sess.expires) {
      res.status(400).json({ message: 'Phiên đăng ký hết hạn. Vui lòng bắt đầu lại.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const col = db.collection(usersColl)
    const exists = await findUserByLogin(db, sess.email)
    if (exists) {
      completeByToken.delete(completeToken)
      res.status(400).json({ message: 'Email đã được đăng ký.' })
      return
    }
    const hash = await bcrypt.hash(password, 10)
    const doc = {
      email: sess.email,
      firstName,
      lastName,
      phone,
      userType: 'patient',
      password: hash,
    }
    const r = await col.insertOne(doc)
    const user = await col.findOne({ _id: r.insertedId })
    completeByToken.delete(completeToken)
    const token = signUserToken(user)
    res.json({ token, user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Đăng nhập nhân viên (fe_clinic_ad) */
app.post('/api/auth/staff-login', async (req, res) => {
  try {
    if (!jwtSecret) {
      res.status(500).json({ message: 'Thiếu JWT_SECRET trong .env.' })
      return
    }
    await client.connect()
    const email = String(req.body?.email || '').trim()
    const password = String(req.body?.password || '')
    if (!email || !password) {
      res.status(400).json({ message: 'Vui lòng nhập email và mật khẩu.' })
      return
    }
    const db = client.db(dbName)
    const user = await findUserByLogin(db, email)
    if (!user) {
      res.status(401).json({ message: 'Sai email hoặc mật khẩu.' })
      return
    }
    const hash = user.password || user.passwordHash || user.hash
    if (!(await verifyPassword(password, hash))) {
      res.status(401).json({ message: 'Sai email hoặc mật khẩu.' })
      return
    }
    const ut = userTypeOf(user)
    if (!['doctor', 'receptionist', 'registration'].includes(ut)) {
      res.status(403).json({ message: 'Tài khoản không phải nhân viên.' })
      return
    }
    const token = signUserToken(user)
    res.json({ token, user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Đăng nhập bệnh nhân (fe_clinic) */
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!jwtSecret) {
      res.status(500).json({ message: 'Thiếu JWT_SECRET trong .env.' })
      return
    }
    await client.connect()
    const email = String(req.body?.email || '').trim()
    const password = String(req.body?.password || '')
    if (!email || !password) {
      res.status(400).json({ message: 'Vui lòng nhập email/số điện thoại và mật khẩu.' })
      return
    }
    const db = client.db(dbName)
    const user = await findUserByLogin(db, email)
    if (!user) {
      res.status(401).json({ message: 'Sai email hoặc mật khẩu.' })
      return
    }
    const hash = user.password || user.passwordHash || user.hash
    if (!(await verifyPassword(password, hash))) {
      res.status(401).json({ message: 'Sai email hoặc mật khẩu.' })
      return
    }
    const ut = userTypeOf(user)
    if (ut !== 'patient') {
      res.status(403).json({ message: 'Chỉ tài khoản bệnh nhân được đăng nhập tại đây.' })
      return
    }
    const token = signUserToken(user)
    res.json({ token, user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.get('/api/auth/me', authBearer, async (req, res) => {
  try {
    await client.connect()
    const db = client.db(dbName)
    let oid
    try {
      oid = new ObjectId(String(req.auth.sub))
    } catch {
      res.status(401).json({ message: 'Token không hợp lệ.' })
      return
    }
    const user = await db.collection(usersColl).findOne({ _id: oid })
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' })
      return
    }
    res.json({ user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.patch('/api/auth/me', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'patient') {
      res.status(403).json({ message: 'Chỉ tài khoản bệnh nhân cập nhật hồ sơ tại đây.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    let oid
    try {
      oid = new ObjectId(String(req.auth.sub))
    } catch {
      res.status(401).json({ message: 'Token không hợp lệ.' })
      return
    }
    const allowed = [
      'dob',
      'ethnicity',
      'citizenId',
      'address',
      'gender',
      'phone',
      'firstName',
      'lastName',
      'displayName',
    ]
    const updates = {}
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
        updates[k] = req.body[k]
      }
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ message: 'Không có trường cập nhật.' })
      return
    }
    await db.collection(usersColl).updateOne({ _id: oid }, { $set: updates })
    const user = await db.collection(usersColl).findOne({ _id: oid })
    if (!user) {
      res.status(404).json({ message: 'Không tìm thấy người dùng.' })
      return
    }
    res.json({ user: publicUser(user) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

function staffReceptionOrRegistration(req) {
  const ut = String(req.auth?.userType || '').toLowerCase()
  return ut === 'receptionist' || ut === 'registration'
}

function stubFreeSlots() {
  return {
    freeSlots: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '13:30', '14:00', '14:30', '15:00', '15:30'],
  }
}

/** Danh sách lịch — tiếp đón / đăng ký (ReceptionHome, RegistrationHome) */
app.get('/api/appointments/reception', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký mới xem được danh sách này.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const filter = {}
    const from = String(req.query.from || '').trim()
    const to = String(req.query.to || '').trim()
    if (from && to) filter.appointmentDate = { $gte: from, $lte: to }
    else if (from) filter.appointmentDate = { $gte: from }
    else if (to) filter.appointmentDate = { $lte: to }
    const st = String(req.query.status || '').trim()
    if (st && st !== 'all') filter.status = st
    const rows = await appointmentsCollection(db).find(filter).sort({ createdAt: -1 }).limit(400).toArray()
    const patientIds = [...new Set(rows.map((r) => (r.patientId ? String(r.patientId) : '')).filter(Boolean))]
    const doctorIds = [...new Set(rows.map((r) => String(r.doctorId)).filter(Boolean))]
    const [pUsers, dUsers] = await Promise.all([findUsersByIds(db, patientIds), findUsersByIds(db, doctorIds)])
    const pMap = new Map(pUsers.map((u) => [String(u._id), u]))
    const dMap = new Map(dUsers.map((u) => [String(u._id), u]))
    let list = rows.map((r) =>
      serializeAppointment(r, dMap.get(String(r.doctorId)), r.patientId ? pMap.get(String(r.patientId)) : null),
    )
    const q = String(req.query.q || '').trim().toLowerCase()
    if (q) {
      list = list.filter((a) => {
        const ticket = String(a.ticket || '').toLowerCase()
        const pname = `${a.patient?.lastName || ''} ${a.patient?.firstName || ''}`.trim().toLowerCase()
        return (
          ticket.includes(q) ||
          pname.includes(q) ||
          String(a.patient?.patientCode || '').toLowerCase().includes(q) ||
          String(a.patient?.email || '').toLowerCase().includes(q)
        )
      })
    }
    await enrichAppointmentsSpecialtyNames(client, list)
    res.json({ appointments: list })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Tạo lịch tại quầy */
app.post('/api/appointments/reception', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký mới tạo lịch.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const appointmentDate = String(req.body?.appointmentDate || '').trim() || null
    const startTime = String(req.body?.startTime || '').trim() || null
    const endTime = computeAppointmentEndTime(startTime)
    const note = String(req.body?.note || '')

    let patientOid = null
    let patientCreated = false
    const pat = req.body?.patient
    if (pat && (pat.id || pat._id)) {
      try {
        patientOid = new ObjectId(String(pat.id || pat._id))
      } catch {
        patientOid = null
      }
    }

    if (!patientOid) {
      const login = String(req.body?.patientEmailOrPhone || '').trim()
      if (login) {
        const u = await findUserByLogin(db, login)
        if (u && userTypeOf(u) === 'patient') patientOid = u._id
      }
    }

    const emailFromPat = String(pat?.email || '').trim().toLowerCase()
    if (!patientOid && emailFromPat && looksLikeEmail(emailFromPat)) {
      const taken = await findPatientByEmailNorm(db, emailFromPat)
      if (taken) {
        res.status(400).json({ message: 'Email trùng với bệnh nhân đã có trong hệ thống.' })
        return
      }
    }

    if (!patientOid && pat && typeof pat === 'object') {
      const created = await createWalkInPatientUser(db, pat)
      if (created.error) {
        res.status(400).json({ message: created.error })
        return
      }
      if (created.id) {
        patientOid = created.id
        patientCreated = true
      }
    }

    if (!patientOid) {
      res.status(400).json({
        message:
          'Cần chọn bệnh nhân từ danh sách, hoặc nhập SĐT/email đã đăng ký, hoặc điền đủ họ tên + SĐT + ngày sinh để tạo hồ sơ mới tại quầy.',
      })
      return
    }

    let doctorOid = null
    if (req.body?.doctorId) {
      try {
        doctorOid = new ObjectId(String(req.body.doctorId).trim())
      } catch {
        doctorOid = null
      }
    }
    if (!doctorOid) {
      res.status(400).json({ message: 'Thiếu bác sĩ (doctorId).' })
      return
    }
    const doctor = await findDoctorByIdFlexible(db, String(req.body.doctorId).trim())
    if (!doctor) {
      res.status(400).json({ message: 'Không tìm thấy bác sĩ theo doctorId (kiểm tra userType/role trong Mongo).' })
      return
    }
    const patient = await findUserByIdFlexible(db, String(patientOid))
    if (!patient || userTypeOf(patient) !== 'patient') {
      res.status(400).json({ message: 'Không tìm thấy bệnh nhân.' })
      return
    }
    await mergePatientProfileFromStaffPayload(db, patient, pat)
    const patientFresh = await findUserByIdFlexible(db, String(patientOid))

    const now = new Date()
    const ins = await appointmentsCollection(db).insertOne({
      patientId: patientFresh._id,
      doctorId: doctor._id,
      doctorSnapshot: buildDoctorSnapshot(doctor),
      appointmentDate,
      startTime,
      endTime,
      status: 'pending',
      ticket: '',
      source: 'clinic',
      bookingSource: 'clinic',
      note,
      createdByStaff: req.body?.createdByStaff || null,
      createdAt: now,
      updatedAt: now,
    })
    const idStr = String(ins.insertedId)
    const ticket = `YMA${idStr.slice(-10).toUpperCase()}`
    await appointmentsCollection(db).updateOne({ _id: ins.insertedId }, { $set: { ticket } })
    const doc = await appointmentsCollection(db).findOne({ _id: ins.insertedId })
    const appointment = serializeAppointment(doc, doctor, patientFresh)
    await enrichAppointmentsSpecialtyNames(client, [appointment])
    res.status(201).json({ ticket, appointment, patientCreated })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Danh sách BN cho picker đăng ký / tiếp đón */
app.get('/api/appointments/patients', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const col = db.collection(usersColl)
    const page = Math.max(1, Number(req.query.page || 1) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10) || 10))
    const patientCode = String(req.query.patientCode || '').trim()
    const name = String(req.query.name || '').trim()
    const phone = String(req.query.phone || '').trim()
    const account = String(req.query.account || '').trim().toLowerCase()

    const and = [
      {
        $or: [{ userType: { $regex: /^patient$/i } }, { role: { $regex: /^patient$/i } }],
      },
    ]
    if (patientCode) {
      and.push({ patientCode: new RegExp(escapeRegex(patientCode), 'i') })
    }
    if (name) {
      const rx = new RegExp(escapeRegex(name), 'i')
      and.push({
        $or: [{ displayName: rx }, { firstName: rx }, { lastName: rx }],
      })
    }
    if (phone) {
      and.push({ phone: new RegExp(escapeRegex(phone), 'i') })
    }
    if (account) {
      and.push({ email: new RegExp(escapeRegex(account), 'i') })
    }

    const filter = { $and: and }
    const total = await col.countDocuments(filter)
    const rows = await col
      .find(filter)
      .project({ password: 0, passwordHash: 0, hash: 0 })
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray()
    const patients = rows.map((u) => patientEmbedFromUserDoc(u)).filter(Boolean)
    res.json({ patients, total })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Lịch sử theo BN */
app.get('/api/appointments/patient-history', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký.' })
      return
    }
    const patientId = String(req.query.patientId || '').trim()
    if (!patientId) {
      res.status(400).json({ message: 'Thiếu patientId.' })
      return
    }
    let poid
    try {
      poid = new ObjectId(patientId)
    } catch {
      res.status(400).json({ message: 'patientId không hợp lệ.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const rows = await appointmentsCollection(db)
      .find({ patientId: poid })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()
    const doctorIds = [...new Set(rows.map((r) => String(r.doctorId)).filter(Boolean))]
    const dUsers = await findUsersByIds(db, doctorIds)
    const dMap = new Map(dUsers.map((u) => [String(u._id), u]))
    const patient = await db.collection(usersColl).findOne({ _id: poid })
    const appointments = rows.map((r) => serializeAppointment(r, dMap.get(String(r.doctorId)), patient))
    await enrichAppointmentsSpecialtyNames(client, appointments)
    res.json({ appointments })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Tra BN theo mã */
app.get('/api/appointments/patient-by-code', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký.' })
      return
    }
    await client.connect()
    const code = String(req.query.code || '').trim()
    if (!code) {
      res.status(400).json({ message: 'Thiếu mã bệnh nhân.' })
      return
    }
    const db = client.db(dbName)
    const col = db.collection(usersColl)
    const patientOr = [{ patientCode: code }, { patientCode: code.toUpperCase() }]
    if (code.includes('@')) {
      patientOr.push({ email: code.toLowerCase() })
    }
    const pat = await col.findOne({
      $and: [
        { $or: [{ userType: { $regex: /^patient$/i } }, { role: { $regex: /^patient$/i } }] },
        { $or: patientOr },
      ],
    })
    if (!pat) {
      res.json({ patient: null })
      return
    }
    res.json({ patient: patientEmbedFromUserDoc(pat) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Tra cứu mã vé */
app.get('/api/appointments/lookup-ticket', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const ticket = String(req.query.ticket || '').trim()
    if (!ticket) {
      res.status(400).json({ message: 'Thiếu mã vé.' })
      return
    }
    const doc = await appointmentsCollection(db).findOne({ ticket })
    if (!doc) {
      res.status(404).json({ message: 'Không tìm thấy lịch theo mã vé.' })
      return
    }
    const [doctor, patient] = await Promise.all([
      findDoctorByIdFlexible(db, String(doc.doctorId ?? '').trim()),
      doc.patientId ? db.collection(usersColl).findOne({ _id: doc.patientId }) : null,
    ])
    const appointment = serializeAppointment(doc, doctor, patient)
    await enrichAppointmentsSpecialtyNames(client, [appointment])
    res.json({
      ticket: appointment.ticket,
      appointment,
      patient: patient ? patientEmbedFromUserDoc(patient) : null,
      doctor: appointment.doctor,
    })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Khung giờ trống — bệnh nhân & nhân viên */
app.get('/api/appointments/availability', authBearer, async (_req, res) => {
  try {
    await client.connect()
    res.json(stubFreeSlots())
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Cập nhật trạng thái lịch */
app.patch('/api/appointments/:id/status', authBearer, async (req, res) => {
  try {
    if (!staffReceptionOrRegistration(req)) {
      res.status(403).json({ message: 'Chỉ tiếp đón/đăng ký.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const id = String(req.params.id || '').trim()
    let oid
    try {
      oid = new ObjectId(id)
    } catch {
      res.status(400).json({ message: 'Id lịch không hợp lệ.' })
      return
    }

    const status = String(req.body?.status || 'pending')
      .trim()
      .toLowerCase() || 'pending'
    if (!['pending', 'confirmed', 'cancelled', 'examined', 'done', 'completed'].includes(status)) {
      res.status(400).json({ message: 'Trạng thái không hợp lệ.' })
      return
    }
    const normStatus = status === 'done' || status === 'completed' ? 'examined' : status

    const staffOidRaw = String(req.auth?.sub || '').trim()
    const staffDoc = staffOidRaw ? await findUserByIdFlexible(db, staffOidRaw) : null
    const staffEmail = String(req.auth?.email || staffDoc?.email || '').trim()
    const staffDisplayName = String(
      staffDoc?.displayName ||
        [staffDoc?.lastName, staffDoc?.firstName].filter(Boolean).join(' ').trim() ||
        staffEmail ||
        'Nhân viên phòng khám',
    ).trim()

    const setDoc = { status: normStatus, updatedAt: new Date() }
    if (req.body?.note !== undefined) setDoc.note = String(req.body.note || '')

    if (normStatus === 'cancelled') {
      const bySystem =
        req.body?.cancelledBySystem === true ||
        req.body?.cancelledBySystem === 'true' ||
        req.body?.cancelledBySystem === 1
      const reasonRaw = String(req.body?.cancelReason ?? req.body?.reason ?? '').trim()
      setDoc.cancelReason =
        reasonRaw || 'Quá thời gian chờ xác nhận — khung giờ khám đã kết thúc, hệ thống tự hủy lịch.'
      setDoc.cancelledAt = new Date()
      setDoc.cancelledBy = bySystem
        ? {
            role: 'system',
            id: 'system',
            displayName: 'Hệ thống',
            email: '',
            userType: 'system',
          }
        : {
            role: 'staff',
            id: staffOidRaw || String(staffDoc?._id || ''),
            displayName: staffDisplayName,
            email: staffEmail,
            userType: String(req.auth?.userType || staffDoc?.userType || 'staff'),
          }
      // Clear confirm metadata when cancelled
      setDoc.confirmedAt = null
      setDoc.confirmedBy = null
    } else if (normStatus === 'confirmed') {
      setDoc.cancelReason = ''
      setDoc.cancelledAt = null
      setDoc.cancelledBy = null
      setDoc.confirmedAt = new Date()
      setDoc.confirmedBy = {
        role: 'staff',
        id: staffOidRaw || String(staffDoc?._id || ''),
        displayName: staffDisplayName,
        email: staffEmail,
        userType: String(req.auth?.userType || staffDoc?.userType || 'staff'),
      }
    } else if (normStatus === 'pending') {
      setDoc.cancelReason = ''
      setDoc.cancelledAt = null
      setDoc.cancelledBy = null
      setDoc.confirmedAt = null
      setDoc.confirmedBy = null
    }

    const r = await appointmentsCollection(db).updateOne({ _id: oid }, { $set: setDoc })
    if (r.matchedCount === 0) {
      res.status(404).json({ message: 'Không tìm thấy lịch.' })
      return
    }
    const doc = await appointmentsCollection(db).findOne({ _id: oid })
    const [doctor, patient] = await Promise.all([
      doc ? findDoctorByIdFlexible(db, String(doc.doctorId ?? '').trim()) : null,
      doc?.patientId ? db.collection(usersColl).findOne({ _id: doc.patientId }) : null,
    ])
    const ap = doc ? serializeAppointment(doc, doctor, patient) : { id, status: normStatus }
    if (ap && typeof ap === 'object' && ap.doctor) await enrichAppointmentsSpecialtyNames(client, [ap])
    res.json({ ok: true, appointment: ap })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Bác sĩ kết thúc khám → đổi trạng thái sang examined */
app.patch('/api/appointments/:id/finish-exam', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'doctor') {
      res.status(403).json({ message: 'Chỉ bác sĩ mới kết thúc khám.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const id = String(req.params.id || '').trim()
    let oid
    try {
      oid = new ObjectId(id)
    } catch {
      res.status(400).json({ message: 'Id lịch không hợp lệ.' })
      return
    }

    const doctor = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!doctor || userTypeOf(doctor) !== 'doctor') {
      res.status(401).json({ message: 'Token không hợp lệ hoặc không phải bác sĩ.' })
      return
    }

    const appt = await appointmentsCollection(db).findOne({ _id: oid })
    if (!appt) {
      res.status(404).json({ message: 'Không tìm thấy lịch.' })
      return
    }
    if (String(appt.doctorId) !== String(doctor._id)) {
      res.status(403).json({ message: 'Bạn không có quyền kết thúc khám lịch này.' })
      return
    }
    if (String(appt.status || '').toLowerCase() === 'cancelled') {
      res.status(400).json({ message: 'Lịch đã hủy nên không thể kết thúc khám.' })
      return
    }

    await appointmentsCollection(db).updateOne({ _id: oid }, { $set: { status: 'examined', updatedAt: new Date() } })

    const next = await appointmentsCollection(db).findOne({ _id: oid })
    const [docUser, patient] = await Promise.all([
      next ? findDoctorByIdFlexible(db, String(next.doctorId ?? '').trim()) : null,
      next?.patientId ? db.collection(usersColl).findOne({ _id: next.patientId }) : null,
    ])
    const ap = next ? serializeAppointment(next, docUser, patient) : { id, status: 'examined' }
    if (ap && typeof ap === 'object' && ap.doctor) await enrichAppointmentsSpecialtyNames(client, [ap])
    res.json({ ok: true, appointment: ap })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Đặt lịch online (fe_clinic) */
app.post('/api/appointments', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'patient') {
      res.status(403).json({ message: 'Chỉ bệnh nhân đặt lịch tại đây.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const patient = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!patient || userTypeOf(patient) !== 'patient') {
      res.status(401).json({ message: 'Token không hợp lệ hoặc không phải tài khoản bệnh nhân.' })
      return
    }
    const doctorIdRaw = String(req.body?.doctorId || '').trim()
    if (!doctorIdRaw) {
      res.status(400).json({ message: 'Thiếu doctorId.' })
      return
    }
    const doctor = await findDoctorByIdFlexible(db, doctorIdRaw)
    if (!doctor) {
      res.status(400).json({
        message:
          'Không tìm thấy bác sĩ theo mã đã chọn. Hãy tải lại trang và chọn lại bác sĩ; trong MongoDB user cần userType hoặc role xác định là bác sĩ (doctor).',
      })
      return
    }
    const appointmentDate = String(req.body?.appointmentDate || '').trim() || null
    const startTime = String(req.body?.startTime || '').trim() || null
    const endTime = computeAppointmentEndTime(startTime)
    const now = new Date()
    const ins = await appointmentsCollection(db).insertOne({
      patientId: patient._id,
      doctorId: doctor._id,
      doctorSnapshot: buildDoctorSnapshot(doctor),
      appointmentDate,
      startTime,
      endTime,
      status: 'pending',
      ticket: '',
      source: String(req.body?.source || 'online'),
      bookingSource: String(req.body?.bookingSource || 'online'),
      note: String(req.body?.note || ''),
      createdAt: now,
      updatedAt: now,
    })
    const idStr = String(ins.insertedId)
    const ticket = `YMA${idStr.slice(-10).toUpperCase()}`
    await appointmentsCollection(db).updateOne({ _id: ins.insertedId }, { $set: { ticket } })
    const doc = await appointmentsCollection(db).findOne({ _id: ins.insertedId })
    const appointment = serializeAppointment(doc, doctor, patient)
    await enrichAppointmentsSpecialtyNames(client, [appointment])
    res.status(201).json({ ticket, appointment })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.get('/api/appointments/my', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'patient') {
      res.status(403).json({ message: 'Chỉ bệnh nhân xem lịch của mình.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const patient = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!patient || userTypeOf(patient) !== 'patient') {
      res.status(401).json({ message: 'Token không hợp lệ.' })
      return
    }
    const rows = await appointmentsCollection(db)
      .find({ patientId: patient._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()
    const doctorIds = [...new Set(rows.map((r) => String(r.doctorId)).filter(Boolean))]
    const dUsers = await findUsersByIds(db, doctorIds)
    const dMap = new Map(dUsers.map((u) => [String(u._id), u]))
    const appointments = rows.map((r) => serializeAppointment(r, dMap.get(String(r.doctorId)), patient))
    await enrichAppointmentsSpecialtyNames(client, appointments)
    res.json({ appointments })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.patch('/api/appointments/:id/cancel', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'patient') {
      res.status(403).json({ message: 'Chỉ bệnh nhân hủy lịch tại đây.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const id = String(req.params.id || '').trim()
    let oid
    try {
      oid = new ObjectId(id)
    } catch {
      res.status(400).json({ message: 'Id lịch không hợp lệ.' })
      return
    }
    const patientUser = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!patientUser || userTypeOf(patientUser) !== 'patient') {
      res.status(401).json({ message: 'Token không hợp lệ.' })
      return
    }
    const doc = await appointmentsCollection(db).findOne({ _id: oid, patientId: patientUser._id })
    if (!doc) {
      res.status(404).json({ message: 'Không tìm thấy lịch của bạn.' })
      return
    }
    if (String(doc.status).toLowerCase() === 'cancelled') {
      const doctor = await findUserByIdFlexible(db, String(doc.doctorId))
      const ap = serializeAppointment(doc, doctor, patientUser)
      await enrichAppointmentsSpecialtyNames(client, [ap])
      res.json({ ok: true, appointment: ap })
      return
    }
    const cancelReason = String(req.body?.cancelReason || '').trim() || 'Đã hủy'
    const cancelledBy = {
      userType: 'patient',
      role: 'patient',
      email: String(req.auth.email || patientUser?.email || ''),
      displayName: String(
        patientUser?.displayName ||
          [patientUser?.lastName, patientUser?.firstName].filter(Boolean).join(' ').trim() ||
          patientUser?.email ||
          '',
      ).trim(),
    }
    await appointmentsCollection(db).updateOne(
      { _id: oid },
      {
        $set: {
          status: 'cancelled',
          cancelReason,
          cancelledAt: new Date(),
          cancelledBy,
          updatedAt: new Date(),
        },
      },
    )
    const next = await appointmentsCollection(db).findOne({ _id: oid })
    const doctor = await findUserByIdFlexible(db, String(next.doctorId))
    const ap = serializeAppointment(next, doctor, patientUser)
    await enrichAppointmentsSpecialtyNames(client, [ap])
    res.json({ ok: true, appointment: ap })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Bác sĩ — danh sách lịch */
app.get('/api/appointments/doctor', authBearer, async (req, res) => {
  const ut = String(req.auth?.userType || '').toLowerCase()
  if (ut !== 'doctor') {
    res.status(403).json({ message: 'Chỉ bác sĩ mới xem được danh sách này.' })
    return
  }
  try {
    await client.connect()
    const db = client.db(dbName)
    const doctor = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!doctor || !isDoctorUser(doctor)) {
      res.status(401).json({ message: 'Token không hợp lệ hoặc không phải bác sĩ.' })
      return
    }
    const doctorOid = doctor._id
    const rows = await appointmentsCollection(db)
      .find({ doctorId: doctorOid })
      .sort({ appointmentDate: -1, startTime: -1 })
      .limit(300)
      .toArray()
    const patientIds = [...new Set(rows.map((r) => (r.patientId ? String(r.patientId) : '')).filter(Boolean))]
    const pUsers = await findUsersByIds(db, patientIds)
    const pMap = new Map(pUsers.map((u) => [String(u._id), u]))
    const appointments = rows.map((r) => serializeAppointment(r, doctor, r.patientId ? pMap.get(String(r.patientId)) : null))
    await enrichAppointmentsSpecialtyNames(client, appointments)
    res.json({ appointments })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Khi user bác sĩ trong Mongo chưa có chuyên khoa — gán tạm theo id để UI fe_clinic có dữ liệu. */
const SPECIALTY_FALLBACK_POOL = [
  'Nội tổng quát',
  'Tim mạch',
  'Nhi khoa',
  'Sản — Phụ khoa',
  'Thần kinh',
  'Chấn thương chỉnh hình',
  'Da liễu',
  'Tai Mũi Họng',
  'Tiêu hóa',
  'Nội tiết',
]

function pickFromPool(pool, seedStr) {
  let h = 0
  const s = String(seedStr || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return pool[h % pool.length]
}

function slugDeptIdFromName(name) {
  const raw = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return raw ? `dept-${raw}` : 'dept-chuyen-khoa'
}

function mapDoctorPublic(u) {
  const id = String(u._id)
  const firstName = u.firstName != null ? String(u.firstName) : ''
  const lastName = u.lastName != null ? String(u.lastName) : ''
  const email = u.email != null ? String(u.email) : ''
  const displayName = u.displayName != null ? String(u.displayName) : ''
  const bio = u.bio != null ? String(u.bio) : ''

  let specialtyName = String(
    u.specialtyName || u.specialty || u.specialisation || u.major || u.chuyenKhoa || '',
  ).trim()
  if (!specialtyName && bio) {
    const dash = bio.match(/(?:—|-)\s*([^\n]+)/)
    if (dash) specialtyName = String(dash[1]).trim().slice(0, 80)
  }
  if (!specialtyName) {
    const sid = String(u.specialtyID || u.specialtyId || u.chuyenKhoaId || '').trim()
    if (sid) specialtyName = sid
  }
  if (!specialtyName) {
    specialtyName = pickFromPool(SPECIALTY_FALLBACK_POOL, id)
  }

  let deptName = String(u.deptName || u.department || u.departmentName || u.khoa || '').trim()
  let deptID = String(u.deptID || u.deptId || u.departmentId || '').trim()
  if (!deptName) deptName = specialtyName
  if (!deptID) deptID = slugDeptIdFromName(deptName)

  const exp =
    u.experienceYears ?? u.yearsOfExperience ?? u.years ?? u.experience ?? u.expYears ?? null
  const experienceYears =
    exp !== null && exp !== undefined && String(exp).trim() !== '' ? Number(String(exp).replace(/[^\d.]/g, '')) : null

  const avatarUrl = String(
    u.avatarUrl || u.avatarURL || u.imageUrl || u.image_url || u.photoUrl || u.photo_url || '',
  ).trim()

  const sidRaw = String(u.specialtyID || u.specialtyId || u.chuyenKhoaId || '').trim()

  return {
    id,
    _id: id,
    firstName,
    lastName,
    email,
    displayName,
    userType: 'doctor',
    bio,
    specialtyName,
    specialty: specialtyName,
    deptID,
    deptName,
    ...(sidRaw ? { specialtyID: sidRaw, specialtyId: sidRaw } : {}),
    ...(Number.isFinite(experienceYears) && experienceYears > 0 ? { experienceYears } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

/** Danh sách bác sĩ (userType doctor trong Mongo) — đủ trường cho landing fe_clinic */
app.get('/api/doctors', async (_req, res) => {
  try {
    await client.connect()
    const db = client.db(dbName)
    const rows = await db
      .collection(usersColl)
      .find({
        $or: [{ userType: { $regex: /doctor/i } }, { role: { $regex: /doctor/i } }],
      })
      .project({ password: 0, passwordHash: 0, hash: 0 })
      .limit(200)
      .toArray()
    const doctors = rows.filter(isDoctorUser).slice(0, 80).map(mapDoctorPublic)
    await enrichPublicDoctorsSpecialtyNames(client, doctors)
    res.json({ doctors })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.post('/api/examinations', authBearer, async (_req, res) => {
  try {
    const ut = String(_req.auth?.userType || '').toLowerCase()
    if (ut !== 'doctor') {
      res.status(403).json({ message: 'Chỉ bác sĩ mới lưu được khám bệnh.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)

    const appointmentIdRaw = String(_req.body?.appointmentId || '').trim()
    let appointmentOid
    try {
      appointmentOid = new ObjectId(appointmentIdRaw)
    } catch {
      res.status(400).json({ message: 'appointmentId không hợp lệ.' })
      return
    }

    const doctor = await findUserByIdFlexible(db, String(_req.auth.sub || '').trim())
    if (!doctor || userTypeOf(doctor) !== 'doctor') {
      res.status(401).json({ message: 'Token không hợp lệ hoặc không phải bác sĩ.' })
      return
    }

    const appt = await appointmentsCollection(db).findOne({ _id: appointmentOid })
    if (!appt) {
      res.status(404).json({ message: 'Không tìm thấy lịch hẹn.' })
      return
    }
    // Chỉ cho phép lưu khám với lịch thuộc bác sĩ hiện tại
    if (String(appt.doctorId) !== String(doctor._id)) {
      res.status(403).json({ message: 'Bạn không có quyền lưu phiên khám cho lịch này.' })
      return
    }

    const now = new Date()
    const payload = _req.body && typeof _req.body === 'object' ? _req.body : {}
    const doc = {
      appointmentId: appointmentOid,
      doctorId: doctor._id,
      patientId: appt.patientId || null,
      // Các trường form khám
      examAt: payload.examAt != null ? String(payload.examAt || '').trim() : '',
      clinicRoom: payload.clinicRoom != null ? String(payload.clinicRoom || '').trim() : '',
      temp: payload.temp != null ? String(payload.temp || '').trim() : '',
      breath: payload.breath != null ? String(payload.breath || '').trim() : '',
      bp: payload.bp != null ? String(payload.bp || '').trim() : '',
      pulse: payload.pulse != null ? String(payload.pulse || '').trim() : '',
      height: payload.height != null ? String(payload.height || '').trim() : '',
      weight: payload.weight != null ? String(payload.weight || '').trim() : '',
      bmi: payload.bmi != null ? String(payload.bmi || '').trim() : '',
      spo2: payload.spo2 != null ? String(payload.spo2 || '').trim() : '',
      symptoms: payload.symptoms != null ? String(payload.symptoms || '').trim() : '',
      notes: payload.notes != null ? String(payload.notes || '').trim() : '',
      treat: payload.treat != null ? String(payload.treat || '').trim() : '',
      reExamination: payload.reExamination != null ? payload.reExamination : null,
      updatedAt: now,
    }

    // Upsert theo appointmentId để bấm "Lưu" nhiều lần chỉ cập nhật
    const r = await db.collection('examination').findOneAndUpdate(
      { appointmentId: appointmentOid },
      { $set: doc, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    )

    // Lưu khám là thao tác lưu nháp (draft). Chỉ đổi trạng thái lịch sang "examined"
    // khi bác sĩ bấm "Kết thúc khám" (endpoint khác).
    res.json({ ok: true, examination: r.value })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

/** Lấy phiên khám theo lịch hẹn (prefill form) */
app.get('/api/examinations', authBearer, async (req, res) => {
  try {
    const ut = String(req.auth?.userType || '').toLowerCase()
    if (ut !== 'doctor') {
      res.status(403).json({ message: 'Chỉ bác sĩ mới xem được phiên khám.' })
      return
    }
    await client.connect()
    const db = client.db(dbName)
    const appointmentIdRaw = String(req.query?.appointmentId || '').trim()
    let appointmentOid
    try {
      appointmentOid = new ObjectId(appointmentIdRaw)
    } catch {
      res.status(400).json({ message: 'appointmentId không hợp lệ.' })
      return
    }

    const doctor = await findUserByIdFlexible(db, String(req.auth.sub || '').trim())
    if (!doctor || userTypeOf(doctor) !== 'doctor') {
      res.status(401).json({ message: 'Token không hợp lệ hoặc không phải bác sĩ.' })
      return
    }

    const appt = await appointmentsCollection(db).findOne({ _id: appointmentOid })
    if (!appt) {
      res.status(404).json({ message: 'Không tìm thấy lịch hẹn.' })
      return
    }
    if (String(appt.doctorId) !== String(doctor._id)) {
      res.status(403).json({ message: 'Bạn không có quyền xem phiên khám của lịch này.' })
      return
    }

    const doc = await db.collection('examination').findOne({ appointmentId: appointmentOid })
    res.json({ ok: true, examination: doc || null })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.get('/api/medicines', async (req, res) => {
  try {
    await client.connect()
    const q = String(req.query.q || '').trim()
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
    const db = client.db(dbName)
    const col = db.collection(collName)

    const filter = { active: { $ne: false } }
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rx = new RegExp(esc, 'i')
      filter.$or = [{ name: rx }, { code: rx }]
    }

    const rows = await col.find(filter).sort({ name: 1 }).limit(limit).toArray()
    res.json({ medicines: rows.map(normalizeDoc).filter(Boolean) })
  } catch (e) {
    console.error(e)
    res.status(503).json({ message: mongoHint(e) })
  }
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, mongoConfigured: Boolean(uri), auth: Boolean(jwtSecret) })
})

async function ensureUsersEmailUniqueIndex() {
  if (!uri) return
  try {
    await client.connect()
    const db = client.db(dbName)
    const col = db.collection(usersColl)

    // Đảm bảo unique email chỉ áp dụng khi email là string không rỗng.
    // Tránh lỗi E11000 khi có nhiều document không có email / email null.
    try {
      await col.dropIndex('email_1')
    } catch {
      /* index có thể chưa tồn tại */
    }

    await col.createIndex(
      { email: 1 },
      {
        name: 'email_1',
        unique: true,
        partialFilterExpression: { email: { $type: 'string', $ne: '' } },
      },
    )
    console.log('[be_clinic] ensured users.email partial unique index (email_1).')
  } catch (e) {
    console.error('[be_clinic] ensure users.email index failed:', e?.code || '', e?.message || e)
  }
}

const server = app.listen(port, () => {
  console.log(`[be_clinic] http://localhost:${port}`)
  console.log(
    `[be_clinic] POST /api/auth/login | staff-login | register + OTP (start-register, verify-email, complete-register) | GET/PATCH /api/auth/me`,
  )
  console.log(`[be_clinic] appointments → Mongo collection "${apptsCollName}"`)
  console.log(`[be_clinic] db=${dbName}  users=${usersColl}  medicine=${collName}`)
  void client
    .connect()
    .then(() => console.log('[be_clinic] MongoDB đã kết nối.'))
    .then(() => ensureUsersEmailUniqueIndex())
    .catch((e) => {
      console.error('[be_clinic] MongoDB (lần đầu):', e?.code || '', e?.message || e)
      console.error('[be_clinic]', mongoHint(e))
    })
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[be_clinic] Cổng ${port} đang bị chiếm. Đổi PORT trong .env hoặc tắt process đang dùng cổng đó.`)
  } else {
    console.error('[be_clinic]', e)
  }
  process.exit(1)
})
