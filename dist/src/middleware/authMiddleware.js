"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function jwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 16) {
        throw new Error('JWT_SECRET trong .env cần ít nhất 16 ký tự.');
    }
    return s;
}
function requireAuth(req, res, next) {
    try {
        const header = req.headers.authorization;
        if (!header || typeof header !== 'string') {
            return res.status(401).json({ message: 'Thiếu Authorization header.' });
        }
        const [scheme, token] = header.split(' ');
        if (scheme !== 'Bearer' || !token) {
            return res.status(401).json({ message: 'Authorization header không hợp lệ.' });
        }
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret());
        if (!decoded?.sub) {
            return res.status(401).json({ message: 'Token không hợp lệ.' });
        }
        req.user = {
            id: decoded.sub,
            userType: decoded.userType,
            role: decoded.role,
        };
        return next();
    }
    catch {
        return res.status(401).json({ message: 'Token hết hạn hoặc không hợp lệ.' });
    }
}
//# sourceMappingURL=authMiddleware.js.map