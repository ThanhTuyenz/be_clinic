import mongoose from 'mongoose'

// Collection: "specialties" (see Mongo screenshot)
const specialtySchema = new mongoose.Schema(
  {
    specialtyID: { type: String },
    specialtyName: { type: String },
    description: { type: String },
    deptID: { type: String },
  },
  {
    collection: 'specialties',
    timestamps: true,
  }
)

export default mongoose.model('Specialty', specialtySchema)

