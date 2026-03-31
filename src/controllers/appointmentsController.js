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

export async function getAvailability(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân có thể xem khung giờ.' })
    }

    const doctorId = String(req.query.doctorId || '').trim()
    const dateStr = String(req.query.date || '').trim()
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

    return res.status(200).json({
      doctorId,
      date: dateStr,
      bookedStartTimes,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Lỗi máy chủ.' })
  }
}

