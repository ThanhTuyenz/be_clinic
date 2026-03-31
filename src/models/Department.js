import mongoose from 'mongoose'

// Collection: "department" (see Mongo screenshot)
const departmentSchema = new mongoose.Schema(
  {
    deptID: { type: String },
    deptName: { type: String },
    description: { type: String },
  },
  {
    collection: 'department',
    timestamps: true,
  }
)

export default mongoose.model('Department', departmentSchema)

