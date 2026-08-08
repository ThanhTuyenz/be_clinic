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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const constants_1 = require("../../../common/utils/constants");
const auth_providers_enum_1 = require("./enums/auth-providers.enum");
const crypto_1 = require("crypto");
const auth_config_1 = require("../../../config/auth.config");
const user_entity_1 = require("../users/entities/user.entity");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const random_string_generator_util_1 = require("@nestjs/common/utils/random-string-generator.util");
const helpers_1 = require("../../../common/utils/helpers");
const history_service_1 = require("../../history/history.service");
const history_1 = require("../../history/history");
let AuthService = AuthService_1 = class AuthService {
    usersService;
    mailsService;
    sessionService;
    forgotPasswordService;
    historyService;
    configService;
    jwtService;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(usersService, mailsService, sessionService, forgotPasswordService, historyService, configService, jwtService) {
        this.usersService = usersService;
        this.mailsService = mailsService;
        this.sessionService = sessionService;
        this.forgotPasswordService = forgotPasswordService;
        this.historyService = historyService;
        this.configService = configService;
        this.jwtService = jwtService;
    }
    async checkEmail(email) {
        const user = await this.usersService.findByEmail(email);
        return !user;
    }
    async validateLogin(loginDto) {
        const user = await this.usersService.findOneUser({
            email: loginDto.email,
        });
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    email: 'notFound',
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const authProvider = user.provider ?? auth_providers_enum_1.AuthProvidersEnum.email;
        if (authProvider !== auth_providers_enum_1.AuthProvidersEnum.email) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    email: `needLoginViaProvider:${authProvider}`,
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (user.status !== user_entity_1.UserStatus.Active) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    email: 'inactive',
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (user.isDeleted) {
            throw new common_1.UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
        }
        if (user.isBlocked) {
            throw new common_1.UnauthorizedException('Tài khoản đã bị khóa');
        }
        const isValidPassword = await (0, helpers_1.compareHash)(loginDto.password, user.password);
        if (!isValidPassword) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    password: 'incorrectPassword',
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        user.lastLoginAt = new Date();
        await this.usersService.saveUser(user);
        const session = await this.sessionService.create({
            user,
        });
        const { token, refreshToken, tokenExpires } = await this.getTokensData({
            id: user.id,
            sessionId: session.id,
        });
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_LOGIN_SUCCESS,
            message: `Người dùng đăng nhập thành công`,
            actorId: user.id,
            actorEmail: user.email ?? undefined,
            targetType: 'user',
            targetId: user.id,
        });
        return {
            refreshToken,
            token,
            tokenExpires,
            user,
        };
    }
    async validateSocialLogin(authProvider, socialData) {
        let user;
        const socialEmail = socialData.email?.toLowerCase();
        const userByEmail = await this.usersService.findOneUser({
            email: socialEmail,
        });
        user = await this.usersService.findOneUser({
            socialId: socialData.id,
            provider: authProvider,
        });
        if (user) {
            if (socialEmail && !userByEmail) {
                user.email = socialEmail;
            }
            await this.usersService.saveUser(user);
        }
        else if (userByEmail) {
            user = userByEmail;
        }
        else {
            user = await this.usersService.createUser({
                email: socialEmail ?? null,
                fullName: socialData.fullName ?? null,
                socialId: socialData.id,
                provider: authProvider,
                status: user_entity_1.UserStatus.Active,
            });
            user = await this.usersService.findOneUser({
                id: user.id,
            });
        }
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    user: 'userNotFound',
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        if (user.isDeleted) {
            throw new common_1.UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
        }
        if (user.isBlocked) {
            throw new common_1.UnauthorizedException('Tài khoản đã bị khóa');
        }
        const session = await this.sessionService.create({
            user,
        });
        user.lastLoginAt = new Date();
        await this.usersService.saveUser(user);
        const { token: jwtToken, refreshToken, tokenExpires, } = await this.getTokensData({
            id: user.id,
            sessionId: session.id,
        });
        return {
            refreshToken,
            token: jwtToken,
            tokenExpires,
            user,
        };
    }
    async registerUser(registerDto) {
        const existingUser = await this.usersService.findOneUser({
            email: registerDto.email,
        });
        if (existingUser?.status === user_entity_1.UserStatus.Active) {
            throw new common_1.HttpException('User already exists', common_1.HttpStatus.CONFLICT);
        }
        const otp = this.generateOtp();
        const otpData = this.createOtpData(otp);
        if (existingUser) {
            existingUser.password = registerDto.password;
            existingUser.fullName = registerDto.fullName;
            existingUser.role = user_entity_1.UserRole.Patient;
            existingUser.status = user_entity_1.UserStatus.Inactive;
            Object.assign(existingUser, otpData);
            await this.usersService.saveUser(existingUser);
        }
        else {
            await this.usersService.createUser({
                ...registerDto,
                email: registerDto.email,
                status: user_entity_1.UserStatus.Inactive,
                role: user_entity_1.UserRole.Patient,
                ...otpData,
            });
        }
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_REGISTERED,
            message: `Đăng ký tài khoản mới`,
            actorEmail: registerDto.email,
            targetType: 'user',
            targetId: registerDto.email,
        });
        await this.mailsService.confirmRegisterUser({
            to: registerDto.email,
            data: { otp, user: registerDto.fullName, expiresInMinutes: 10 },
        });
    }
    async verifyRegistrationOtp(email, otp) {
        const user = await this.usersService.findOneUser({ email });
        if (!user || user.status === user_entity_1.UserStatus.Active) {
            throw new common_1.HttpException('OTP không hợp lệ', common_1.HttpStatus.BAD_REQUEST);
        }
        if (!user.emailOtpHash || !user.emailOtpExpiresAt) {
            throw new common_1.HttpException('OTP không tồn tại', common_1.HttpStatus.BAD_REQUEST);
        }
        if (user.emailOtpExpiresAt.getTime() < Date.now()) {
            throw new common_1.HttpException('OTP đã hết hạn', common_1.HttpStatus.BAD_REQUEST);
        }
        if ((user.emailOtpAttempts || 0) >= 5) {
            throw new common_1.HttpException('OTP đã bị khóa do nhập sai quá nhiều lần. Vui lòng gửi lại OTP.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        const suppliedHash = this.hashOtp(otp);
        const expected = Buffer.from(user.emailOtpHash, 'hex');
        const supplied = Buffer.from(suppliedHash, 'hex');
        if (expected.length !== supplied.length || !(0, crypto_1.timingSafeEqual)(expected, supplied)) {
            user.emailOtpAttempts = (user.emailOtpAttempts || 0) + 1;
            await this.usersService.saveUser(user);
            throw new common_1.HttpException('OTP không chính xác', common_1.HttpStatus.BAD_REQUEST);
        }
        user.status = user_entity_1.UserStatus.Active;
        user.emailOtpHash = null;
        user.emailOtpExpiresAt = null;
        user.emailOtpLastSentAt = null;
        user.emailOtpAttempts = 0;
        await this.usersService.saveUser(user);
    }
    async resendRegistrationOtp(email) {
        const user = await this.usersService.findOneUser({ email });
        if (!user) {
            throw new common_1.HttpException('Không tìm thấy tài khoản', common_1.HttpStatus.NOT_FOUND);
        }
        if (user.status === user_entity_1.UserStatus.Active) {
            throw new common_1.HttpException('Email đã được xác thực', common_1.HttpStatus.CONFLICT);
        }
        if (user.emailOtpLastSentAt &&
            Date.now() - user.emailOtpLastSentAt.getTime() < 60_000) {
            throw new common_1.HttpException('Vui lòng chờ 60 giây trước khi gửi lại OTP', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        const otp = this.generateOtp();
        Object.assign(user, this.createOtpData(otp));
        await this.usersService.saveUser(user);
        await this.mailsService.confirmRegisterUser({
            to: email,
            data: { otp, user: user.fullName ?? undefined, expiresInMinutes: 10 },
        });
    }
    async status(userJwtPayload) {
        const user = await this.usersService.findOneUser({
            id: userJwtPayload.id,
        });
        if (!user) {
            throw new common_1.UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
        }
        if (user.isDeleted) {
            throw new common_1.UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
        }
        if (user.isBlocked) {
            throw new common_1.UnauthorizedException('Tài khoản đã bị khóa');
        }
        return user;
    }
    async confirmEmail(hash) {
        const user = await this.usersService.findOneUser({
            hash,
        });
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.NOT_FOUND,
                error: `notFound`,
            }, common_1.HttpStatus.NOT_FOUND);
        }
        user.hash = null;
        user.status = user_entity_1.UserStatus.Active;
        await this.usersService.saveUser(user);
    }
    async forgotPassword(email) {
        const user = await this.usersService.findOneUser({
            email,
        });
        if (!user) {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    email: 'emailNotExists',
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const hash = (0, crypto_1.createHash)('sha256')
            .update((0, random_string_generator_util_1.randomStringGenerator)())
            .digest('hex');
        await this.forgotPasswordService.create({
            hash,
            user,
            userId: user.id,
        });
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_FORGOT_PASSWORD_REQUESTED,
            message: `Yêu cầu quên mật khẩu`,
            actorId: user.id,
            actorEmail: user.email ?? undefined,
            targetType: 'user',
            targetId: user.id,
        });
        await this.mailsService.forgotPassword({
            to: email,
            data: {
                hash,
                user: user.fullName ?? user.email ?? 'User',
            },
        });
    }
    async resetPassword(hash, password) {
        this.logger.log(`Reset password requested, hash=${hash ? `${hash.slice(0, 8)}...` : 'missing'}, passwordLength=${password?.length ?? 0}`);
        const forgotReq = await this.forgotPasswordService.findOne({
            where: {
                hash,
            },
        });
        if (!forgotReq) {
            this.logger.warn(`Reset password failed: forgot request not found for hash=${hash ? `${hash.slice(0, 8)}...` : 'missing'}`);
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    hash: `notFound`,
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const forgotReqWithRawUser = forgotReq;
        const userIdFromRelation = this.resolveUserIdFromUnknown(forgotReqWithRawUser.user);
        const userIdFromPrimitive = typeof forgotReqWithRawUser.user === 'string'
            ? forgotReqWithRawUser.user
            : undefined;
        const userId = userIdFromRelation ??
            userIdFromPrimitive ??
            forgotReqWithRawUser.userId ??
            undefined;
        if (!userId) {
            this.logger.warn(`Reset password failed: missing user reference in forgot request id=${forgotReq.id}`);
        }
        const userSnapshot = forgotReqWithRawUser.user && typeof forgotReqWithRawUser.user === 'object'
            ? forgotReqWithRawUser.user
            : undefined;
        const user = userId
            ? await this.usersService.findOneUser({
                id: userId,
            })
            : userSnapshot?.email
                ? await this.usersService.findOneUser({
                    email: userSnapshot.email,
                })
                : null;
        if (!user) {
            this.logger.warn(`Reset password failed: user not found for userId=${userId}, forgotRequestId=${forgotReq.id}`);
            throw new common_1.HttpException({
                status: common_1.HttpStatus.UNPROCESSABLE_ENTITY,
                errors: {
                    hash: `notFound`,
                },
            }, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        this.logger.log(`Reset password updating userId=${user.id}, forgotRequestId=${forgotReq.id}`);
        user.password = password;
        await this.sessionService.softDelete({
            user: {
                id: user.id,
            },
        });
        await this.usersService.saveUser(user);
        await this.forgotPasswordService.softDelete(forgotReq.id);
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_RESET_PASSWORD_SUCCESS,
            message: `Đặt lại mật khẩu thành công`,
            actorId: user.id,
            actorEmail: user.email ?? undefined,
            targetType: 'user',
            targetId: user.id,
        });
        this.logger.log(`Reset password succeeded for userId=${user.id}, forgotRequestId=${forgotReq.id}`);
    }
    async refreshToken(data) {
        this.logger.log(`Refreshing token for sessionId=${data.sessionId ?? 'missing'}`);
        const session = await this.sessionService.findOne({
            where: {
                id: data.sessionId,
            },
        });
        if (!session) {
            this.logger.warn(`Refresh failed: session not found for sessionId=${data.sessionId ?? 'missing'}`);
            throw new common_1.UnauthorizedException();
        }
        const sessionWithRawUser = session;
        const userIdFromRelation = typeof sessionWithRawUser.user === 'object' &&
            sessionWithRawUser.user !== null
            ? sessionWithRawUser.user.id
            : undefined;
        const userIdFromPrimitive = typeof sessionWithRawUser.user === 'string'
            ? sessionWithRawUser.user
            : undefined;
        const userId = userIdFromRelation ??
            userIdFromPrimitive ??
            data.id ??
            sessionWithRawUser.userId ??
            undefined;
        if (!userId) {
            this.logger.warn(`Refresh failed: missing user reference for sessionId=${session.id}`);
            throw new common_1.UnauthorizedException();
        }
        const user = await this.usersService.findOneUser({ id: userId });
        if (!user) {
            this.logger.warn(`Refresh failed: user not found for userId=${userId}, sessionId=${session.id}`);
            throw new common_1.UnauthorizedException();
        }
        if (user.isDeleted) {
            this.logger.warn(`Refresh failed: user deleted for userId=${userId}, sessionId=${session.id}`);
            throw new common_1.UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
        }
        if (user.isBlocked) {
            this.logger.warn(`Refresh failed: user blocked for userId=${userId}, sessionId=${session.id}`);
            throw new common_1.UnauthorizedException('Tài khoản đã bị khóa');
        }
        const { token, refreshToken, tokenExpires } = await this.getTokensData({
            id: userId,
            sessionId: session.id,
        });
        this.logger.log(`Refresh succeeded for userId=${userId}, sessionId=${session.id}, tokenExpires=${tokenExpires}`);
        return {
            token,
            refreshToken,
            tokenExpires,
        };
    }
    async refreshTokenFromCookie(refreshToken) {
        try {
            const payload = await this.jwtService.verifyAsync(refreshToken, {
                secret: this.configService.getOrThrow('auth.refreshSecret', {
                    infer: true,
                }),
            });
            return this.refreshToken({
                sessionId: payload.sessionId,
                id: payload.id,
            });
        }
        catch (error) {
            this.logger.warn('Refresh token verification failed from cookie', error);
            throw new common_1.UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
        }
    }
    async logout(data) {
        return this.sessionService.softDelete({
            id: data.sessionId,
        });
    }
    async getTokensData(data) {
        const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
            infer: true,
        });
        const tokenExpires = Date.now() + this.parseDurationToMs(tokenExpiresIn);
        const [token, refreshToken] = await Promise.all([
            await this.jwtService.signAsync({
                id: data.id,
                sessionId: data.sessionId,
            }, {
                secret: this.configService.getOrThrow('auth.secret', {
                    infer: true,
                }),
                expiresIn: tokenExpiresIn,
            }),
            await this.jwtService.signAsync({
                id: data.id,
                sessionId: data.sessionId,
            }, {
                secret: this.configService.getOrThrow('auth.refreshSecret', {
                    infer: true,
                }),
                expiresIn: this.configService.getOrThrow('auth.refreshExpires', {
                    infer: true,
                }),
            }),
        ]);
        return {
            token,
            refreshToken,
            tokenExpires,
        };
    }
    generateOtp() {
        return (0, crypto_1.randomInt)(0, 1_000_000).toString().padStart(6, '0');
    }
    hashOtp(otp) {
        return (0, crypto_1.createHash)('sha256').update(otp).digest('hex');
    }
    createOtpData(otp) {
        const now = new Date();
        return {
            emailOtpHash: this.hashOtp(otp),
            emailOtpExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
            emailOtpLastSentAt: now,
            emailOtpAttempts: 0,
        };
    }
    parseDurationToMs(duration) {
        try {
            return (0, auth_config_1.ttlToMilliseconds)(duration);
        }
        catch {
            throw new common_1.HttpException({
                status: common_1.HttpStatus.INTERNAL_SERVER_ERROR,
                errors: {
                    auth: `invalidTokenExpires:${duration}`,
                },
            }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    resolveUserIdFromUnknown(userValue) {
        if (!userValue) {
            return undefined;
        }
        if (typeof userValue === 'string') {
            return userValue;
        }
        if (typeof userValue !== 'object') {
            return undefined;
        }
        const userRecord = userValue;
        if (typeof userRecord.id === 'string' && userRecord.id.length > 0) {
            return userRecord.id;
        }
        if (typeof userRecord._id === 'string' && userRecord._id.length > 0) {
            return userRecord._id;
        }
        if (userRecord._id &&
            typeof userRecord._id === 'object' &&
            '$oid' in userRecord._id) {
            const mongoOid = userRecord._id;
            if (typeof mongoOid.$oid === 'string' && mongoOid.$oid.length > 0) {
                return mongoOid.$oid;
            }
        }
        if (userRecord._id &&
            typeof userRecord._id === 'object' &&
            'toString' in userRecord._id) {
            const mongoObjectId = userRecord._id;
            const rawObjectId = mongoObjectId.toString?.();
            if (rawObjectId &&
                rawObjectId !== '[object Object]' &&
                rawObjectId.length > 0) {
                return rawObjectId;
            }
        }
        return undefined;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(constants_1.Services.USERS)),
    __param(1, (0, common_1.Inject)(constants_1.Services.MAILS)),
    __param(2, (0, common_1.Inject)(constants_1.Services.SESSION)),
    __param(3, (0, common_1.Inject)(constants_1.Services.FORGOT_PASSWORD)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, history_service_1.HistoryService,
        config_1.ConfigService,
        jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map