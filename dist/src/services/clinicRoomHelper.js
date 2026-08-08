"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClinicRoomMetaMap = getClinicRoomMetaMap;
exports.clinicRoomDisplayLabel = clinicRoomDisplayLabel;
const ClinicRoom_js_1 = __importDefault(require("../models/ClinicRoom.js"));
async function getClinicRoomMetaMap(roomIds) {
    const ids = [
        ...new Set((roomIds || []).filter(Boolean).map((id) => String(id).trim()).filter(Boolean)),
    ];
    if (!ids.length)
        return new Map();
    const rows = await ClinicRoom_js_1.default.find({ roomID: { $in: ids }, isActive: { $ne: false } }, { roomID: 1, name: 1, building: 1, floor: 1 }).lean();
    const map = new Map();
    for (const r of rows || []) {
        map.set(String(r.roomID).trim(), {
            name: String(r.name || '').trim(),
            building: String(r.building || '').trim(),
            floor: String(r.floor || '').trim(),
        });
    }
    return map;
}
function clinicRoomDisplayLabel(roomID, meta) {
    const id = String(roomID || '').trim();
    if (!id)
        return '';
    if (!meta)
        return id;
    const name = String(meta.name || '').trim();
    const bits = [name || id];
    const loc = [meta.building, meta.floor].filter(Boolean).join(', ');
    if (loc)
        bits.push(`(${loc})`);
    return bits.join(' ');
}
//# sourceMappingURL=clinicRoomHelper.js.map