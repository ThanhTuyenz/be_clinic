import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import Appointment from '../models/Appointment.js'
import Examination from '../models/Examination.js'
import User from '../models/User.js'
import { serializeExamination } from './examinationsController.js'
import Role from '../models/Role.js'
import Specialty from '../models/Specialty.js'
import Department from '../models/Department.js'
import { sendAppointmentConfirmationEmail } from '../services/mail.js'
import {
  computeAvailabilityFromSchedule,
  findDoctorScheduleDateKeys,
  isValidIsoDateOnly as isValidIsoDateOnlySchedule,
} from '../services/scheduleAvailability.js'
import { DEFAULT_CONSULTATION_FEE } from '../constants/consultationFee.js'
import { getClinicRoomMetaMap, clinicRoomDisplayLabel } from '../services/clinicRoomHelper.js'

function resolveConsultationFee(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_CONSULTATION_FEE
}

function isMongoObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
}

function isValidIsoDateOnly(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isValidHHmm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

function displayNameFromUser(user) {
  const first = String(user?.firstName || '').trim()
  const last = String(user?.lastName || '').trim()
  const full = `${last} ${first}`.trim()
  return full || String(user?.displayName || user?.fullName || user?.name || '').trim() || String(user?.email || '').trim()
}

function queueAppointmentConfirmationEmail({ patient, doctor, appointment, ticket }) {
  const to = String(patient?.email || '').trim().toLowerCase()
  if (!to || !to.includes('@')) return
  void sendAppointmentConfirmationEmail({
    to,
    recipientName: displayNameFromUser(patient),
    ticket,
    appointmentDate: appointment?.appointmentDate,
    startTime: appointment?.startTime,
    doctorName: displayNameFromUser(doctor),
    specialtyName: String(doctor?.specialtyName || doctor?.specialty || '').trim(),
  }).catch((err) => {
    console.warn('[be_clinic] Gửi email xác nhận lịch khám thất bại:', err?.message || err)
  })
}

function staffSummary(user) {
  if (!user) return null
  return {
    id: String(user._id || user.id || '').trim(),
    displayName: displayNameFromUser(user),
    email: String(user.email || '').trim(),
    userType: String(user.userType || user.role || '').trim(),
  }
}

function serializePayment(appt) {
  const p = appt?.payment
  if (!p || typeof p !== 'object') {
    return { status: 'unpaid' }
  }
  const status = String(p.status || 'unpaid').trim().toLowerCase()
  if (status !== 'paid') {
    return { status: 'unpaid' }
  }
  return {
    status: 'paid',
    amount: Number.isFinite(Number(p.amount)) ? Math.round(Number(p.amount)) : null,
    method: String(p.method || '').trim().toLowerCase() || '',
    paidAt: p.paidAt || null,
    paidBy: p.paidBy || null,
    note: String(p.note || '').trim(),
    invoiceNo: String(p.invoiceNo || '').trim(),
  }
}

function isAppointmentPaid(appt) {
  return String(appt?.payment?.status || '').trim().toLowerCase() === 'paid'
}

async function nextPaymentInvoiceNo(appointmentDate) {
  const d = appointmentDate instanceof Date ? appointmentDate : new Date(appointmentDate)
  if (Number.isNaN(d.getTime())) {
    return `HD${Date.now()}`
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const prefix = `HD${String(y).slice(-2)}${m}${day}`
  const dayStart = new Date(`${y}-${m}-${day}T00:00:00`)
  const dayEnd = new Date(`${y}-${m}-${day}T23:59:59.999`)
  const count = await Appointment.countDocuments({
    'payment.status': 'paid',
    'payment.paidAt': { $gte: dayStart, $lte: dayEnd },
    'payment.invoiceNo': { $regex: `^${prefix}-` },
  })
  return `${prefix}-${String(count + 1).padStart(4, '0')}`
}

async function findUserByIdFlexible(userId, projection) {
  const id = String(userId || '').trim()
  if (!id) return null
  let user = await User.collection.findOne({ _id: id }, { projection })
  if (!user && isMongoObjectId(id)) {
    user = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(id) }, { projection })
  }
  return user
}

/** Khung giờ 12 phút từ 08:00 đến 20:00 (khớp cách đặt lịch phía bệnh nhân). */
function generateDaySlotTimes() {
  const out = []
  let minutes = 8 * 60
  const end = 20 * 60
  while (minutes <= end) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    minutes += 12
  }
  return out
}

/** Khớp fe_clinic / fe_clinic_ad `DEFAULT_SLOT_MINUTES` (12). */
const SLOT_END_MINUTES = 12

function dateKeyFromAppointmentDoc(appointmentDate) {
  if (!appointmentDate) return ''
  const d = appointmentDate instanceof Date ? appointmentDate : new Date(appointmentDate)
  if (Number.isNaN(d.getTime())) return ''
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function getSlotEndDateFromAppt(appt) {
  const dk = dateKeyFromAppointmentDoc(appt?.appointmentDate)
  if (!dk) return null
  const en = String(appt?.endTime || '').trim()
  if (en.length >= 5) {
    const t = en.slice(0, 5)
    const end = new Date(`${dk}T${t}:00`)
    return Number.isNaN(end.getTime()) ? null : end
  }
  const st = String(appt?.startTime || '00:00').slice(0, 5)
  const start = new Date(`${dk}T${st}:00`)
  if (Number.isNaN(start.getTime())) return null
  start.setMinutes(start.getMinutes() + SLOT_END_MINUTES)
  return start
}

/** Lịch đã qua tiếp nhận, tính vào max STT theo phòng trong ngày. */
const VISIT_QUEUE_COUNT_STATUSES = ['confirmed', 'examined', 'completed', 'done']

/** Client có gửi số thứ tự cụ thể (không dùng tự động). */
function hasExplicitVisitQueueNumberInBody(body) {
  if (!body || typeof body !== 'object') return false
  if (!Object.prototype.hasOwnProperty.call(body, 'visitQueueNumber')) return false
  const raw = body.visitQueueNumber
  if (raw === null || raw === undefined || raw === '') return false
  const n = Number.parseInt(String(raw), 10)
  return Number.isFinite(n) && n >= 1
}

/**
 * Có tự gán STT hay không: lần đầu xác nhận luôn gán nếu không có số cụ thể;
 * đã confirmed chỉ gán lại khi client gửi visitQueueNumber rỗng (xin cấp lại).
 */
function shouldAutoAssignVisitQueueNumber(body, prevStatus) {
  if (hasExplicitVisitQueueNumberInBody(body)) return false
  const prev = String(prevStatus || '').toLowerCase()
  if (prev !== 'confirmed') return true
  if (!body || typeof body !== 'object') return false
  if (!Object.prototype.hasOwnProperty.call(body, 'visitQueueNumber')) return false
  const raw = body.visitQueueNumber
  return raw === null || raw === undefined || raw === ''
}

/**
 * STT kế tiếp trong ngày khám + phòng: 1 nếu chưa ai, max+1 nếu đã có.
 * Phòng so khớp sau trim; phòng trống gộp chung một dãy số trong ngày.
 */
async function getNextVisitQueueNumberForRoom({ appointmentDate, clinicRoom, excludeAppointmentId }) {
  const dk = dateKeyFromAppointmentDoc(appointmentDate)
  if (!dk) return 1
  const dayStart = new Date(`${dk}T00:00:00`)
  const dayEnd = new Date(`${dk}T23:59:59.999`)
  const room = String(clinicRoom ?? '').trim()

  const query = {
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    status: { $in: VISIT_QUEUE_COUNT_STATUSES },
    visitQueueNumber: { $gte: 1 },
  }
  if (room === '') {
    query.$or = [{ clinicRoom: '' }, { clinicRoom: { $exists: false } }, { clinicRoom: null }]
  } else {
    query.clinicRoom = room
  }
  const ex = String(excludeAppointmentId || '').trim()
  if (ex && isMongoObjectId(ex)) {
    query._id = { $ne: new mongoose.Types.ObjectId(ex) }
  }

  const top = await Appointment.findOne(query)
    .sort({ visitQueueNumber: -1 })
    .select({ visitQueueNumber: 1 })
    .lean()

  const max = top && top.visitQueueNumber != null ? Number(top.visitQueueNumber) : 0
  return max + 1
}

/** Lịch pending đã qua hết khung giờ khám (dùng cho tự động hủy an toàn phía server). */
function isPendingAppointmentPastSlotServer(appt) {
  if (String(appt?.status || '').toLowerCase() !== 'pending') return false
  const end = getSlotEndDateFromAppt(appt)
  if (!end) return false
  return end.getTime() < Date.now()
}

export async function listMyAppointments(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân mới xem được lịch đã đặt.' })
    }

    const items = await Appointment.find({
      patientId: req.user.id,
    })
      .sort({ appointmentDate: -1, startTime: 1, createdAt: -1 })
      .lean()

    // Back-end data normalization:
    // - User collection stores specialtyId/specialtyID (and not always deptName/specialtyName).
    // - We derive specialtyName + deptName using Specialty + Department collections (same idea as listDoctors()).
    const doctorIdsRaw = (items || [])
      .map((a) => String(a?.doctorId || '').trim())
      .filter(Boolean)

    const doctorObjectIds = doctorIdsRaw
      .filter(isMongoObjectId)
      .map((id) => new mongoose.Types.ObjectId(id))

    // IMPORTANT: Appointment.doctorId is stored as string.
    // In Mongo, users._id is usually ObjectId; but some dev data can be string _id.
    // Use native collection query to support both types in one go.
    const doctors =
      doctorIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'doctor',
                $or: [
                  { _id: { $in: doctorIdsRaw } },
                  doctorObjectIds.length ? { _id: { $in: doctorObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  avatarUrl: 1,
                  bio: 1,
                  deptID: 1,
                  deptName: 1,
                  specialty: 1,
                  specialtyName: 1,
                  specialtyID: 1,
                  specialtyId: 1,
                },
              },
            )
            .toArray()
        : []

    const doctorById = new Map(doctors.map((d) => [String(d._id), d]))
    const doctorDocs = doctors

    const specialtyIds = Array.from(
      new Set(
        doctorDocs
          .map((d) => d?.specialtyID ?? d?.specialtyId)
          .filter(Boolean)
          .map((id) => String(id).trim()),
      ),
    )

    const specialties = specialtyIds.length
      ? await Specialty.find(
          { specialtyID: { $in: specialtyIds } },
          { specialtyID: 1, specialtyName: 1, deptID: 1 },
        ).lean()
      : []

    const specialtyNameById = new Map(
      specialties.map((s) => [String(s.specialtyID), String(s.specialtyName || '').trim()]),
    )
    const deptIdBySpecialtyId = new Map(
      specialties.map((s) => [String(s.specialtyID), String(s.deptID || '').trim()]),
    )

    const deptIds = Array.from(new Set(specialties.map((s) => String(s?.deptID || '').trim()).filter(Boolean)))
    const departments = deptIds.length
      ? await Department.find({ deptID: { $in: deptIds } }, { deptID: 1, deptName: 1 }).lean()
      : []

    const deptNameById = new Map(
      departments.map((d) => [String(d.deptID), String(d.deptName || '').trim()]),
    )

    let didLog = false
    let didLogMissing = false

    return res.status(200).json({
      appointments: (items || []).map((a) => {
        const doctorIdStr = String(a?.doctorId || '').trim()
        const doc = doctorIdStr ? doctorById.get(doctorIdStr) || null : null
        if (!doc) {
          if (!didLogMissing) {
            didLogMissing = true
            console.log('[debug listMyAppointments missing-doctor]', {
              doctorId: doctorIdStr,
              isMongoObjectId: isMongoObjectId(doctorIdStr),
              doctorsMatched: doctors.length,
              sampleMatchedIds: doctors.slice(0, 5).map((d) => String(d?._id || '')),
              db: mongoose.connection.name,
            })
          }
          return {
            id: a._id,
            ticket: buildTicketCode(a._id, a.appointmentDate),
            appointmentDate: a.appointmentDate,
            startTime: a.startTime,
            endTime: a.endTime || '',
            status: a.status || 'pending',
            source: a.source || '',
            bookingSource: a.source || '',
            createdByStaff: a.createdByStaff || null,
            note: a.note || '',
            cancelReason: a.cancelReason || '',
            cancelledAt: a.cancelledAt || null,
            cancelledBy: a.cancelledBy || null,
            confirmedAt: a.confirmedAt || null,
            confirmedBy: a.confirmedBy || null,
            createdAt: a.createdAt,
            doctor: null,
            doctorId: doctorIdStr || '',
          }
        }

        const specialtyId = doc.specialtyID ?? doc.specialtyId
        const specialtyID = specialtyId ? String(specialtyId).trim() : ''
        const rawSpecialtyName = String(
          doc.specialtyName || doc.specialty || doc.specialization || '',
        ).trim()
        const rawDeptName = String(doc.deptName || doc.dept || doc.departmentName || '').trim()

        const specialtyName =
          specialtyID ? specialtyNameById.get(specialtyID) || rawSpecialtyName : rawSpecialtyName

        const derivedDeptID = specialtyID ? deptIdBySpecialtyId.get(specialtyID) || '' : ''
        const rawDeptID = String(doc.deptID || '').trim()
        const deptID = derivedDeptID || rawDeptID

        const deptName = deptID ? deptNameById.get(deptID) || rawDeptName : rawDeptName

        if (!didLog) {
          didLog = true
          console.log('[debug listMyAppointments]', {
            doctorPopulated: true,
            doctorId: String(doc._id || ''),
            firstName: doc.firstName,
            lastName: doc.lastName,
            email: doc.email,
            specialtyID_inDoctor: specialtyID,
            rawSpecialtyName_inDoctor: rawSpecialtyName,
            derived_specialtyName: specialtyName,
            derived_deptID: deptID,
            rawDeptName_inDoctor: rawDeptName,
            derived_deptName: deptName,
          })
        }

        return {
          id: a._id,
          ticket: buildTicketCode(a._id, a.appointmentDate),
          appointmentDate: a.appointmentDate,
          startTime: a.startTime,
          endTime: a.endTime || '',
          status: a.status || 'pending',
          source: a.source || '',
          bookingSource: a.source || '',
          createdByStaff: a.createdByStaff || null,
          note: a.note || '',
          cancelReason: a.cancelReason || '',
          cancelledAt: a.cancelledAt || null,
          cancelledBy: a.cancelledBy || null,
          confirmedAt: a.confirmedAt || null,
          confirmedBy: a.confirmedBy || null,
          createdAt: a.createdAt,
          doctorId: doctorIdStr || String(doc._id || ''),
          doctor: {
            id: doc._id,
            firstName: doc.firstName,
            lastName: doc.lastName,
            // Normalize to what FE expects (and what doctorsController does too)
            displayName: [doc.lastName, doc.firstName].filter(Boolean).join(' ').trim(),
            email: doc.email,
            avatarUrl: doc.avatarUrl,
            deptID,
            deptName,
            // Keep both keys so FE can read either.
            specialty: specialtyName,
            specialtyName,
            bio: doc.bio,
          },
        }
      }),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function listDoctorAppointments(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'doctor') {
      return res.status(403).json({ message: 'Chỉ bác sĩ mới xem được lịch theo vai trò này.' })
    }

    const doctorIdStr = String(req.user.id).trim()

    const items = await Appointment.find({ doctorId: doctorIdStr })
      .sort({ appointmentDate: -1, startTime: 1, createdAt: -1 })
      .lean()

    const patientIdsRaw = (items || [])
      .map((a) => String(a?.patientId || '').trim())
      .filter(Boolean)

    const patientObjectIds = patientIdsRaw
      .filter(isMongoObjectId)
      .map((id) => new mongoose.Types.ObjectId(id))

    const patients =
      patientIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'patient',
                $or: [
                  { _id: { $in: patientIdsRaw } },
                  patientObjectIds.length ? { _id: { $in: patientObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  phone: 1,
                  avatarUrl: 1,
                  dob: 1,
                  gender: 1,
                  address: 1,
                },
              },
            )
            .toArray()
        : []

    const patientById = new Map(patients.map((p) => [String(p._id), p]))

    return res.status(200).json({
      appointments: (items || []).map((a) => {
        const pid = String(a?.patientId || '').trim()
        const doc = pid ? patientById.get(pid) || null : null

        return {
          id: a._id,
          ticket: buildTicketCode(a._id, a.appointmentDate),
          appointmentDate: a.appointmentDate,
          startTime: a.startTime,
          endTime: a.endTime || '',
          status: a.status || 'pending',
          source: a.source || '',
          bookingSource: a.source || '',
          createdByStaff: a.createdByStaff || null,
          note: a.note || '',
          cancelReason: a.cancelReason || '',
          cancelledAt: a.cancelledAt || null,
          cancelledBy: a.cancelledBy || null,
          confirmedAt: a.confirmedAt || null,
          confirmedBy: a.confirmedBy || null,
          createdAt: a.createdAt,
          visitQueueNumber: a.visitQueueNumber ?? null,
          clinicRoom: a.clinicRoom || '',
          payment: serializePayment(a),
          doctorId: doctorIdStr,
          patient: doc
            ? {
                id: doc._id,
                firstName: doc.firstName,
                lastName: doc.lastName,
                displayName: [doc.lastName, doc.firstName].filter(Boolean).join(' ').trim(),
                email: doc.email,
                phone: doc.phone,
                avatarUrl: doc.avatarUrl,
                dob: doc.dob ?? null,
                gender: genderLabel(doc.gender),
                address: doc.address || '',
                patientCode: buildPatientCode(doc._id),
              }
            : null,
        }
      }),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function createAppointment(req, res) {
  try {
    const { doctorId, appointmentDate, startTime, note } = req.body

    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân có thể đặt lịch.' })
    }

    if (!doctorId || !appointmentDate || !startTime) {
      return res.status(400).json({
        message: 'Thiếu doctorId, appointmentDate hoặc startTime.',
      })
    }

    const doctorIdStr = String(doctorId).trim()
    const startTimeStr = String(startTime).trim()
    const appointmentDateStr = String(appointmentDate).trim()

    if (!isValidIsoDateOnly(appointmentDateStr)) {
      return res.status(400).json({ message: 'appointmentDate phải có dạng YYYY-MM-DD.' })
    }
    if (!isValidHHmm(startTimeStr)) {
      return res.status(400).json({ message: 'startTime phải có dạng HH:mm.' })
    }

    // Support both ObjectId _id and string _id (some dev data can differ).
    let doctor = await User.collection.findOne({ _id: doctorIdStr })
    if (!doctor && isMongoObjectId(doctorIdStr)) {
      doctor = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(doctorIdStr) })
    }
    if (!doctor) {
      return res.status(400).json({
        message:
          `Không có user với id="${doctorIdStr}" trong MongoDB mà backend đang kết nối (db="${mongoose.connection.name}"). ` +
          'Nếu bạn nhìn thấy user này trên Atlas, khả năng cao backend đang trỏ sai cluster/database hoặc _id đang khác kiểu dữ liệu.',
      })
    }
    if (String(doctor.userType) !== 'doctor') {
      return res.status(400).json({
        message: `doctorId trỏ tới tài khoản loại "${doctor.userType}", không phải bác sĩ. Cần gửi _id của document trong users có userType: "doctor".`,
      })
    }
    if (doctor.isActive === false) {
      return res.status(400).json({ message: 'Bác sĩ này đã bị vô hiệu hóa (isActive: false).' })
    }

    const date = new Date(`${appointmentDateStr}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'appointmentDate không hợp lệ.' })
    }

    const ACTIVE_STATUSES = ['pending', 'confirmed']

    // Rule 1: Patient cannot book the same time slot as another appointment (any doctor).
    // We treat appointments as time-slots keyed by (appointmentDate, startTime).
    const patientTimeConflict = await Appointment.findOne({
      patientId: req.user.id,
      appointmentDate: date,
      startTime: startTimeStr,
      status: { $in: ACTIVE_STATUSES },
    })
      .select({ _id: 1 })
      .lean()

    if (patientTimeConflict) {
      return res.status(409).json({
        message: 'Bạn đã có lịch khám khác trùng khung giờ này. Vui lòng chọn giờ khác.',
      })
    }

    // Rule 2: A patient can only have 1 active appointment per doctor until it is completed/cancelled.
    const patientDoctorConflict = await Appointment.findOne({
      patientId: req.user.id,
      doctorId: doctorIdStr,
      status: { $in: ACTIVE_STATUSES },
    })
      .select({ _id: 1, appointmentDate: 1, startTime: 1, status: 1 })
      .lean()

    if (patientDoctorConflict) {
      return res.status(409).json({
        message:
          'Bạn đã có một lịch khám đang chờ/xác nhận với bác sĩ này. ' +
          'Chỉ đặt lại sau khi lịch đó hoàn thành hoặc đã hủy.',
      })
    }

    let appointment
    try {
      appointment = await Appointment.create({
        patientId: req.user.id,
        doctorId: doctorIdStr,
        appointmentDate: date,
        startTime: startTimeStr,
        note: note ? String(note).trim() : '',
        status: 'pending',
        source: 'online',
      })
    } catch (e) {
      // Duplicate key from unique slot index -> slot already booked.
      if (e && (e.code === 11000 || e?.name === 'MongoServerError')) {
        return res.status(409).json({ message: 'Khung giờ này đã có người đặt. Vui lòng chọn giờ khác.' })
      }
      throw e
    }

    const ticket = buildTicketCode(appointment._id, appointment.appointmentDate)
    const patient = await User.findById(req.user.id).lean()
    queueAppointmentConfirmationEmail({
      patient,
      doctor,
      appointment,
      ticket,
    })

    return res.status(201).json({
      message: 'Đặt lịch thành công.',
      appointment: {
        id: appointment._id,
        ticket,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        status: appointment.status,
        source: appointment.source,
        bookingSource: appointment.source,
        createdByStaff: appointment.createdByStaff || null,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function cancelAppointment(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân mới hủy được lịch khám.' })
    }

    const rawId = String(req.params.id || '').trim()
    if (!isMongoObjectId(rawId)) {
      return res.status(400).json({ message: 'Mã lịch không hợp lệ.' })
    }

    const appt = await Appointment.findById(rawId)
    if (!appt) {
      return res.status(404).json({ message: 'Không tìm thấy lịch khám.' })
    }

    if (String(appt.patientId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Bạn không có quyền hủy lịch này.' })
    }

    if (appt.status === 'cancelled') {
      return res.status(400).json({ message: 'Lịch này đã được hủy trước đó.' })
    }

    const reasonRaw =
      req.body && typeof req.body === 'object'
        ? String(req.body.cancelReason ?? req.body.reason ?? '').trim()
        : ''
    if (!reasonRaw) {
      return res.status(400).json({ message: 'Vui lòng chọn hoặc nhập lý do hủy lịch.' })
    }
    if (reasonRaw.length > 500) {
      return res.status(400).json({ message: 'Lý do hủy quá dài (tối đa 500 ký tự).' })
    }

    const patientDoc = await findUserByIdFlexible(req.user.id, {
      firstName: 1,
      lastName: 1,
      email: 1,
      userType: 1,
    })
    const who = staffSummary(patientDoc) || {
      id: String(req.user.id || ''),
      displayName: 'Bệnh nhân',
      email: '',
      userType: 'patient',
    }

    appt.status = 'cancelled'
    appt.cancelReason = reasonRaw
    appt.cancelledAt = new Date()
    appt.cancelledBy = { role: 'patient', ...who }
    await appt.save()

    return res.status(200).json({
      message: 'Đã hủy lịch khám.',
      appointment: {
        id: appt._id,
        status: appt.status,
        cancelReason: appt.cancelReason,
        cancelledAt: appt.cancelledAt,
        cancelledBy: appt.cancelledBy,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function getAvailability(req, res) {
  try {
    const userType = String(req.user?.userType || '').toLowerCase()
    const doctorId = String(req.query.doctorId || '').trim()
    const dateStr = String(req.query.date || '').trim()

    if (!req.user?.id) {
      return res.status(401).json({ message: 'Thiếu thông tin đăng nhập.' })
    }

    if (userType === 'doctor') {
      const selfId = String(req.user.id).trim()
      if (doctorId !== selfId) {
        return res.status(403).json({ message: 'Bác sĩ chỉ xem được lịch trống của chính mình.' })
      }
    } else if (userType === 'patient') {
      /* ok — xem theo bác sĩ được chọn */
    } else if (userType === 'receptionist' || userType === 'registration') {
      /* Lễ tân / đăng ký xem khung giờ để hỗ trợ đặt lịch */
    } else {
      return res.status(403).json({ message: 'Không có quyền xem khung giờ.' })
    }

    if (!doctorId || !dateStr) {
      return res.status(400).json({ message: 'Thiếu doctorId hoặc date.' })
    }
    if (!isValidIsoDateOnly(dateStr)) {
      return res.status(400).json({ message: 'date phải có dạng YYYY-MM-DD.' })
    }

    const date = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'date không hợp lệ.' })
    }

    const rows = await Appointment.find(
      {
        doctorId,
        appointmentDate: date,
        status: { $in: ['pending', 'confirmed'] },
      },
      { startTime: 1, _id: 0 },
    ).lean()

    const bookedStartTimes = Array.from(
      new Set((rows || []).map((r) => String(r.startTime || '').trim()).filter(Boolean)),
    ).sort()

    const bookedSet = new Set(bookedStartTimes)
    const db = mongoose.connection.db

    const { slots, shifts, hasSchedule } = await computeAvailabilityFromSchedule({
      db,
      doctorId,
      dateStr,
      bookedSet,
    })

    let freeSlots = slots
    if (!hasSchedule) {
      const allSlots = generateDaySlotTimes()
      const todayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const isToday = dateStr === todayKey
      const now = new Date()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()
      freeSlots = allSlots.filter((t) => {
        if (bookedSet.has(t)) return false
        if (!isToday) return true
        const [h, m] = t.split(':').map(Number)
        return h * 60 + m > nowMinutes
      })
    }

    return res.status(200).json({
      doctorId,
      date: dateStr,
      bookedStartTimes,
      busySlots: bookedStartTimes,
      freeSlots,
      slots: freeSlots,
      availableSlots: freeSlots,
      shifts,
      hasSchedule,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/** Ngày có lịch làm việc của bác sĩ (từ doctorSchedule). */
export async function getDoctorScheduleDates(req, res) {
  try {
    const userType = String(req.user?.userType || '').toLowerCase()
    const doctorId = String(req.query.doctorId || '').trim()
    const fromStr = String(req.query.from || '').trim()
    const toStr = String(req.query.to || '').trim()

    if (!req.user?.id) {
      return res.status(401).json({ message: 'Thiếu thông tin đăng nhập.' })
    }
    if (userType === 'patient' || userType === 'receptionist' || userType === 'registration') {
      /* ok */
    } else if (userType === 'doctor') {
      if (doctorId !== String(req.user.id).trim()) {
        return res.status(403).json({ message: 'Bác sĩ chỉ xem được lịch của chính mình.' })
      }
    } else {
      return res.status(403).json({ message: 'Không có quyền xem lịch bác sĩ.' })
    }

    if (!doctorId) {
      return res.status(400).json({ message: 'Thiếu doctorId.' })
    }

    const today = new Date()
    const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const end = new Date(today)
    end.setDate(end.getDate() + 27)
    const defaultTo = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`

    const from = fromStr && isValidIsoDateOnlySchedule(fromStr) ? fromStr : defaultFrom
    const to = toStr && isValidIsoDateOnlySchedule(toStr) ? toStr : defaultTo

    const dates = await findDoctorScheduleDateKeys(mongoose.connection.db, doctorId, from, to)

    return res.status(200).json({ doctorId, from, to, dates })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/** Khớp cách tạo mã vé ở fe_clinic (QR lịch khám). */
function buildTicketCode(appointmentId, appointmentDate) {
  const id = String(appointmentId).replace(/[^a-fA-F0-9]/g, '')
  const d = appointmentDate instanceof Date ? appointmentDate : new Date(appointmentDate)
  if (Number.isNaN(d.getTime())) {
    return `YMA${(id.slice(-10) || '0000000000').toUpperCase()}`
  }
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const suffix = (id.slice(-6) || '000000').toUpperCase()
  return `YMA${yy}${mm}${dd}${suffix}`
}

function parseTicketCode(ticketRaw) {
  const s = String(ticketRaw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  const m = /^YMA(\d{2})(\d{2})(\d{2})([A-F0-9]{6})$/.exec(s)
  if (!m) return null
  const yy = Number(m[1])
  const mm = Number(m[2])
  const dd = Number(m[3])
  const suffix = m[4]
  const year = 2000 + yy
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const dateOnly = new Date(year, mm - 1, dd)
  if (
    dateOnly.getFullYear() !== year ||
    dateOnly.getMonth() !== mm - 1 ||
    dateOnly.getDate() !== dd
  ) {
    return null
  }
  return { year, month: mm, day: dd, suffix }
}

async function findPatientUserByContact(rawLogin) {
  const raw = String(rawLogin || '').trim()
  if (!raw) return null
  if (raw.includes('@')) {
    return User.findOne({ userType: 'patient', email: raw.toLowerCase() }).lean()
  }
  return User.findOne({ userType: 'patient', phone: raw }).lean()
}

function splitPatientName(displayName) {
  const parts = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[parts.length - 1],
    lastName: parts.slice(0, -1).join(' '),
  }
}

function parseGenderToBooleanOrNull(value) {
  if (value === true) return true
  if (value === false) return false
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'nam' || s === 'male' || s === 'm' || s === 'true') return true
  if (s === 'nữ' || s === 'nu' || s === 'female' || s === 'f' || s === 'false') return false
  return null
}

async function createPatientForReception({ patientInfo, patientEmailOrPhone }) {
  const info = patientInfo && typeof patientInfo === 'object' ? patientInfo : {}
  const rawContact = String(patientEmailOrPhone || '').trim()
  const phone = String(info.phone || (!rawContact.includes('@') ? rawContact : '')).trim()
  const emailFromInput = String(info.email || (rawContact.includes('@') ? rawContact : '')).trim().toLowerCase()
  const email = emailFromInput
  const displayName = String(info.displayName || '').trim()
  const { firstName, lastName } = splitPatientName(displayName)

  if (!displayName || !phone) {
    return {
      errorStatus: 400,
      errorMessage: 'Bệnh nhân mới cần có họ tên và số điện thoại để tạo tài khoản.',
    }
  }
  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    return {
      errorStatus: 400,
      errorMessage: 'Bệnh nhân mới cần có Gmail hợp lệ để tạo tài khoản.',
    }
  }

  const existing = await User.findOne({
    $or: [{ email }, { phone }],
  }).lean()
  if (existing) {
    return {
      errorStatus: 409,
      errorMessage: 'Email hoặc số điện thoại đã thuộc tài khoản khác.',
    }
  }

  const role = await Role.findOne({ name: 'patient' }).lean()
  if (!role) {
    return {
      errorStatus: 500,
      errorMessage: 'Hệ thống chưa có vai trò bệnh nhân.',
    }
  }

  const dobRaw = info.dob ? new Date(info.dob) : null
  const passwordHash = await bcrypt.hash('111111', 10)
  const created = await User.create({
    email,
    passwordHash,
    mustSetPassword: false,
    roleId: role._id,
    userType: 'patient',
    isActive: true,
    emailVerified: true,
    firstName,
    lastName,
    phone,
    dob: dobRaw && !Number.isNaN(dobRaw.getTime()) ? dobRaw : undefined,
    gender: parseGenderToBooleanOrNull(info.gender),
    address: String(info.address || '').trim(),
  })

  return { patient: created.toObject(), created: true }
}

export async function lookupAppointmentByTicket(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận mới tra cứu được mã vé.' })
    }

    const ticketRaw = String(req.query.ticket || '').trim()
    const parsed = parseTicketCode(ticketRaw)
    if (!parsed) {
      return res.status(400).json({
        message: 'Mã không đúng định dạng (ví dụ YMA260411A1B2C3).',
      })
    }

    const ymd = `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
    const dayStart = new Date(`${ymd}T00:00:00`)
    const dayEnd = new Date(`${ymd}T23:59:59.999`)

    const candidates = await Appointment.find({
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      // Tiếp nhận cần tra cứu được cả lịch đã hủy (để biết trạng thái thật khi bệnh nhân đưa QR).
      status: { $in: ['pending', 'confirmed', 'cancelled'] },
    }).lean()

    const want = ticketRaw.toUpperCase().replace(/\s+/g, '')
    const matches = (candidates || []).filter(
      (a) => buildTicketCode(a._id, a.appointmentDate).toUpperCase() === want,
    )

    if (!matches.length) {
      return res.status(404).json({ message: 'Không tìm thấy lịch khám với mã này.' })
    }
    if (matches.length > 1) {
      return res.status(409).json({ message: 'Có nhiều hơn một lịch khớp mã. Vui lòng kiểm tra lại dữ liệu.' })
    }

    const a = matches[0]
    const pid = String(a.patientId || '').trim()
    const did = String(a.doctorId || '').trim()

    const patientIdsRaw = pid ? [pid] : []
    const patientObjectIds = isMongoObjectId(pid) ? [new mongoose.Types.ObjectId(pid)] : []
    const patients =
      patientIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'patient',
                $or: [
                  { _id: { $in: patientIdsRaw } },
                  patientObjectIds.length ? { _id: { $in: patientObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  phone: 1,
                  avatarUrl: 1,
                  dob: 1,
                  gender: 1,
                  address: 1,
                },
              },
            )
            .toArray()
        : []
    const patientDoc = patients[0] || null

    const doctorIdsRaw = did ? [did] : []
    const doctorObjectIds = isMongoObjectId(did) ? [new mongoose.Types.ObjectId(did)] : []
    const doctors =
      doctorIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'doctor',
                $or: [
                  { _id: { $in: doctorIdsRaw } },
                  doctorObjectIds.length ? { _id: { $in: doctorObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  avatarUrl: 1,
                  bio: 1,
                  specialtyID: 1,
                  specialtyId: 1,
                  specialtyName: 1,
                  specialty: 1,
                  deptName: 1,
                  deptID: 1,
                  clinicRoomID: 1,
                  consultationFee: 1,
                },
              },
            )
            .toArray()
        : []
    const doc = doctors[0] || null

    let specialtyName = ''
    const specialtyId = doc ? doc.specialtyID ?? doc.specialtyId : ''
    if (specialtyId) {
      const sp = await Specialty.findOne({ specialtyID: String(specialtyId).trim() }, { specialtyName: 1 }).lean()
      specialtyName = String(sp?.specialtyName || doc?.specialtyName || doc?.specialty || '').trim()
    } else {
      specialtyName = String(doc?.specialtyName || doc?.specialty || '').trim()
    }

    const doctorRoomId = doc ? String(doc.clinicRoomID || '').trim() : ''
    const doctorRoomMetaMap = doctorRoomId ? await getClinicRoomMetaMap([doctorRoomId]) : new Map()
    const doctorRoomMeta = doctorRoomId ? doctorRoomMetaMap.get(doctorRoomId) : null

    const ticket = buildTicketCode(a._id, a.appointmentDate)

    return res.status(200).json({
      ticket,
      appointment: {
        id: a._id,
        appointmentDate: a.appointmentDate,
        startTime: a.startTime,
        endTime: a.endTime || '',
        status: a.status || 'pending',
        source: a.source || '',
        bookingSource: a.source || '',
        createdByStaff: a.createdByStaff || null,
        note: a.note || '',
        cancelReason: a.cancelReason || '',
        cancelledAt: a.cancelledAt || null,
        cancelledBy: a.cancelledBy || null,
        confirmedAt: a.confirmedAt || null,
        confirmedBy: a.confirmedBy || null,
        createdAt: a.createdAt,
        visitQueueNumber: a.visitQueueNumber ?? null,
        clinicRoom: a.clinicRoom || '',
        payment: serializePayment(a),
      },
      patient: patientDoc
        ? {
            id: patientDoc._id,
            firstName: patientDoc.firstName,
            lastName: patientDoc.lastName,
            displayName: [patientDoc.lastName, patientDoc.firstName].filter(Boolean).join(' ').trim(),
            email: patientDoc.email,
            phone: patientDoc.phone,
            avatarUrl: patientDoc.avatarUrl,
            dob: patientDoc.dob ?? null,
            gender: genderLabel(patientDoc.gender),
            address: patientDoc.address || '',
            age: ageFromDob(patientDoc.dob),
            patientCode: buildPatientCode(patientDoc._id),
          }
        : null,
      doctor: doc
        ? {
            id: doc._id,
            firstName: doc.firstName,
            lastName: doc.lastName,
            displayName: [doc.lastName, doc.firstName].filter(Boolean).join(' ').trim(),
            email: doc.email,
            avatarUrl: doc.avatarUrl,
            specialtyName,
            bio: doc.bio,
            clinicRoomID: doctorRoomId,
            clinicRoomName: doctorRoomMeta ? clinicRoomDisplayLabel(doctorRoomId, doctorRoomMeta) : doctorRoomId,
            consultationFee: resolveConsultationFee(doc.consultationFee),
          }
        : null,
      consultationFee: doc ? resolveConsultationFee(doc.consultationFee) : DEFAULT_CONSULTATION_FEE,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function createAppointmentReception(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist' && String(req.user?.userType || '') !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới đặt lịch thay bệnh nhân.' })
    }

    const { patientEmailOrPhone, patient: patientInfo, doctorId, appointmentDate, startTime, note } = req.body

    let patient = await findPatientUserByContact(patientEmailOrPhone)
    let patientCreated = false
    if (!patient) {
      const created = await createPatientForReception({ patientInfo, patientEmailOrPhone })
      if (created.errorStatus) {
        return res.status(created.errorStatus).json({ message: created.errorMessage })
      }
      patient = created.patient
      patientCreated = Boolean(created.created)
    }
    if (patient.isActive === false) {
      return res.status(400).json({ message: 'Tài khoản bệnh nhân đang bị khóa.' })
    }

    const patientIdStr = String(patient._id)

    if (!doctorId || !appointmentDate || !startTime) {
      return res.status(400).json({
        message: 'Thiếu doctorId, appointmentDate hoặc startTime.',
      })
    }

    const doctorIdStr = String(doctorId).trim()
    const startTimeStr = String(startTime).trim()
    const appointmentDateStr = String(appointmentDate).trim()

    if (!isValidIsoDateOnly(appointmentDateStr)) {
      return res.status(400).json({ message: 'appointmentDate phải có dạng YYYY-MM-DD.' })
    }
    if (!isValidHHmm(startTimeStr)) {
      return res.status(400).json({ message: 'startTime phải có dạng HH:mm.' })
    }

    let doctor = await User.collection.findOne({ _id: doctorIdStr })
    if (!doctor && isMongoObjectId(doctorIdStr)) {
      doctor = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(doctorIdStr) })
    }
    if (!doctor) {
      return res.status(400).json({ message: 'Không tìm thấy bác sĩ với id đã chọn.' })
    }
    if (String(doctor.userType) !== 'doctor') {
      return res.status(400).json({ message: 'doctorId không trỏ tới tài khoản bác sĩ.' })
    }
    if (doctor.isActive === false) {
      return res.status(400).json({ message: 'Bác sĩ này đã bị vô hiệu hóa.' })
    }

    const date = new Date(`${appointmentDateStr}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'appointmentDate không hợp lệ.' })
    }

    const ACTIVE_STATUSES = ['pending', 'confirmed']
    const staffDoc = await findUserByIdFlexible(req.user.id, {
      firstName: 1,
      lastName: 1,
      email: 1,
      userType: 1,
    })
    const createdByStaff = staffSummary(staffDoc) || {
      id: String(req.user.id || ''),
      displayName: 'Nhân viên phòng khám',
      email: '',
      userType: String(req.user.userType || ''),
    }

    const patientTimeConflict = await Appointment.findOne({
      patientId: patientIdStr,
      appointmentDate: date,
      startTime: startTimeStr,
      status: { $in: ACTIVE_STATUSES },
    })
      .select({ _id: 1 })
      .lean()

    if (patientTimeConflict) {
      return res.status(409).json({
        message: 'Bệnh nhân đã có lịch khác trùng khung giờ này. Vui lòng chọn giờ khác.',
      })
    }

    const patientDoctorConflict = await Appointment.findOne({
      patientId: patientIdStr,
      doctorId: doctorIdStr,
      status: { $in: ACTIVE_STATUSES },
    })
      .select({ _id: 1 })
      .lean()

    if (patientDoctorConflict) {
      return res.status(409).json({
        message:
          'Bệnh nhân đã có lịch đang chờ/xác nhận với bác sĩ này. Chỉ đặt lại sau khi lịch đó hoàn thành hoặc đã hủy.',
      })
    }

    let appointment
    try {
      appointment = await Appointment.create({
        patientId: patientIdStr,
        doctorId: doctorIdStr,
        appointmentDate: date,
        startTime: startTimeStr,
        note: note ? String(note).trim() : '',
        status: 'pending',
        source: 'clinic',
        createdByStaff,
      })
    } catch (e) {
      if (e && (e.code === 11000 || e?.name === 'MongoServerError')) {
        return res.status(409).json({ message: 'Khung giờ này đã có người đặt. Vui lòng chọn giờ khác.' })
      }
      throw e
    }

    const ticket = buildTicketCode(appointment._id, appointment.appointmentDate)
    queueAppointmentConfirmationEmail({
      patient,
      doctor,
      appointment,
      ticket,
    })

    return res.status(201).json({
      message: patientCreated
        ? 'Đã tạo tài khoản bệnh nhân với mật khẩu mặc định 111111 và đặt lịch thành công.'
        : 'Đặt lịch thành công.',
      ticket,
      patientCreated,
      appointment: {
        id: appointment._id,
        ticket,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        status: appointment.status,
        source: appointment.source,
        bookingSource: appointment.source,
        createdByStaff: appointment.createdByStaff || null,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

function buildPatientCode(userId) {
  const raw = String(userId || '').replace(/[^a-fA-F0-9]/g, '')
  const yy = String(new Date().getFullYear()).slice(-2)
  const pad = (raw + '00000000').slice(0, 8).toUpperCase()
  return `YM${yy}${pad}`
}

/** Tiếp nhận: tra BN theo mã hiển thị (YM…), khớp buildPatientCode. */
export async function lookupPatientByCode(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist' && String(req.user?.userType || '') !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới tra cứu được mã bệnh nhân.' })
    }
    const code = String(req.query.code || '').trim()
    if (!code) {
      return res.status(400).json({ message: 'Thiếu mã bệnh nhân.' })
    }
    const normalized = code.toUpperCase()
    const patients = await User.find({
      userType: 'patient',
      isActive: { $ne: false },
    })
      .select({ firstName: 1, lastName: 1, email: 1, phone: 1, dob: 1, gender: 1, address: 1, avatarUrl: 1 })
      .lean()
    const hit = patients.find((u) => buildPatientCode(u._id).toUpperCase() === normalized)
    if (!hit) {
      return res.status(404).json({ message: 'Không tìm thấy bệnh nhân với mã này.' })
    }
    return res.status(200).json({
      patient: {
        id: hit._id,
        firstName: hit.firstName,
        lastName: hit.lastName,
        displayName: [hit.lastName, hit.firstName].filter(Boolean).join(' ').trim(),
        email: hit.email,
        phone: hit.phone,
        avatarUrl: hit.avatarUrl,
        dob: hit.dob ?? null,
        gender: genderLabel(hit.gender),
        address: hit.address || '',
        age: ageFromDob(hit.dob),
        patientCode: buildPatientCode(hit._id),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/** Tiếp nhận: danh sách bệnh nhân (lọc + phân trang) để chọn nhanh. */
export async function listPatientsReception(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist' && String(req.user?.userType || '') !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới xem được danh sách bệnh nhân.' })
    }

    const pageRaw = Number(req.query.page || 1)
    const pageSizeRaw = Number(req.query.pageSize || 10)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
    const pageSize =
      Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 && pageSizeRaw <= 50 ? Math.floor(pageSizeRaw) : 10

    const patientCodeQ = String(req.query.patientCode || '').trim().toUpperCase()
    const nameQ = String(req.query.name || '').trim().toLowerCase()
    const phoneQ = String(req.query.phone || '').trim()
    const accountQ = String(req.query.account || '').trim().toLowerCase() // email

    // Nếu tìm theo mã BN (YM..) thì dùng logic lookup chính xác.
    if (patientCodeQ) {
      // Reuse existing behavior (exact code match).
      const fakeReq = { ...req, query: { ...req.query, code: patientCodeQ } }
      // Call lookupPatientByCode but capture its output.
      let statusCode = 200
      const out = await new Promise((resolve) => {
        const fakeRes = {
          status(code) {
            statusCode = code
            return this
          },
          json(payload) {
            resolve(payload)
          },
        }
        // eslint-disable-next-line no-underscore-dangle
        lookupPatientByCode(fakeReq, fakeRes)
      })
      if (statusCode !== 200 || !out?.patient) {
        return res.status(200).json({ patients: [], total: 0, page, pageSize })
      }
      return res.status(200).json({ patients: [out.patient], total: 1, page: 1, pageSize: 1 })
    }

    const query = {
      userType: 'patient',
      isActive: { $ne: false },
    }
    if (phoneQ) query.phone = { $regex: escapeRegex(phoneQ), $options: 'i' }
    if (accountQ) query.email = { $regex: escapeRegex(accountQ), $options: 'i' }

    const projection = {
      firstName: 1,
      lastName: 1,
      email: 1,
      phone: 1,
      dob: 1,
      gender: 1,
      address: 1,
      citizenId: 1,
      avatarUrl: 1,
      createdAt: 1,
    }

    // Name search: apply in-memory (first/last can be missing and we want fullName contains).
    const raw = await User.find(query).select(projection).sort({ createdAt: -1 }).lean()

    let rows = (raw || []).map((u) => ({
      id: u._id,
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: [u.lastName, u.firstName].filter(Boolean).join(' ').trim(),
      email: u.email,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      dob: u.dob ?? null,
      gender: genderLabel(u.gender),
      address: u.address || '',
      age: ageFromDob(u.dob),
      patientCode: buildPatientCode(u._id),
      citizenId: u.citizenId || '',
    }))

    if (nameQ) {
      rows = rows.filter((r) => String(r.displayName || '').toLowerCase().includes(nameQ))
    }

    const total = rows.length
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const patients = rows.slice(start, end)

    return res.status(200).json({ patients, total, page, pageSize })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function listPatientHistoryReception(req, res) {
  try {
    const ut = String(req.user?.userType || '').trim().toLowerCase()
    const isReception = ut === 'receptionist' || ut === 'registration'
    const isDoctor = ut === 'doctor'
    if (!isReception && !isDoctor) {
      return res.status(403).json({ message: 'Không có quyền xem lịch sử khám.' })
    }

    const patientId = String(req.query.patientId || '').trim()
    if (!patientId) {
      return res.status(400).json({ message: 'Thiếu patientId.' })
    }

    if (isDoctor) {
      const doctorIdStr = String(req.user?.id || '').trim()
      const linked = await Appointment.exists({ patientId, doctorId: doctorIdStr })
      if (!linked) {
        return res.status(403).json({ message: 'Bạn chưa có lịch khám với bệnh nhân này.' })
      }
    }

    const items = await Appointment.find({ patientId })
      .sort({ appointmentDate: -1, startTime: -1, createdAt: -1 })
      .limit(50)
      .lean()

    const doctorIdsRaw = [...new Set((items || []).map((a) => String(a?.doctorId || '').trim()).filter(Boolean))]
    const doctorObjectIds = doctorIdsRaw.filter(isMongoObjectId).map((id) => new mongoose.Types.ObjectId(id))

    const doctors =
      doctorIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'doctor',
                $or: [
                  { _id: { $in: doctorIdsRaw } },
                  doctorObjectIds.length ? { _id: { $in: doctorObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  specialtyID: 1,
                  specialtyId: 1,
                  specialtyName: 1,
                  specialty: 1,
                },
              },
            )
            .toArray()
        : []

    const doctorById = new Map(doctors.map((d) => [String(d._id), d]))
    const specialtyIds = Array.from(
      new Set(
        doctors
          .map((d) => d?.specialtyID ?? d?.specialtyId)
          .filter(Boolean)
          .map((id) => String(id).trim()),
      ),
    )

    const specialties = specialtyIds.length
      ? await Specialty.find({ specialtyID: { $in: specialtyIds } }, { specialtyID: 1, specialtyName: 1 }).lean()
      : []
    const specialtyNameById = new Map(
      specialties.map((s) => [String(s.specialtyID), String(s.specialtyName || '').trim()]),
    )

    const apptIdKeys = (items || []).map((a) => String(a._id))
    const examinations = apptIdKeys.length
      ? await Examination.find({ appointmentId: { $in: apptIdKeys } }).lean()
      : []
    const examinationByApptId = new Map(examinations.map((ex) => [String(ex.appointmentId), ex]))

    return res.status(200).json({
      appointments: (items || []).map((a) => {
        const did = String(a?.doctorId || '').trim()
        const doc = did ? doctorById.get(did) || null : null
        const specId = doc ? doc.specialtyID ?? doc.specialtyId : ''
        const specialtyName = specId
          ? specialtyNameById.get(String(specId).trim()) || String(doc?.specialtyName || doc?.specialty || '').trim()
          : String(doc?.specialtyName || doc?.specialty || '').trim()
        const doctorName = doc
          ? [doc.lastName, doc.firstName].filter(Boolean).join(' ').trim() || doc.email || ''
          : ''

        const specialtyId = specId ? String(specId).trim() : ''
        const exRaw = examinationByApptId.get(String(a._id)) || null
        const examination = exRaw ? serializeExamination(exRaw) : null

        return {
          id: a._id,
          ticket: buildTicketCode(a._id, a.appointmentDate),
          appointmentDate: a.appointmentDate,
          startTime: a.startTime,
          status: a.status || 'pending',
          note: a.note || '',
          createdAt: a.createdAt,
          doctorId: did,
          specialtyId,
          doctorName,
          specialtyName,
          examination,
          doctor: doc
            ? {
                id: doc._id,
                firstName: doc.firstName,
                lastName: doc.lastName,
                displayName: doctorName,
                email: doc.email,
                specialtyId,
                specialtyName,
              }
            : null,
        }
      }),
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/** Bác sĩ kết thúc khám — chuyển lịch sang trạng thái `examined`. */
export async function finishExamAppointment(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'doctor') {
      return res.status(403).json({ message: 'Chỉ bác sĩ mới kết thúc khám được.' })
    }

    const doctorIdStr = String(req.user?.id || '').trim()
    const rawId = String(req.params.id || '').trim()
    if (!isMongoObjectId(rawId)) {
      return res.status(400).json({ message: 'Mã lịch không hợp lệ.' })
    }

    const appt = await Appointment.findById(rawId)
    if (!appt) {
      return res.status(404).json({ message: 'Không tìm thấy lịch khám.' })
    }

    if (String(appt.doctorId || '').trim() !== doctorIdStr) {
      return res.status(403).json({ message: 'Bạn không có quyền kết thúc khám lịch này.' })
    }

    const st = String(appt.status || '').toLowerCase()
    if (st === 'cancelled') {
      return res.status(400).json({ message: 'Lịch đã hủy, không thể kết thúc khám.' })
    }
    if (st === 'examined' || st === 'completed' || st === 'done') {
      return res.status(200).json({
        message: 'Lịch đã ở trạng thái đã khám.',
        appointment: {
          id: appt._id,
          status: appt.status,
        },
      })
    }
    if (st !== 'confirmed') {
      return res.status(400).json({ message: 'Chỉ kết thúc khám được lịch đang chờ khám (đã xác nhận).' })
    }

    appt.status = 'examined'
    await appt.save()

    return res.status(200).json({
      message: 'Đã kết thúc khám.',
      appointment: {
        id: appt._id,
        status: appt.status,
        ticket: buildTicketCode(appt._id, appt.appointmentDate),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

function ageFromDob(dob) {
  if (!dob) return null
  const d = dob instanceof Date ? dob : new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000)))
}

function genderLabel(g) {
  if (g === true) return 'Nam'
  if (g === false) return 'Nữ'
  return ''
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function listReceptionAppointments(req, res) {
  try {
    const ut = String(req.user?.userType || '').trim().toLowerCase()
    if (ut !== 'receptionist' && ut !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới xem được danh sách này.' })
    }

    const fromStr = String(req.query.from || '').trim()
    const toStr = String(req.query.to || '').trim()
    const today = new Date()
    const defaultIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const f = fromStr && isValidIsoDateOnly(fromStr) ? fromStr : defaultIso
    const t = toStr && isValidIsoDateOnly(toStr) ? toStr : f
    const from = new Date(`${f}T00:00:00`)
    const to = new Date(`${t}T23:59:59.999`)

    const statusQ = String(req.query.status || 'all').toLowerCase()
    const query = { appointmentDate: { $gte: from, $lte: to } }
    if (['pending', 'confirmed', 'cancelled'].includes(statusQ)) {
      query.status = statusQ
    }

    const items = await Appointment.find(query)
      .sort({ appointmentDate: 1, startTime: 1, createdAt: 1 })
      .lean()

    const patientIdsRaw = [...new Set((items || []).map((a) => String(a?.patientId || '').trim()).filter(Boolean))]
    const doctorIdsRaw = [...new Set((items || []).map((a) => String(a?.doctorId || '').trim()).filter(Boolean))]

    const patientObjectIds = patientIdsRaw.filter(isMongoObjectId).map((id) => new mongoose.Types.ObjectId(id))
    const doctorObjectIds = doctorIdsRaw.filter(isMongoObjectId).map((id) => new mongoose.Types.ObjectId(id))

    const patients =
      patientIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'patient',
                $or: [
                  { _id: { $in: patientIdsRaw } },
                  patientObjectIds.length ? { _id: { $in: patientObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  phone: 1,
                  avatarUrl: 1,
                  dob: 1,
                  gender: 1,
                  address: 1,
                },
              },
            )
            .toArray()
        : []

    const doctors =
      doctorIdsRaw.length > 0
        ? await User.collection
            .find(
              {
                userType: 'doctor',
                $or: [
                  { _id: { $in: doctorIdsRaw } },
                  doctorObjectIds.length ? { _id: { $in: doctorObjectIds } } : { _id: { $in: [] } },
                ],
              },
              {
                projection: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  avatarUrl: 1,
                  specialtyID: 1,
                  specialtyId: 1,
                  specialtyName: 1,
                  specialty: 1,
                  clinicRoomID: 1,
                  consultationFee: 1,
                },
              },
            )
            .toArray()
        : []

    const patientById = new Map(patients.map((p) => [String(p._id), p]))
    const doctorById = new Map(doctors.map((d) => [String(d._id), d]))

    const specialtyIds = Array.from(
      new Set(
        doctors
          .map((d) => d?.specialtyID ?? d?.specialtyId)
          .filter(Boolean)
          .map((id) => String(id).trim()),
      ),
    )

    const specialties = specialtyIds.length
      ? await Specialty.find({ specialtyID: { $in: specialtyIds } }, { specialtyID: 1, specialtyName: 1 }).lean()
      : []

    const specialtyNameById = new Map(
      specialties.map((s) => [String(s.specialtyID), String(s.specialtyName || '').trim()]),
    )

    const doctorRoomIdsForList = doctors.map((d) => d.clinicRoomID).filter(Boolean).map(String)
    const doctorRoomMetaMap = await getClinicRoomMetaMap(doctorRoomIdsForList)

    const qRaw = String(req.query.q || '').trim().toLowerCase()

    let rows = (items || []).map((a) => {
      const pid = String(a?.patientId || '').trim()
      const did = String(a?.doctorId || '').trim()
      const p = pid ? patientById.get(pid) : null
      const doc = did ? doctorById.get(did) : null
      const ticket = buildTicketCode(a._id, a.appointmentDate)
      const specId = doc ? doc.specialtyID ?? doc.specialtyId : ''
      const specialtyName = specId
        ? specialtyNameById.get(String(specId).trim()) || String(doc?.specialtyName || doc?.specialty || '').trim()
        : String(doc?.specialtyName || doc?.specialty || '').trim()

      const patientOut = p
        ? {
            id: p._id,
            patientCode: buildPatientCode(p._id),
            firstName: p.firstName,
            lastName: p.lastName,
            displayName: [p.lastName, p.firstName].filter(Boolean).join(' ').trim(),
            email: p.email,
            phone: p.phone,
            avatarUrl: p.avatarUrl,
            dob: p.dob ?? null,
            age: ageFromDob(p.dob),
            gender: genderLabel(p.gender),
            address: p.address || '',
          }
        : null

      return {
        id: a._id,
        ticket,
        appointmentDate: a.appointmentDate,
        startTime: a.startTime,
        endTime: a.endTime || '',
        status: a.status || 'pending',
        source: a.source || '',
        bookingSource: a.source || '',
        createdByStaff: a.createdByStaff || null,
        note: a.note || '',
        visitQueueNumber: a.visitQueueNumber ?? null,
        clinicRoom: a.clinicRoom || '',
        cancelReason: a.cancelReason || '',
        cancelledAt: a.cancelledAt || null,
        cancelledBy: a.cancelledBy || null,
        confirmedAt: a.confirmedAt || null,
        confirmedBy: a.confirmedBy || null,
        createdAt: a.createdAt,
        patient: patientOut,
        doctor: doc
          ? {
              id: doc._id,
              firstName: doc.firstName,
              lastName: doc.lastName,
              displayName: [doc.lastName, doc.firstName].filter(Boolean).join(' ').trim(),
              email: doc.email,
              avatarUrl: doc.avatarUrl,
              specialtyName,
              clinicRoomID: String(doc.clinicRoomID || '').trim(),
              clinicRoomName: (() => {
                const rid = String(doc.clinicRoomID || '').trim()
                const m = rid ? doctorRoomMetaMap.get(rid) : null
                return m ? clinicRoomDisplayLabel(rid, m) : rid
              })(),
              consultationFee: resolveConsultationFee(doc.consultationFee),
            }
          : null,
        consultationFee: doc ? resolveConsultationFee(doc.consultationFee) : DEFAULT_CONSULTATION_FEE,
        payment: serializePayment(a),
      }
    })

    if (qRaw) {
      rows = rows.filter((r) => {
        const ticket = String(r.ticket || '').toLowerCase()
        const pn = String(r.patient?.displayName || '').toLowerCase()
        const ph = String(r.patient?.phone || '').toLowerCase()
        const em = String(r.patient?.email || '').toLowerCase()
        const pc = String(r.patient?.patientCode || '').toLowerCase()
        return (
          ticket.includes(qRaw) ||
          pn.includes(qRaw) ||
          ph.includes(qRaw) ||
          em.includes(qRaw) ||
          pc.includes(qRaw)
        )
      })
    }

    return res.status(200).json({ appointments: rows })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/**
 * Cập nhật visitQueueNumber / clinicRoom từ body (chỉ khi có key tương ứng).
 * @throws {Error} message VISIT_QUEUE_INVALID | CLINIC_ROOM_TOO_LONG
 */
function applyVisitFieldsFromRequest(appt, body) {
  const b = body && typeof body === 'object' ? body : {}
  if (Object.prototype.hasOwnProperty.call(b, 'visitQueueNumber')) {
    const raw = b.visitQueueNumber
    if (raw === null || raw === undefined || raw === '') {
      appt.set('visitQueueNumber', undefined)
    } else {
      const n = Number.parseInt(String(raw), 10)
      if (!Number.isFinite(n) || n < 1) {
        const err = new Error('VISIT_QUEUE_INVALID')
        throw err
      }
      appt.visitQueueNumber = n
    }
  }
  if (Object.prototype.hasOwnProperty.call(b, 'clinicRoom')) {
    const room = String(b.clinicRoom ?? '').trim()
    if (room.length > 80) {
      const err = new Error('CLINIC_ROOM_TOO_LONG')
      throw err
    }
    appt.clinicRoom = room
  }
}

export async function updateAppointmentStatusReception(req, res) {
  try {
    const role = String(req.user?.userType || '').trim().toLowerCase()
    if (role !== 'receptionist' && role !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới cập nhật được trạng thái lịch.' })
    }

    const rawId = String(req.params.id || '').trim()
    if (!isMongoObjectId(rawId)) {
      return res.status(400).json({ message: 'Mã lịch không hợp lệ.' })
    }

    const status = String(req.body?.status || '').trim().toLowerCase()
    if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái không hợp lệ (pending, confirmed, cancelled).' })
    }

    const appt = await Appointment.findById(rawId)
    if (!appt) {
      return res.status(404).json({ message: 'Không tìm thấy lịch khám.' })
    }

    const prevStatus = String(appt.status || '').toLowerCase()

    if (status === 'cancelled') {
      const reasonRaw = String(req.body?.cancelReason ?? req.body?.reason ?? '').trim()
      if (reasonRaw.length > 500) {
        return res.status(400).json({ message: 'Lý do hủy quá dài (tối đa 500 ký tự).' })
      }
      const bySystem =
        req.body?.cancelledBySystem === true ||
        req.body?.cancelledBySystem === 'true' ||
        req.body?.cancelledBySystem === 1
      if (bySystem) {
        if (!isPendingAppointmentPastSlotServer(appt)) {
          return res.status(400).json({
            message:
              'Không thể ghi nhận hủy tự động: lịch chưa qua khung giờ hoặc không còn ở trạng thái chờ.',
          })
        }
        appt.cancelReason =
          reasonRaw || 'Quá thời gian chờ xác nhận — khung giờ khám đã kết thúc, hệ thống tự hủy lịch.'
        appt.cancelledAt = new Date()
        appt.cancelledBy = {
          role: 'system',
          id: 'system',
          displayName: 'Hệ thống',
          email: '',
          userType: 'system',
        }
      } else {
        const staffDoc = await findUserByIdFlexible(req.user.id, {
          firstName: 1,
          lastName: 1,
          email: 1,
          userType: 1,
        })
        const who = staffSummary(staffDoc) || {
          id: String(req.user.id || ''),
          displayName: 'Nhân viên phòng khám',
          email: '',
          userType: String(req.user.userType || ''),
        }
        appt.cancelReason = reasonRaw || 'Hủy bởi nhân viên tiếp nhận'
        appt.cancelledAt = new Date()
        appt.cancelledBy = { role: 'staff', ...who }
      }
      appt.confirmedBy = null
      appt.confirmedAt = null
      appt.clinicRoom = ''
      appt.set('visitQueueNumber', undefined)
    } else if (status === 'confirmed') {
      if (!isAppointmentPaid(appt)) {
        return res.status(400).json({ message: 'Chưa thu phí khám.' })
      }
      appt.cancelReason = ''
      appt.cancelledAt = null
      appt.cancelledBy = null
      if (prevStatus !== 'confirmed') {
        const staffDoc = await findUserByIdFlexible(req.user.id, {
          firstName: 1,
          lastName: 1,
          email: 1,
          userType: 1,
        })
        const who = staffSummary(staffDoc) || {
          id: String(req.user.id || ''),
          displayName: 'Nhân viên phòng khám',
          email: '',
          userType: String(req.user.userType || ''),
        }
        appt.confirmedBy = { role: 'staff', ...who }
        appt.confirmedAt = new Date()
      }
      if (role === 'receptionist') {
        try {
          applyVisitFieldsFromRequest(appt, req.body)
        } catch (e) {
          if (e?.message === 'VISIT_QUEUE_INVALID') {
            return res.status(400).json({
              message: 'Số thứ tự phải là số nguyên dương, hoặc để trống để hệ thống tự gán theo phòng trong ngày.',
            })
          }
          if (e?.message === 'CLINIC_ROOM_TOO_LONG') {
            return res.status(400).json({ message: 'Tên phòng quá dài (tối đa 80 ký tự).' })
          }
          throw e
        }
        if (shouldAutoAssignVisitQueueNumber(req.body, prevStatus)) {
          const nextN = await getNextVisitQueueNumberForRoom({
            appointmentDate: appt.appointmentDate,
            clinicRoom: appt.clinicRoom || '',
            excludeAppointmentId: appt._id,
          })
          appt.visitQueueNumber = nextN
        }
      }
    } else {
      appt.cancelReason = ''
      appt.cancelledAt = null
      appt.cancelledBy = null
      appt.confirmedBy = null
      appt.confirmedAt = null
      appt.clinicRoom = ''
      appt.set('visitQueueNumber', undefined)
    }

    appt.status = status
    await appt.save()

    return res.status(200).json({
      message: 'Đã cập nhật trạng thái.',
      appointment: {
        id: appt._id,
        status: appt.status,
        visitQueueNumber: appt.visitQueueNumber ?? null,
        clinicRoom: appt.clinicRoom || '',
        cancelReason: appt.cancelReason || '',
        cancelledAt: appt.cancelledAt || null,
        cancelledBy: appt.cancelledBy || null,
        confirmedAt: appt.confirmedAt || null,
        confirmedBy: appt.confirmedBy || null,
        payment: serializePayment(appt),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

/** Lễ tân / đăng ký: ghi nhận đã thu phí khám — lưu vào MongoDB trên document Appointment. */
export async function recordAppointmentPayment(req, res) {
  try {
    const role = String(req.user?.userType || '').trim().toLowerCase()
    if (role !== 'receptionist' && role !== 'registration') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận / đăng ký mới thu phí được.' })
    }

    const rawId = String(req.params.id || '').trim()
    if (!isMongoObjectId(rawId)) {
      return res.status(400).json({ message: 'Mã lịch không hợp lệ.' })
    }

    const appt = await Appointment.findById(rawId)
    if (!appt) {
      return res.status(404).json({ message: 'Không tìm thấy lịch khám.' })
    }

    const st = String(appt.status || '').toLowerCase()
    if (st === 'cancelled') {
      return res.status(400).json({ message: 'Lịch đã hủy, không thể thu phí.' })
    }
    if (st !== 'pending') {
      return res.status(400).json({ message: 'Chỉ thu phí khi lịch đang chờ xác nhận.' })
    }

    if (isAppointmentPaid(appt)) {
      return res.status(409).json({
        message: 'Lịch đã được ghi nhận thanh toán.',
        appointment: {
          id: appt._id,
          ticket: buildTicketCode(appt._id, appt.appointmentDate),
          status: appt.status,
          payment: serializePayment(appt),
        },
      })
    }

    const method = String(req.body?.method || '').trim().toLowerCase()
    if (!['cash', 'transfer'].includes(method)) {
      return res.status(400).json({ message: 'Phương thức thanh toán không hợp lệ (cash hoặc transfer).' })
    }

    let doctor = await User.collection.findOne({ _id: String(appt.doctorId || '').trim() })
    if (!doctor && isMongoObjectId(appt.doctorId)) {
      doctor = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(appt.doctorId) })
    }

    const amountRaw = req.body?.amount
    let amount = resolveConsultationFee(doctor?.consultationFee)
    if (amountRaw != null && amountRaw !== '') {
      const n = Number(amountRaw)
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: 'Số tiền không hợp lệ.' })
      }
      amount = Math.round(n)
    }

    const staffDoc = await findUserByIdFlexible(req.user.id, {
      firstName: 1,
      lastName: 1,
      email: 1,
      userType: 1,
    })
    const who = staffSummary(staffDoc) || {
      id: String(req.user.id || ''),
      displayName: 'Nhân viên phòng khám',
      email: '',
      userType: String(req.user.userType || ''),
    }

    const note = String(req.body?.note || '').trim()
    if (note.length > 300) {
      return res.status(400).json({ message: 'Ghi chú thanh toán quá dài (tối đa 300 ký tự).' })
    }

    const invoiceNo = await nextPaymentInvoiceNo(appt.appointmentDate)
    const paidAt = new Date()

    appt.payment = {
      status: 'paid',
      amount,
      method,
      paidAt,
      paidBy: who,
      note,
      invoiceNo,
    }
    await appt.save()

    return res.status(200).json({
      message: 'Đã ghi nhận thanh toán.',
      appointment: {
        id: appt._id,
        ticket: buildTicketCode(appt._id, appt.appointmentDate),
        status: appt.status,
        appointmentDate: appt.appointmentDate,
        startTime: appt.startTime,
        visitQueueNumber: appt.visitQueueNumber ?? null,
        clinicRoom: appt.clinicRoom || '',
        payment: serializePayment(appt),
        consultationFee: resolveConsultationFee(doctor?.consultationFee),
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
