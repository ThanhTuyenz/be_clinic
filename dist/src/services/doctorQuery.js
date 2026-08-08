"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSpecialtyFlexibleRegex = buildSpecialtyFlexibleRegex;
exports.findTopAvailableDoctorsBySpecialty = findTopAvailableDoctorsBySpecialty;
const mongoose_1 = __importDefault(require("mongoose"));
const Doctor_js_1 = __importDefault(require("../models/Doctor.js"));
const VN_DIACRITIC_GROUPS = {
    a: '[aAàáảãạăằắẳẵặâầấẩẫậ]',
    d: '[dDđ]',
    e: '[eEèéẻẽẹêềếểễệ]',
    i: '[iIìíỉĩị]',
    o: '[oOòóỏõọôồốổỗộơờớởỡợ]',
    u: '[uUùúủũụưừứửữự]',
    y: '[yYỳýỷỹỵ]',
};
let connectPromise = null;
function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function foldVietnameseBase(ch) {
    const folded = String(ch || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    return folded === 'đ' ? 'd' : folded;
}
function buildSpecialtyFlexibleRegex(chuyenKhoa) {
    const raw = String(chuyenKhoa || '').trim();
    if (!raw)
        return null;
    let pattern = '';
    for (const ch of raw) {
        if (/\s/.test(ch)) {
            pattern += '\\s+';
            continue;
        }
        const base = foldVietnameseBase(ch);
        if (VN_DIACRITIC_GROUPS[base]) {
            pattern += VN_DIACRITIC_GROUPS[base];
        }
        else if (/[a-z]/i.test(ch)) {
            pattern += `[${base.toUpperCase()}${base}]`;
        }
        else {
            pattern += escapeRegExp(ch);
        }
    }
    return new RegExp(`^${pattern}$`, 'i');
}
async function ensureMongoose() {
    if (mongoose_1.default.connection.readyState === 1)
        return;
    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri) {
        const err = new Error('Thiếu MONGODB_URI trong .env.');
        err.code = 'MONGODB_URI_MISSING';
        throw err;
    }
    if (!connectPromise) {
        const dbName = String(process.env.MONGO_DB_NAME || 'clinic').trim();
        connectPromise = mongoose_1.default.connect(uri, { dbName });
    }
    await connectPromise;
}
function mapDoctorForFrontend(doc) {
    return {
        id: String(doc._id),
        name: String(doc.name || '').trim(),
        specialty: String(doc.specialty || '').trim(),
        avatar_url: String(doc.avatar_url || '').trim(),
        rating: Number(doc.rating) || 0,
        is_available: doc.is_available !== false,
    };
}
async function findTopAvailableDoctorsBySpecialty(chuyenKhoa, limit = 3) {
    const specialty = String(chuyenKhoa || '').trim();
    if (!specialty)
        return [];
    const specialtyRegex = buildSpecialtyFlexibleRegex(specialty);
    if (!specialtyRegex)
        return [];
    await ensureMongoose();
    const rows = await Doctor_js_1.default.find({
        is_available: true,
        specialty: { $regex: specialtyRegex },
    })
        .sort({ rating: -1 })
        .limit(Math.max(1, Number(limit) || 3))
        .select('name specialty avatar_url rating is_available')
        .lean();
    return rows.map(mapDoctorForFrontend);
}
//# sourceMappingURL=doctorQuery.js.map