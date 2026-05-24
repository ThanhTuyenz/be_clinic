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
    source: {
      type: String,
      enum: ['online', 'clinic'],
      default: 'online',
    },
    createdByStaff: {
      id: { type: String, trim: true },
      displayName: { type: String, trim: true },
      email: { type: String, trim: true },
      userType: { type: String, trim: true },
    },
    note: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    cancelledAt: { type: Date },
    cancelledBy: {
      role: { type: String, trim: true },
      id: { type: String, trim: true },
      displayName: { type: String, trim: true },
      email: { type: String, trim: true },
      userType: { type: String, trim: true },
    },
    confirmedAt: { type: Date },
    confirmedBy: {
      role: { type: String, trim: true },
      id: { type: String, trim: true },
      displayName: { type: String, trim: true },
      email: { type: String, trim: true },
      userType: { type: String, trim: true },
    },
    /** Số thứ tự tiếp nhận khi BN đến quầy (lễ tân). */
    visitQueueNumber: { type: Number, min: 1 },
    /** Phòng khám / phòng chỉ định (text). */
    clinicRoom: { type: String, default: '', trim: true },
    /** Thanh toán phí khám tại quầy (lễ tân). */
    payment: {
      status: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
      amount: { type: Number, min: 0 },
      method: { type: String, enum: ['cash', 'transfer', ''], default: '' },
      paidAt: { type: Date },
      paidBy: {
        id: { type: String, trim: true },
        displayName: { type: String, trim: true },
        email: { type: String, trim: true },
        userType: { type: String, trim: true },
      },
      note: { type: String, default: '', trim: true },
      invoiceNo: { type: String, default: '', trim: true },
    },
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

