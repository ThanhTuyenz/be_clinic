import mongoose from 'mongoose'
import Appointment from '../models/Appointment.js'
import Examination from '../models/Examination.js'

function isMongoObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
}

function pickNote(doc) {
  return String(doc?.note ?? doc?.notes ?? '').trim()
}

function pickTreatment(doc) {
  return String(doc?.treatment ?? doc?.treat ?? '').trim()
}

function serializePrescriptionLine(line) {
  if (!line || typeof line !== 'object') return null
  const medicineName = String(line.medicineName ?? line.name ?? '').trim()
  if (!medicineName) return null
  const qty = line.quantity
  return {
    id: line._id ? String(line._id) : undefined,
    medicineId: String(line.medicineId ?? '').trim(),
    medicineCode: String(line.medicineCode ?? line.code ?? '').trim(),
    medicineName,
    unit: String(line.unit ?? '').trim(),
    dosage: String(line.dosage ?? '').trim(),
    frequency: String(line.frequency ?? '').trim(),
    duration: String(line.duration ?? '').trim(),
    quantity: Number.isFinite(Number(qty)) ? Number(qty) : null,
    route: String(line.route ?? '').trim(),
    note: String(line.note ?? '').trim(),
  }
}

export function serializeExamination(doc) {
  if (!doc) return null
  const lines = Array.isArray(doc.prescriptionLines) ? doc.prescriptionLines : []
  const note = pickNote(doc)
  return {
    id: doc._id,
    appointmentId: doc.appointmentId,
    patientId: doc.patientId,
    doctorId: doc.doctorId,
    symptoms: doc.symptoms || '',
    diagnosis: doc.diagnosis || '',
    treatment: pickTreatment(doc),
    note,
    notes: note,
    prescriptionLines: lines.map(serializePrescriptionLine).filter(Boolean),
    reExamination: doc.reExamination ?? null,
    examAt: doc.examAt || '',
    clinicRoom: doc.clinicRoom || '',
    temp: doc.temp || '',
    breath: doc.breath || '',
    bp: doc.bp || '',
    pulse: doc.pulse || '',
    height: doc.height || '',
    weight: doc.weight || '',
    bmi: doc.bmi || '',
    spo2: doc.spo2 || '',
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  }
}

function parsePrescriptionLines(raw) {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []
  return raw
    .map((line) => serializePrescriptionLine(line))
    .filter(Boolean)
    .map(({ id: _id, ...rest }) => rest)
}

async function findAppointmentForDoctor(appointmentIdRaw, doctorIdStr) {
  let appt = await Appointment.findById(appointmentIdRaw).lean()
  if (!appt && isMongoObjectId(appointmentIdRaw)) {
    appt = await Appointment.findById(new mongoose.Types.ObjectId(appointmentIdRaw)).lean()
  }
  if (!appt) return { error: { status: 404, message: 'Không tìm thấy lịch hẹn.' } }
  if (String(appt.doctorId || '').trim() !== doctorIdStr) {
    return { error: { status: 403, message: 'Bạn không được phép xem phiên khám cho lịch này.' } }
  }
  return { appt }
}

/**
 * GET /api/examinations?appointmentId=
 */
export async function getExaminationByAppointment(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'doctor') {
      return res.status(403).json({ message: 'Chỉ bác sĩ mới xem được phiên khám.' })
    }

    const doctorIdStr = String(req.user.id).trim()
    const appointmentIdRaw = String(req.query.appointmentId || '').trim()
    if (!appointmentIdRaw) {
      return res.status(400).json({ message: 'Thiếu appointmentId.' })
    }

    const { appt, error } = await findAppointmentForDoctor(appointmentIdRaw, doctorIdStr)
    if (error) return res.status(error.status).json({ message: error.message })

    const appointmentIdKey = String(appt._id)
    const doc = await Examination.findOne({ appointmentId: appointmentIdKey }).lean()
    if (!doc) {
      return res.status(200).json({ examination: null })
    }

    return res.status(200).json({ examination: serializeExamination(doc) })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/**
 * POST /api/examinations — lưu / cập nhật phiên khám (một document trên mỗi appointment).
 */
export async function upsertExamination(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'doctor') {
      return res.status(403).json({ message: 'Chỉ bác sĩ mới lưu được phiên khám.' })
    }

    const doctorIdStr = String(req.user.id).trim()
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const appointmentIdRaw = String(body.appointmentId || '').trim()

    if (!appointmentIdRaw) {
      return res.status(400).json({ message: 'Thiếu appointmentId.' })
    }

    const { appt, error } = await findAppointmentForDoctor(appointmentIdRaw, doctorIdStr)
    if (error) return res.status(error.status).json({ message: error.message })

    const patientId = String(appt.patientId || '').trim()
    if (!patientId) {
      return res.status(400).json({ message: 'Lịch hẹn thiếu patientId.' })
    }

    const symptoms = String(body.symptoms ?? '').trim()
    const diagnosis = String(body.diagnosis ?? '').trim()
    const treatment = String(body.treatment ?? body.treat ?? '').trim()
    const note = String(body.note ?? body.notes ?? '').trim()
    const examAt = String(body.examAt ?? '').trim()
    const clinicRoom = String(body.clinicRoom ?? '').trim()
    const temp = String(body.temp ?? '').trim()
    const breath = String(body.breath ?? '').trim()
    const bp = String(body.bp ?? '').trim()
    const pulse = String(body.pulse ?? '').trim()
    const height = String(body.height ?? '').trim()
    const weight = String(body.weight ?? '').trim()
    const bmi = String(body.bmi ?? '').trim()
    const spo2 = String(body.spo2 ?? '').trim()

    let reExamination = null
    if (body.reExamination != null && String(body.reExamination).trim() !== '') {
      const d = new Date(body.reExamination)
      if (!Number.isNaN(d.getTime())) reExamination = d
    }

    const prescriptionLines = parsePrescriptionLines(body.prescriptionLines)
    const appointmentIdKey = String(appt._id)

    const $set = {
      appointmentId: appointmentIdKey,
      patientId,
      doctorId: doctorIdStr,
      symptoms,
      diagnosis,
      treatment,
      note,
      reExamination,
      examAt,
      clinicRoom,
      temp,
      breath,
      bp,
      pulse,
      height,
      weight,
      bmi,
      spo2,
    }
    if (prescriptionLines !== undefined) {
      $set.prescriptionLines = prescriptionLines
    }

    const doc = await Examination.findOneAndUpdate(
      { appointmentId: appointmentIdKey },
      { $set },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean()

    return res.status(200).json({
      message: 'Đã lưu phiên khám.',
      examination: serializeExamination(doc),
    })
  } catch (err) {
    console.error(err)
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Phiên khám cho lịch này đang xung đột (trùng appointmentId).' })
    }
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
