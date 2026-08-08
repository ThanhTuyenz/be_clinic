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
const config_1 = require("@nestjs/config");
const class_validator_1 = require("class-validator");
const validate_config_js_1 = __importDefault(require("../common/utils/validate-config.js"));
class EnvironmentVariablesValidator {
    MAILER_PORT;
    MAILER_HOST;
    MAILER_USER;
    MAILER_PASSWORD;
    MAILER_DEFAULT_EMAIL;
    MAILER_DEFAULT_NAME;
    MAILER_IGNORE_TLS;
    MAILER_SECURE;
    MAILER_REQUIRE_TLS;
}
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(65535),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], EnvironmentVariablesValidator.prototype, "MAILER_PORT", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "MAILER_HOST", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "MAILER_USER", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "MAILER_PASSWORD", void 0);
__decorate([
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "MAILER_DEFAULT_EMAIL", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], EnvironmentVariablesValidator.prototype, "MAILER_DEFAULT_NAME", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EnvironmentVariablesValidator.prototype, "MAILER_IGNORE_TLS", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EnvironmentVariablesValidator.prototype, "MAILER_SECURE", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], EnvironmentVariablesValidator.prototype, "MAILER_REQUIRE_TLS", void 0);
exports.default = (0, config_1.registerAs)('mailer', () => {
    (0, validate_config_js_1.default)(process.env, EnvironmentVariablesValidator);
    return {
        port: process.env.MAILER_PORT ? parseInt(process.env.MAILER_PORT, 10) : 587,
        host: process.env.MAILER_HOST,
        user: process.env.MAILER_USER,
        password: process.env.MAILER_PASSWORD,
        defaultEmail: process.env.MAILER_DEFAULT_EMAIL,
        defaultName: process.env.MAILER_DEFAULT_NAME,
        ignoreTLS: process.env.MAILER_IGNORE_TLS === 'true',
        secure: process.env.MAILER_SECURE === 'true',
        requireTLS: process.env.MAILER_REQUIRE_TLS === 'true',
    };
});
//# sourceMappingURL=mailer.config.js.map