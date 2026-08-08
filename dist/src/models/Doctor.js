"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const doctorSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true },
    avatar_url: { type: String, trim: true, default: '' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    is_available: { type: Boolean, default: true },
}, { timestamps: true, collection: 'doctors' });
doctorSchema.index({ specialty: 1, is_available: 1, rating: -1 });
exports.default = mongoose_1.default.models.Doctor || mongoose_1.default.model('Doctor', doctorSchema);
//# sourceMappingURL=Doctor.js.map