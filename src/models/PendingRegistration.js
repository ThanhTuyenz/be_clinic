import mongoose from 'mongoose'

const pendingRegistrationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailOtpHash: { type: String, required: true, select: false },
    emailOtpExpires: { type: Date, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
)

pendingRegistrationSchema.index({ emailOtpExpires: 1 })

export default mongoose.model('PendingRegistration', pendingRegistrationSchema)

