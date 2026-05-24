import mongoose from 'mongoose'
import Doctor from '../models/Doctor.js'

const VN_DIACRITIC_GROUPS = {
  a: '[aAàáảãạăằắẳẵặâầấẩẫậ]',
  d: '[dDđ]',
  e: '[eEèéẻẽẹêềếểễệ]',
  i: '[iIìíỉĩị]',
  o: '[oOòóỏõọôồốổỗộơờớởỡợ]',
  u: '[uUùúủũụưừứửữự]',
  y: '[yYỳýỷỹỵ]',
}

let connectPromise = null

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function foldVietnameseBase(ch) {
  const folded = String(ch || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return folded === 'đ' ? 'd' : folded
}

export function buildSpecialtyFlexibleRegex(chuyenKhoa) {
  const raw = String(chuyenKhoa || '').trim()
  if (!raw) return null

  let pattern = ''
  for (const ch of raw) {
    if (/\s/.test(ch)) {
      pattern += '\\s+'
      continue
    }
    const base = foldVietnameseBase(ch)
    if (VN_DIACRITIC_GROUPS[base]) {
      pattern += VN_DIACRITIC_GROUPS[base]
    } else if (/[a-z]/i.test(ch)) {
      pattern += `[${base.toUpperCase()}${base}]`
    } else {
      pattern += escapeRegExp(ch)
    }
  }

  return new RegExp(`^${pattern}$`, 'i')
}

async function ensureMongoose() {
  if (mongoose.connection.readyState === 1) return

  const uri = String(process.env.MONGODB_URI || '').trim()
  if (!uri) {
    const err = new Error('Thiếu MONGODB_URI trong .env.')
    err.code = 'MONGODB_URI_MISSING'
    throw err
  }

  if (!connectPromise) {
    const dbName = String(process.env.MONGO_DB_NAME || 'clinic').trim()
    connectPromise = mongoose.connect(uri, { dbName })
  }

  await connectPromise
}

function mapDoctorForFrontend(doc) {
  return {
    id: String(doc._id),
    name: String(doc.name || '').trim(),
    specialty: String(doc.specialty || '').trim(),
    avatar_url: String(doc.avatar_url || '').trim(),
    rating: Number(doc.rating) || 0,
    is_available: doc.is_available !== false,
  }
}

export async function findTopAvailableDoctorsBySpecialty(chuyenKhoa, limit = 3) {
  const specialty = String(chuyenKhoa || '').trim()
  if (!specialty) return []

  const specialtyRegex = buildSpecialtyFlexibleRegex(specialty)
  if (!specialtyRegex) return []

  await ensureMongoose()

  const rows = await Doctor.find({
    is_available: true,
    specialty: { $regex: specialtyRegex },
  })
    .sort({ rating: -1 })
    .limit(Math.max(1, Number(limit) || 3))
    .select('name specialty avatar_url rating is_available')
    .lean()

  return rows.map(mapDoctorForFrontend)
}
