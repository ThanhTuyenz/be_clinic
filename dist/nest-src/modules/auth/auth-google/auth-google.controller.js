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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGoogleController = void 0;
const common_1 = require("@nestjs/common");
const constants_1 = require("../../../common/utils/constants");
const auth_providers_enum_1 = require("../auth-local/enums/auth-providers.enum");
const swagger_1 = require("@nestjs/swagger");
const passport_1 = require("@nestjs/passport");
const public_decorator_1 = require("../../../common/decorators/public.decorator");
const skip_permissions_decorator_1 = require("../../permissions/decorators/skip-permissions.decorator");
let AuthGoogleController = class AuthGoogleController {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    async googleLogin() {
    }
    async googleLoginCallback(req) {
        const user = await this.authService.validateSocialLogin(auth_providers_enum_1.AuthProvidersEnum.google, {
            id: req.user.user.id,
            fullName: req.user.user.fullName,
            email: req.user.user.email,
        });
        return user;
    }
};
exports.AuthGoogleController = AuthGoogleController;
__decorate([
    (0, common_1.Get)('google/login'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('google')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthGoogleController.prototype, "googleLogin", null);
__decorate([
    (0, common_1.Get)('google/redirect'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('google')),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthGoogleController.prototype, "googleLoginCallback", null);
exports.AuthGoogleController = AuthGoogleController = __decorate([
    (0, swagger_1.ApiTags)('Auth'),
    (0, public_decorator_1.Public)(),
    (0, skip_permissions_decorator_1.SkipPermissions)(),
    (0, common_1.Controller)(constants_1.Routes.AUTH),
    __param(0, (0, common_1.Inject)(constants_1.Services.AUTH)),
    __metadata("design:paramtypes", [Object])
], AuthGoogleController);
//# sourceMappingURL=auth-google.controller.js.map