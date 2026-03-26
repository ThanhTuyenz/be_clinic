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
    emailVerified: { type: Boolean, default: false },
    emailOtpHash: { type: String, select: false },
    emailOtpExpires: { type: Date, select: false },
    /** Tên (given name) */
    firstName: { type: String, trim: true },
    /** Họ (family name) */
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    dob: { type: Date },
    gender: { type: Boolean },
    address: { type: String, trim: true },
    citizenId: { type: String, trim: true },
    specialtyId: { type: mongoose.Schema.Types.ObjectId },
    shiftId: { type: mongoose.Schema.Types.ObjectId },
    specialty: { type: String, trim: true },
    experienceYears: { type: Number, min: 0 },
    avatarUrl: { type: String, trim: true },
    bio: { type: String, trim: true },
  },
  { timestamps: true }
)

userSchema.index({ phone: 1 }, { unique: true, sparse: true })

export default mongoose.model('User', userSchema)
