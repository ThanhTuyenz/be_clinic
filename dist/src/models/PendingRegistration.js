"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const pendingRegistrationSchema = new mongoose_1.default.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailOtpHash: { type: String, required: true, select: false },
    emailOtpExpires: { type: Date, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
}, { timestamps: true });
pendingRegistrationSchema.index({ emailOtpExpires: 1 });
exports.default = mongoose_1.default.model('PendingRegistration', pendingRegistrationSchema);
//# sourceMappingURL=PendingRegistration.js.map