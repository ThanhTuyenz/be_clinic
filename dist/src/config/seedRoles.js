"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedRoles = seedRoles;
const Role_js_1 = __importDefault(require("../models/Role.js"));
const DEFAULT_ROLES = [
    { name: 'patient', description: 'Bệnh nhân' },
    { name: 'doctor', description: 'Bác sĩ' },
    { name: 'receptionist', description: 'Lễ tân' },
    { name: 'admin', description: 'Quản trị' },
];
async function seedRoles() {
    for (const r of DEFAULT_ROLES) {
        const exists = await Role_js_1.default.findOne({ name: r.name });
        if (!exists) {
            await Role_js_1.default.create({ name: r.name, description: r.description });
        }
    }
}
//# sourceMappingURL=seedRoles.js.map