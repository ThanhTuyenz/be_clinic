"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDoctors = listDoctors;
const User_js_1 = __importDefault(require("../models/User.js"));
const Specialty_js_1 = __importDefault(require("../models/Specialty.js"));
const Department_js_1 = __importDefault(require("../models/Department.js"));
const consultationFee_js_1 = require("../constants/consultationFee.js");
const clinicRoomHelper_js_1 = require("../services/clinicRoomHelper.js");
function resolveConsultationFee(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : consultationFee_js_1.DEFAULT_CONSULTATION_FEE;
}
async function listDoctors(_req, res) {
    const doctors = await User_js_1.default.find({ userType: 'doctor', isActive: true }, {
        firstName: 1,
        lastName: 1,
        bio: 1,
        email: 1,
        avatarUrl: 1,
        experienceYears: 1,
        consultationFee: 1,
        specialtyId: 1,
        specialtyID: 1,
        clinicRoomID: 1,
    }).sort({ lastName: 1, firstName: 1 });
    const specialtyIds = Array.from(new Set(doctors
        .map((d) => d.specialtyID ?? d.specialtyId)
        .filter(Boolean)
        .map((id) => String(id))));
    const specialties = specialtyIds.length
        ? await Specialty_js_1.default.find({ specialtyID: { $in: specialtyIds } }, { specialtyName: 1, specialtyID: 1, deptID: 1 }).lean()
        : [];
    const specialtyNameById = new Map(specialties.map((s) => [String(s.specialtyID), s.specialtyName || '']));
    const deptIds = Array.from(new Set(specialties
        .map((s) => String(s?.deptID || '').trim())
        .filter(Boolean)));
    const departments = deptIds.length
        ? await Department_js_1.default.find({ deptID: { $in: deptIds } }, { deptID: 1, deptName: 1 }).lean()
        : [];
    const deptNameById = new Map(departments.map((d) => [String(d.deptID), d.deptName || '']));
    const deptIdBySpecialtyId = new Map(specialties.map((s) => [String(s.specialtyID), String(s?.deptID || '').trim()]));
    const roomIds = doctors.map((d) => d.clinicRoomID).filter(Boolean).map(String);
    const roomMetaMap = await (0, clinicRoomHelper_js_1.getClinicRoomMetaMap)(roomIds);
    const data = doctors.map((d) => {
        const specId = d.specialtyID ?? d.specialtyId;
        const specialtyName = specId ? specialtyNameById.get(String(specId)) || '' : '';
        const deptID = specId ? deptIdBySpecialtyId.get(String(specId)) || '' : '';
        const deptName = deptID ? deptNameById.get(String(deptID)) || '' : '';
        const crId = String(d.clinicRoomID || '').trim();
        const crMeta = crId ? roomMetaMap.get(crId) : null;
        return {
            id: d._id ? String(d._id) : '',
            email: d.email,
            firstName: d.firstName ?? '',
            lastName: d.lastName ?? '',
            displayName: [d.lastName, d.firstName].filter(Boolean).join(' ').trim(),
            bio: d.bio ?? '',
            avatarUrl: d.avatarUrl ?? '',
            experienceYears: d.experienceYears ?? null,
            consultationFee: resolveConsultationFee(d.consultationFee),
            specialtyName,
            specialtyID: specId ? String(specId) : '',
            deptID,
            deptName,
            clinicRoomID: crId,
            clinicRoomName: crMeta ? (0, clinicRoomHelper_js_1.clinicRoomDisplayLabel)(crId, crMeta) : crId,
        };
    });
    return res.json({ doctors: data });
}
//# sourceMappingURL=doctorsController.js.map