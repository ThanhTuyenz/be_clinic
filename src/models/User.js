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
    /** Tài khoản tạo theo luồng OTP trước, chưa đặt mật khẩu */
    mustSetPassword: { type: Boolean, default: false },
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
    // In your Mongo, specialtyID is stored as string (e.g. "SPEC-001")
    specialtyId: { type: String, trim: true },
    // Some documents use "specialtyID" (capital D)
    specialtyID: { type: String, trim: true },
    shiftId: { type: mongoose.Schema.Types.ObjectId },
    bio: { type: String, trim: true },
    // Extra fields that may exist in Mongo (used by FE UI)
    avatarUrl: { type: String, trim: true },
    experienceYears: { type: Number },
  },
  { timestamps: true }
)

userSchema.index({ phone: 1 }, { unique: true, sparse: true })

export default mongoose.model('User', userSchema)
