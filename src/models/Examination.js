import mongoose from 'mongoose'

const prescriptionLineSchema = new mongoose.Schema(
  {
    medicineId: { type: String, default: '', trim: true },
    medicineCode: { type: String, default: '', trim: true },
    medicineName: { type: String, required: true, trim: true },
    unit: { type: String, default: '', trim: true },
    dosage: { type: String, default: '', trim: true },
    frequency: { type: String, default: '', trim: true },
    duration: { type: String, default: '', trim: true },
    quantity: { type: Number, min: 0 },
    route: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true },
  },
  { _id: true }
)

const examinationSchema = new mongoose.Schema(
  {
    appointmentId: { type: String, required: true, trim: true },
    patientId: { type: String, required: true, trim: true },
    doctorId: { type: String, required: true, trim: true },
    symptoms: { type: String, default: '' },
    diagnosis: { type: String, default: '' },
    treatment: { type: String, default: '' },
    note: { type: String, default: '' },
    prescriptionLines: { type: [prescriptionLineSchema], default: [] },
    reExamination: { type: Date, default: null },
    examAt: { type: String, default: '' },
    clinicRoom: { type: String, default: '' },
    temp: { type: String, default: '' },
    breath: { type: String, default: '' },
    bp: { type: String, default: '' },
    pulse: { type: String, default: '' },
    height: { type: String, default: '' },
    weight: { type: String, default: '' },
    bmi: { type: String, default: '' },
    spo2: { type: String, default: '' },
  },
  { timestamps: true, collection: 'examination' }
)

examinationSchema.index({ appointmentId: 1 }, { unique: true })

export default mongoose.model('Examination', examinationSchema)
