import mongoose from 'mongoose'

const medicineSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, default: '' },
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: '', trim: true },
    strength: { type: String, default: '', trim: true },
    form: { type: String, default: '', trim: true },
    manufacturer: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'medicine' }
)

medicineSchema.index({ name: 1 })
medicineSchema.index({ code: 1 })

export default mongoose.model('Medicine', medicineSchema)
