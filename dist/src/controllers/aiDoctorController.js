"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestDoctorsBySpecialty = suggestDoctorsBySpecialty;
const doctorQuery_js_1 = require("../services/doctorQuery.js");
async function suggestDoctorsBySpecialty(req, res) {
    try {
        const chuyenKhoa = String(req.body?.chuyen_khoa ?? req.query?.chuyen_khoa ?? '').trim();
        if (!chuyenKhoa) {
            res.status(400).json({
                message: 'Thiếu chuyen_khoa.',
                code: 'MISSING_SPECIALTY',
            });
            return;
        }
        const doctors = await (0, doctorQuery_js_1.findTopAvailableDoctorsBySpecialty)(chuyenKhoa, 3);
        res.json({
            ok: true,
            chuyen_khoa: chuyenKhoa,
            doctors,
        });
    }
    catch (e) {
        console.error(e);
        const code = String(e?.code || '').trim();
        if (code === 'MONGODB_URI_MISSING') {
            res.status(500).json({ message: e.message, code });
            return;
        }
        res.status(503).json({
            message: e?.message || 'Không truy vấn được danh sách bác sĩ.',
        });
    }
}
//# sourceMappingURL=aiDoctorController.js.map