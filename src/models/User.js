import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },
    userType: {
      type: String,
      required: true,
      enum: ['patient', 'doctor', 'receptionist'],
    },
    isActive: { type: Boolean, default: true },
    fullName: { type: String, trim: true },
    phone: { type: String, trim: true },
    dob: { type: Date },
    gender: { type: Boolean },
    address: { type: String, trim: true },
    citizenId: { type: String, trim: true },
    specialtyId: { type: mongoose.Schema.Types.ObjectId },
    shiftId: { type: mongoose.Schema.Types.ObjectId },
    bio: { type: String, trim: true },
  },
  { timestamps: true }
)

userSchema.index({ phone: 1 }, { unique: true, sparse: true })

export default mongoose.model('User', userSchema)
