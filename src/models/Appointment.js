import mongoose from 'mongoose'

const appointmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: String,
      ref: 'User',
      required: true,
    },
    doctorId: {
      type: String,
      ref: 'User',
      required: true,
    },
    appointmentDate: { type: Date, required: true }, // chỉ phần ngày
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String }, // tuỳ chọn
    status: { type: String, default: 'pending' }, // pending/confirmed/cancelled
    note: { type: String, default: '' },
  },
  { timestamps: true }
)

appointmentSchema.index({ patientId: 1, appointmentDate: -1 })

// Prevent double-booking the same doctor/time slot.
// Only treat pending/confirmed as occupying a slot; cancelled does not block.
appointmentSchema.index(
  { doctorId: 1, appointmentDate: 1, startTime: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } },
  }
)

export default mongoose.model('Appointment', appointmentSchema)

