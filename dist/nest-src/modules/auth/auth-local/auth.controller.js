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
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const constants_1 = require("../../../common/utils/constants");
const public_decorator_1 = require("../../../common/decorators/public.decorator");
const auth_email_login_dto_1 = require("./dtos/auth-email-login.dto");
const auth_register_dto_1 = require("./dtos/auth-register.dto");
const auth_confirm_email_dto_1 = require("./dtos/auth-confirm-email.dto");
const passport_1 = require("@nestjs/passport");
const auth_forgot_password_dto_1 = require("./dtos/auth-forgot-password.dto");
const auth_reset_password_dto_1 = require("./dtos/auth-reset-password.dto");
const swagger_1 = require("@nestjs/swagger");
const skip_permissions_decorator_1 = require("../../permissions/decorators/skip-permissions.decorator");
const config_1 = require("@nestjs/config");
const auth_config_1 = require("../../../config/auth.config");
const auth_verify_otp_dto_1 = require("./dtos/auth-verify-otp.dto");
let AuthController = AuthController_1 = class AuthController {
    authService;
    configService;
    logger = new common_1.Logger(AuthController_1.name);
    constructor(authService, configService) {
        this.authService = authService;
        this.configService = configService;
    }
    getCookieMaxAge(durationKey) {
        const duration = this.configService.getOrThrow(durationKey, {
            infer: true,
        });
        try {
            return (0, auth_config_1.ttlToMilliseconds)(duration);
        }
        catch {
            throw new common_1.HttpException('Invalid auth cookie expiration duration', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async checkEmail(email) {
        if (!email) {
            throw new common_1.BadRequestException('Email không được để trống');
        }
        const isValid = await this.authService.checkEmail(email);
        return { isValid };
    }
    async login(loginDto, res) {
        const response = await this.authService.validateLogin(loginDto);
        const isProduction = process.env.NODE_ENV === 'production';
        const cookieOptions = {
            httpOnly: true,
            secure: isProduction,
            sameSite: false,
            path: '/',
        };
        const tokenMaxAge = this.getCookieMaxAge('auth.expires');
        const refreshTokenMaxAge = this.getCookieMaxAge('auth.refreshExpires');
        res.cookie('token', response.token, {
            ...cookieOptions,
            maxAge: tokenMaxAge,
        });
        res.cookie('refreshToken', response.refreshToken, {
            ...cookieOptions,
            maxAge: refreshTokenMaxAge,
        });
        return response;
    }
    async register(createUserDto) {
        return await this.authService.registerUser(createUserDto);
    }
    verifyOtp(dto) {
        return this.authService.verifyRegistrationOtp(dto.email, dto.otp);
    }
    resendOtp(dto) {
        return this.authService.resendRegistrationOtp(dto.email);
    }
    async confirmEmail(confirmEmailDto) {
        return this.authService.confirmEmail(confirmEmailDto.hash);
    }
    async confirmEmailByHash(hash) {
        if (!hash) {
            throw new common_1.BadRequestException('Hash không được để trống');
        }
        return this.authService.confirmEmail(hash);
    }
    status(request) {
        return this.authService.status(request.user);
    }
    async forgotPassword(forgotPasswordDto) {
        return this.authService.forgotPassword(forgotPasswordDto.email);
    }
    resetPassword(resetPasswordDto) {
        return this.authService.resetPassword(resetPasswordDto.hash, resetPasswordDto.password);
    }
    async refresh(req, res, bodyRefreshToken) {
        let refreshToken = req.cookies?.refreshToken;
        if (!refreshToken && bodyRefreshToken) {
            refreshToken = bodyRefreshToken;
        }
        if (!refreshToken) {
            throw new common_1.UnauthorizedException('Refresh token không tồn tại');
        }
        this.logger.log('Refresh request accepted');
        const response = await this.authService.refreshTokenFromCookie(refreshToken);
        this.logger.log(`Refresh response issued, hasToken=${Boolean(response.token)}, hasRefreshToken=${Boolean(response.refreshToken)}`);
        const isProduction = process.env.NODE_ENV === 'production';
        const tokenMaxAge = this.getCookieMaxAge('auth.expires');
        const refreshCookieOptions = {
            httpOnly: true,
            secure: isProduction,
            sameSite: false,
            maxAge: tokenMaxAge,
            path: '/',
        };
        res.cookie('token', response.token, refreshCookieOptions);
        return {
            token: response.token,
            tokenExpires: response.tokenExpires,
            refreshToken: response.refreshToken,
        };
    }
    async logout(request, res) {
        await this.authService.logout({
            sessionId: request.user.sessionId,
        });
        const isProduction = process.env.NODE_ENV === 'production';
        const cookieOptions = {
            httpOnly: true,
            secure: isProduction,
            sameSite: false,
            path: '/',
        };
        res.clearCookie('token', cookieOptions);
        res.clearCookie('refreshToken', cookieOptions);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Get)('check-email'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Query)('email')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "checkEmail", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_email_login_dto_1.AuthEmailLoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('register'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Đăng ký và gửi OTP xác thực email' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_register_dto_1.AuthRegisterDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('verify-otp'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Xác thực OTP và kích hoạt tài khoản' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_verify_otp_dto_1.AuthVerifyOtpDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verifyOtp", null);
__decorate([
    (0, common_1.Post)('resend-otp'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiOperation)({ summary: 'Gửi lại OTP xác thực email' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_verify_otp_dto_1.AuthResendOtpDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resendOtp", null);
__decorate([
    (0, common_1.Post)('confirm-email'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_confirm_email_dto_1.AuthConfirmEmailDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "confirmEmail", null);
__decorate([
    (0, common_1.Get)('confirm-email'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Query)('hash')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "confirmEmailByHash", null);
__decorate([
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.Get)('status'),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)('jwt')),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('forgot-password'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_forgot_password_dto_1.AuthForgotPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "forgotPassword", null);
__decorate([
    (0, common_1.Post)('reset-password'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_reset_password_dto_1.AuthResetPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)('refreshToken')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.Post)('logout'),
    (0, skip_permissions_decorator_1.SkipPermissions)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, swagger_1.ApiTags)('Auth'),
    (0, skip_permissions_decorator_1.SkipPermissions)(),
    (0, common_1.Controller)(constants_1.Routes.AUTH),
    __param(0, (0, common_1.Inject)(constants_1.Services.AUTH)),
    __metadata("design:paramtypes", [Object, config_1.ConfigService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map