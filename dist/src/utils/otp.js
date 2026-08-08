"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOtp = generateOtp;
const crypto_1 = __importDefault(require("crypto"));
function generateOtp() {
    const n = crypto_1.default.randomInt(0, 1_000_000);
    return String(n).padStart(6, '0');
}
//# sourceMappingURL=otp.js.map