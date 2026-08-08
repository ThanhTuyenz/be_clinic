"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_js_1 = require("./config/db.js");
const authRoutes_js_1 = __importDefault(require("./routes/authRoutes.js"));
const doctorsRoutes_js_1 = __importDefault(require("./routes/doctorsRoutes.js"));
const clinicRoomsRoutes_js_1 = __importDefault(require("./routes/clinicRoomsRoutes.js"));
const appointmentsRoutes_js_1 = __importDefault(require("./routes/appointmentsRoutes.js"));
const examinationsRoutes_js_1 = __importDefault(require("./routes/examinationsRoutes.js"));
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 5000;
const corsOriginRaw = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174';
const corsAllowlist = String(corsOriginRaw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
app.set('etag', false);
app.use((0, cors_1.default)({
    origin(origin, cb) {
        if (!origin)
            return cb(null, true);
        if (corsAllowlist.includes('*'))
            return cb(null, true);
        if (corsAllowlist.includes(origin))
            return cb(null, true);
        return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
}));
app.use(express_1.default.json());
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
});
app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'be_clinic' });
});
app.use('/api/auth', authRoutes_js_1.default);
app.use('/api/doctors', doctorsRoutes_js_1.default);
app.use('/api/clinic-rooms', clinicRoomsRoutes_js_1.default);
app.use('/api/appointments', appointmentsRoutes_js_1.default);
app.use('/api/examinations', examinationsRoutes_js_1.default);
app.use((_req, res) => {
    res.status(404).json({ message: 'Không tìm thấy.' });
});
async function main() {
    try {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
            console.error('Thiếu JWT_SECRET trong .env (cần ít nhất 16 ký tự, dùng để ký token đăng nhập).');
            process.exit(1);
        }
        await (0, db_js_1.connectDb)();
        app.listen(PORT, () => {
            console.log(`API chạy tại http://localhost:${PORT}`);
            console.log(`CORS cho phép: ${corsAllowlist.join(', ')}`);
        });
    }
    catch (err) {
        console.error('Không khởi động được:', err.message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map