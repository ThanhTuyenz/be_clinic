"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const appointmentSchema = new mongoose_1.default.Schema({
    patientId: {
        type: String,
        ref: 'User',
        required: true,
    },
    doctorId: {
        type: String,
        ref: 'User',
        required: true,
    },
    appointmentDate: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String },
    status: { type: String, default: 'pending' },
    source: {
        type: String,
        enum: ['online', 'clinic'],
        default: 'online',
    },
    createdByStaff: {
        id: { type: String, trim: true },
        displayName: { type: String, trim: true },
        email: { type: String, trim: true },
        userType: { type: String, trim: true },
    },
    note: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    cancelledAt: { type: Date },
    cancelledBy: {
        role: { type: String, trim: true },
        id: { type: String, trim: true },
        displayName: { type: String, trim: true },
        email: { type: String, trim: true },
        userType: { type: String, trim: true },
    },
    confirmedAt: { type: Date },
    confirmedBy: {
        role: { type: String, trim: true },
        id: { type: String, trim: true },
        displayName: { type: String, trim: true },
        email: { type: String, trim: true },
        userType: { type: String, trim: true },
    },
    visitQueueNumber: { type: Number, min: 1 },
    clinicRoom: { type: String, default: '', trim: true },
}, { timestamps: true });
appointmentSchema.index({ patientId: 1, appointmentDate: -1 });
appointmentSchema.index({ doctorId: 1, appointmentDate: 1, startTime: 1 }, {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } },
});
exports.default = mongoose_1.default.model('Appointment', appointmentSchema);
//# sourceMappingURL=Appointment.js.map