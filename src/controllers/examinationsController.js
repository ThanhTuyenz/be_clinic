import mongoose from 'mongoose'
import Appointment from '../models/Appointment.js'
import Examination from '../models/Examination.js'

function isMongoObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
}

/**
 * Lưu / cập nhật phiên khám (một document trên mỗi appointment).
 * Chỉ bác sĩ được phép, và chỉ với lịch thuộc doctorId của chính họ.
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

    let appt = await Appointment.findById(appointmentIdRaw).lean()
    if (!appt && isMongoObjectId(appointmentIdRaw)) {
      appt = await Appointment.findById(new mongoose.Types.ObjectId(appointmentIdRaw)).lean()
    }

    if (!appt) {
      return res.status(404).json({ message: 'Không tìm thấy lịch hẹn.' })
    }

    if (String(appt.doctorId || '').trim() !== doctorIdStr) {
      return res.status(403).json({ message: 'Bạn không được phép ghi phiên khám cho lịch này.' })
    }

    const patientId = String(appt.patientId || '').trim()
    if (!patientId) {
      return res.status(400).json({ message: 'Lịch hẹn thiếu patientId.' })
    }

    const symptoms = String(body.symptoms ?? '').trim()
    const diagnosis = String(body.diagnosis ?? '').trim()
    const treatment = String(body.treatment ?? '').trim()
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

    const appointmentIdKey = String(appt._id)

    const doc = await Examination.findOneAndUpdate(
      { appointmentId: appointmentIdKey },
      {
        $set: {
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
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean()

    return res.status(200).json({
      message: 'Đã lưu phiên khám.',
      examination: {
        id: doc._id,
        appointmentId: doc.appointmentId,
        patientId: doc.patientId,
        doctorId: doc.doctorId,
        symptoms: doc.symptoms,
        diagnosis: doc.diagnosis,
        treatment: doc.treatment,
        note: doc.note,
        reExamination: doc.reExamination,
        examAt: doc.examAt,
        clinicRoom: doc.clinicRoom,
        temp: doc.temp,
        breath: doc.breath,
        bp: doc.bp,
        pulse: doc.pulse,
        height: doc.height,
        weight: doc.weight,
        bmi: doc.bmi,
        spo2: doc.spo2,
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt,
      },
    })
  } catch (err) {
    console.error(err)
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Phiên khám cho lịch này đang xung đột (trùng appointmentId).' })
    }
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
