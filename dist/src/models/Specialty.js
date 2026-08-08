"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const specialtySchema = new mongoose_1.default.Schema({
    specialtyID: { type: String },
    specialtyName: { type: String },
    description: { type: String },
    deptID: { type: String },
}, {
    collection: 'specialties',
    timestamps: true,
});
exports.default = mongoose_1.default.model('Specialty', specialtySchema);
//# sourceMappingURL=Specialty.js.map