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
var JwtAuthGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const constants_1 = require("../../../../common/utils/constants");
const public_decorator_1 = require("../../../../common/decorators/public.decorator");
let JwtAuthGuard = JwtAuthGuard_1 = class JwtAuthGuard {
    reflector;
    jwtService;
    usersService;
    logger = new common_1.Logger(JwtAuthGuard_1.name);
    constructor(reflector, jwtService, usersService) {
        this.reflector = reflector;
        this.jwtService = jwtService;
        this.usersService = usersService;
    }
    async canActivate(context) {
        const isPublic = this.reflector.getAllAndOverride(public_decorator_1.IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            this.logger.log('Public route, skipping authentication');
            return true;
        }
        const request = context.switchToHttp().getRequest();
        let token;
        if (request.cookies?.token) {
            token = request.cookies.token;
            this.logger.log('Token found in cookie');
        }
        else {
            const authHeader = request.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.split(' ')[1];
                this.logger.log('Token found in Authorization header');
            }
            else if (request.query?.token && typeof request.query.token === 'string') {
                token = request.query.token;
                this.logger.log('Token found in query parameter');
            }
        }
        if (!token) {
            this.logger.warn('Không tìm thấy token trong cookie hoặc Authorization header.');
            throw new common_1.UnauthorizedException('Token không hợp lệ hoặc thiếu');
        }
        try {
            const decoded = this.jwtService.verify(token);
            if (!decoded?.id) {
                this.logger.warn('Token thiếu thông tin user id.');
                throw new common_1.UnauthorizedException('Token không hợp lệ hoặc thiếu');
            }
            const requestUser = {
                id: decoded.id,
                sessionId: decoded.sessionId || '',
                email: decoded.email,
                role: decoded.role,
                userType: decoded.role,
            };
            if (!requestUser.email || !requestUser.role) {
                const user = await this.usersService.findOneUser({ id: decoded.id });
                if (!user) {
                    this.logger.warn(`Không tìm thấy user với id=${decoded.id}`);
                    throw new common_1.UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
                }
                if (user.isDeleted) {
                    this.logger.warn(`User đã bị xóa mềm, id=${decoded.id}`);
                    throw new common_1.UnauthorizedException('Tài khoản không tồn tại hoặc đã bị xóa');
                }
                if (user.isBlocked) {
                    this.logger.warn(`User đã bị khóa, id=${decoded.id}`);
                    throw new common_1.UnauthorizedException('Tài khoản đã bị khóa');
                }
                requestUser.email = user.email ?? undefined;
                requestUser.role = user.role ?? undefined;
                requestUser.userType = user.role ?? undefined;
            }
            requestUser.userType ||= requestUser.role;
            request.user = requestUser;
            this.logger.log(`Xác thực thành công: ID ${decoded.id}`);
            return true;
        }
        catch (error) {
            if (error instanceof Error) {
                this.logger.error(`Lỗi xác thực token: ${error.message}`);
            }
            else {
                this.logger.error(`Lỗi xác thực token: Không xác định`);
            }
            throw new common_1.UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
        }
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = JwtAuthGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(constants_1.Services.USERS)),
    __metadata("design:paramtypes", [core_1.Reflector,
        jwt_1.JwtService, Object])
], JwtAuthGuard);
//# sourceMappingURL=jwt-auth.guard.js.map