declare const _default: mongoose.Model<{
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
    collection: string;
}> & {
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
    collection: string;
}, {
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
    collection: string;
}>> & mongoose.FlatRecord<{
    patientId: string;
    doctorId: string;
    note: string;
    clinicRoom: string;
    appointmentId: string;
    symptoms: string;
    diagnosis: string;
    treatment: string;
    examAt: string;
    temp: string;
    breath: string;
    bp: string;
    pulse: string;
    height: string;
    weight: string;
    bmi: string;
    spo2: string;
    reExamination?: NativeDate;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
