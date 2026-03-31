import mongoose from 'mongoose'
import Appointment from '../models/Appointment.js'
import User from '../models/User.js'

export async function listMyAppointments(req, res) {
  try {
    if (!req.user?.id || req.user.userType !== 'patient') {
      return res.status(403).json({ message: 'Chỉ bệnh nhân mới xem được lịch đã đặt.' })
    }

    const items = await Appointment.find({ patientId: req.user.id })
      .sort({ appointmentDate: -1, startTime: 1, createdAt: -1 })
      .populate({ path: 'doctorId', select: 'firstName lastName displayName email avatarUrl bio deptID deptName specialty specialtyName' })
      .lean()

    return res.status(200).json({
      appointments: (items || []).map((a) => ({
        id: a._id,
        appointmentDate: a.appointmentDate,
        startTime: a.startTime,
        endTime: a.endTime || '',
        status: a.status || 'pending',
        note: a.note || '',
        createdAt: a.createdAt,
        doctor: a.doctorId
          ? {
              id: a.doctorId._id,
              firstName: a.doctorId.firstName,
              lastName: a.doctorId.lastName,
              displayName: a.doctorId.displayName,
              email: a.doctorId.email,
              avatarUrl: a.doctorId.avatarUrl,
              deptID: a.doctorId.deptID,
              deptName: a.doctorId.deptName,
              specialty: a.doctorId.specialty,
              specialtyName: a.doctorId.specialtyName,
              bio: a.doctorId.bio,
            }
          : null,
      })),
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

    // Không ép cast ObjectId vì một số dữ liệu có thể lưu _id dạng string.
    // Dùng query thô để đảm bảo khớp chính xác với Mongo.
    const doctor = await User.collection.findOne({ _id: doctorIdStr })
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

    const date = new Date(`${appointmentDate}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'appointmentDate không hợp lệ.' })
    }

    const appointment = await Appointment.create({
      patientId: req.user.id,
      doctorId: doctorIdStr,
      appointmentDate: date,
      startTime: String(startTime).trim(),
      note: note ? String(note).trim() : '',
      status: 'pending',
    })

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

