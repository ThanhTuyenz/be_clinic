"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const clinicRoomSchema = new mongoose_1.default.Schema({
    roomID: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    building: { type: String, default: '', trim: true },
    floor: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
}, {
    collection: 'clinicRoom',
    timestamps: true,
});
clinicRoomSchema.index({ isActive: 1, sortOrder: 1 });
exports.default = mongoose_1.default.model('ClinicRoom', clinicRoomSchema);
//# sourceMappingURL=ClinicRoom.js.map