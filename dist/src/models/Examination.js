"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const examinationSchema = new mongoose_1.default.Schema({
    appointmentId: { type: String, required: true, trim: true },
    patientId: { type: String, required: true, trim: true },
    doctorId: { type: String, required: true, trim: true },
    symptoms: { type: String, default: '' },
    diagnosis: { type: String, default: '' },
    treatment: { type: String, default: '' },
    note: { type: String, default: '' },
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
}, { timestamps: true, collection: 'examination' });
examinationSchema.index({ appointmentId: 1 }, { unique: true });
exports.default = mongoose_1.default.model('Examination', examinationSchema);
//# sourceMappingURL=Examination.js.map