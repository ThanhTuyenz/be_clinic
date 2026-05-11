import mongoose from 'mongoose'

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true },
    avatar_url: { type: String, trim: true, default: '' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    is_available: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'doctors' },
)

doctorSchema.index({ specialty: 1, is_available: 1, rating: -1 })

export default mongoose.models.Doctor || mongoose.model('Doctor', doctorSchema)
