"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const userSchema = new mongoose_1.default.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    passwordHash: { type: String, required: true },
    mustSetPassword: { type: Boolean, default: false },
    roleId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Role',
        required: true,
    },
    userType: {
        type: String,
        required: true,
        enum: [
            'patient',
            'doctor',
            'pharmacist',
            'cashier',
            'receptionist',
            'branch_manager',
            'admin',
            'super_admin',
        ],
    },
    isActive: { type: Boolean, default: true },
    emailVerified: { type: Boolean, default: false },
    emailOtpHash: { type: String, select: false },
    emailOtpExpires: { type: Date, select: false },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phone: { type: String, trim: true },
    dob: { type: Date },
    gender: { type: Boolean },
    ethnicity: { type: String, trim: true },
    address: { type: String, trim: true },
    citizenId: { type: String, trim: true },
    specialtyId: { type: String, trim: true },
    specialtyID: { type: String, trim: true },
    shiftId: { type: mongoose_1.default.Schema.Types.ObjectId },
    bio: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    experienceYears: { type: Number },
    consultationFee: { type: Number, min: 0 },
    clinicRoomID: { type: String, trim: true, default: '' },
}, { timestamps: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });
exports.default = mongoose_1.default.model('User', userSchema);
//# sourceMappingURL=User.js.map