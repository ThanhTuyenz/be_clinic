import mongoose from 'mongoose'

/**
 * Danh mục phòng khám — dùng roomID làm mã ổn định (lưu vào Appointment.clinicRoom).
 * Collection: clinicRoom
 */
const clinicRoomSchema = new mongoose.Schema(
  {
    roomID: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    building: { type: String, default: '', trim: true },
    floor: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    collection: 'clinicRoom',
    timestamps: true,
  }
)

clinicRoomSchema.index({ isActive: 1, sortOrder: 1 })

export default mongoose.model('ClinicRoom', clinicRoomSchema)
