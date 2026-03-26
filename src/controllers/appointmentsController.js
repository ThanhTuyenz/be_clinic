import Appointment from '../models/Appointment.js'
import User from '../models/User.js'

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

    const doctor = await User.findById(doctorId)
    if (!doctor || doctor.userType !== 'doctor') {
      return res.status(400).json({ message: 'doctorId không hợp lệ.' })
    }

    const date = new Date(`${appointmentDate}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ message: 'appointmentDate không hợp lệ.' })
    }

    const appointment = await Appointment.create({
      patientId: req.user.id,
      doctorId,
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

