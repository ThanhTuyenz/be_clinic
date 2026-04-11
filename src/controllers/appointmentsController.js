import mongoose from 'mongoose'
import Appointment from '../models/Appointment.js'
import User from '../models/User.js'
import Specialty from '../models/Specialty.js'
import Department from '../models/Department.js'

function isMongoObjectId(id) {
  return typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)
}

function isValidIsoDateOnly(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isValidHHmm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
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

export async function listMyAppointments(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân mới xem được lịch đã đặt.' })
    }

    const items = await Appointment.find({ patientId: req.user.id })
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
            appointmentDate: a.appointmentDate,
            startTime: a.startTime,
            endTime: a.endTime || '',
            status: a.status || 'pending',
            note: a.note || '',
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
          appointmentDate: a.appointmentDate,
          startTime: a.startTime,
          endTime: a.endTime || '',
          status: a.status || 'pending',
          note: a.note || '',
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
          appointmentDate: a.appointmentDate,
          startTime: a.startTime,
          endTime: a.endTime || '',
          status: a.status || 'pending',
          note: a.note || '',
          createdAt: a.createdAt,
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
      })
    } catch (e) {
      // Duplicate key from unique slot index -> slot already booked.
      if (e && (e.code === 11000 || e?.name === 'MongoServerError')) {
        return res.status(409).json({ message: 'Khung giờ này đã có người đặt. Vui lòng chọn giờ khác.' })
      }
      throw e
    }

    return res.status(201).json({
      message: 'Đặt lịch thành công.',
      appointment: {
        id: appointment._id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        status: appointment.status,
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

    appt.status = 'cancelled'
    await appt.save()

    return res.status(200).json({
      message: 'Đã hủy lịch khám.',
      appointment: {
        id: appt._id,
        status: appt.status,
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
    } else if (userType === 'receptionist') {
      /* Lễ tân xem khung giờ để hỗ trợ đặt lịch */
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

    const allSlots = generateDaySlotTimes()
    const bookedSet = new Set(bookedStartTimes)
    const freeSlots = allSlots.filter((t) => !bookedSet.has(t))

    return res.status(200).json({
      doctorId,
      date: dateStr,
      bookedStartTimes,
      busySlots: bookedStartTimes,
      freeSlots,
    })
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
      status: { $in: ['pending', 'confirmed'] },
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

    const ticket = buildTicketCode(a._id, a.appointmentDate)

    return res.status(200).json({
      ticket,
      appointment: {
        id: a._id,
        appointmentDate: a.appointmentDate,
        startTime: a.startTime,
        endTime: a.endTime || '',
        status: a.status || 'pending',
        note: a.note || '',
        createdAt: a.createdAt,
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
          }
        : null,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

export async function createAppointmentReception(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận mới đặt lịch thay bệnh nhân.' })
    }

    const { patientEmailOrPhone, doctorId, appointmentDate, startTime, note } = req.body

    const patient = await findPatientUserByContact(patientEmailOrPhone)
    if (!patient) {
      return res.status(404).json({
        message: 'Không tìm thấy bệnh nhân với email/SĐT này. Bệnh nhân cần đăng ký tài khoản trước.',
      })
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
      })
    } catch (e) {
      if (e && (e.code === 11000 || e?.name === 'MongoServerError')) {
        return res.status(409).json({ message: 'Khung giờ này đã có người đặt. Vui lòng chọn giờ khác.' })
      }
      throw e
    }

    const ticket = buildTicketCode(appointment._id, appointment.appointmentDate)

    return res.status(201).json({
      message: 'Đặt lịch thành công.',
      ticket,
      appointment: {
        id: appointment._id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        status: appointment.status,
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

export async function listReceptionAppointments(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận mới xem được danh sách này.' })
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
        note: a.note || '',
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
            }
          : null,
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

export async function updateAppointmentStatusReception(req, res) {
  try {
    if (String(req.user?.userType || '') !== 'receptionist') {
      return res.status(403).json({ message: 'Chỉ nhân viên tiếp nhận mới cập nhật được trạng thái.' })
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

    appt.status = status
    await appt.save()

    return res.status(200).json({
      message: 'Đã cập nhật trạng thái.',
      appointment: {
        id: appt._id,
        status: appt.status,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}
