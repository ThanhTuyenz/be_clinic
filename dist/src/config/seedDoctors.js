"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDoctors = seedDoctors;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const Role_js_1 = __importDefault(require("../models/Role.js"));
const User_js_1 = __importDefault(require("../models/User.js"));
const DEFAULT_DOCTORS = [
    {
        firstName: 'Văn',
        lastName: 'Nguyễn',
        email: 'dr.nguyen@clinicabc.vn',
        phone: '0901002003',
        bio: 'Bác sĩ Nội tổng quát — kinh nghiệm 10 năm.',
        consultationFee: 150_000,
    },
    {
        firstName: 'Quang',
        lastName: 'Trần',
        email: 'dr.tran@clinicabc.vn',
        phone: '0901002004',
        bio: 'Bác sĩ Ngoại — chuyên về khám ngoại trú.',
        consultationFee: 150_000,
    },
    {
        firstName: 'Minh',
        lastName: 'Lê',
        email: 'dr.le@clinicabc.vn',
        phone: '0901002005',
        bio: 'Bác sĩ Da liễu — điều trị các vấn đề da thường gặp.',
        consultationFee: 150_000,
    },
];
const DEFAULT_PASSWORD = '12345678';
async function seedDoctors() {
    const role = await Role_js_1.default.findOne({ name: 'doctor' });
    if (!role)
        return;
    const existing = await User_js_1.default.find({ userType: 'doctor' }).select('email phone');
    const existsByEmail = new Set(existing.map((u) => String(u.email).toLowerCase()));
    const existsByPhone = new Set(existing.map((u) => String(u.phone).trim()));
    for (const d of DEFAULT_DOCTORS) {
        const emailLower = d.email.toLowerCase();
        if (existsByEmail.has(emailLower) || existsByPhone.has(d.phone))
            continue;
        const passwordHash = await bcryptjs_1.default.hash(DEFAULT_PASSWORD, 10);
        await User_js_1.default.create({
            email: emailLower,
            passwordHash,
            roleId: role._id,
            userType: 'doctor',
            isActive: true,
            emailVerified: true,
            firstName: d.firstName,
            lastName: d.lastName,
            phone: d.phone,
            bio: d.bio,
            consultationFee: d.consultationFee ?? null,
        });
    }
}
//# sourceMappingURL=seedDoctors.js.map