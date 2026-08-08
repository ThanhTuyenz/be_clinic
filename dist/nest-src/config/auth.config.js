"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttlToMilliseconds = ttlToMilliseconds;
const config_1 = require("@nestjs/config");
const class_validator_1 = require("class-validator");
const validate_config_js_1 = __importDefault(require("../common/utils/validate-config.js"));
class EnvironmentVariablesValidator {
    AUTH_JWT_SECRET;
    AUTH_JWT_TOKEN_EXPIRES_IN;
    AUTH_JWT_REFRESH_SECRET;
    AUTH_JWT_REFRESH_TOKEN_EXPIRES_IN;
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "AUTH_JWT_SECRET", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "AUTH_JWT_TOKEN_EXPIRES_IN", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "AUTH_JWT_REFRESH_SECRET", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "AUTH_JWT_REFRESH_TOKEN_EXPIRES_IN", void 0);
const TTL_UNITS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};
function ttlToMilliseconds(value) {
    const match = value.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) {
        const num = Number(value);
        if (!Number.isNaN(num)) {
            return num * 1000;
        }
        throw new Error(`Invalid TTL format "${value}". Expected formats like "15m", "7d", or seconds.`);
    }
    const [, amount, unit] = match;
    return Number(amount) * TTL_UNITS[unit.toLowerCase()];
}
exports.default = (0, config_1.registerAs)('auth', () => {
    (0, validate_config_js_1.default)(process.env, EnvironmentVariablesValidator);
    return {
        secret: process.env.AUTH_JWT_SECRET,
        expires: process.env.AUTH_JWT_TOKEN_EXPIRES_IN,
        refreshSecret: process.env.AUTH_JWT_REFRESH_SECRET,
        refreshExpires: process.env.AUTH_JWT_REFRESH_TOKEN_EXPIRES_IN,
    };
});
//# sourceMappingURL=auth.config.js.map