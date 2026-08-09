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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const helpers_js_1 = require("../../../common/utils/helpers.js");
const prisma_service_js_1 = require("../../../infrastructure/database/prisma/prisma.service.js");
const user_entity_js_1 = require("./entities/user.entity.js");
const history_service_js_1 = require("../../history/history.service.js");
const history_js_1 = require("../../history/history.js");
const constants_js_1 = require("../../../common/utils/constants.js");
const permissions_service_js_1 = require("../../permissions/permissions.service.js");
let UsersService = class UsersService {
    prisma;
    historyService;
    rolesService;
    permissionsService;
    constructor(prisma, historyService, rolesService, permissionsService) {
        this.prisma = prisma;
        this.historyService = historyService;
        this.rolesService = rolesService;
        this.permissionsService = permissionsService;
    }
    async createUser(dto) {
        const email = dto.email?.trim().toLowerCase();
        if (!email)
            throw new Error('Email không được gửi tới server.');
        if (await this.prisma.user.findUnique({ where: { email } })) {
            throw new common_1.HttpException('User already exists', common_1.HttpStatus.CONFLICT);
        }
        if (dto.roleId)
            await this.rolesService.findOne(dto.roleId);
        const row = await this.prisma.user.create({
            data: {
                email,
                password: dto.password ? await (0, helpers_js_1.hashPassword)(dto.password) : null,
                fullName: dto.fullName,
                role: this.toPrismaRole(dto.role ?? user_entity_js_1.UserRole.Patient),
                status: this.toPrismaStatus(dto.status ?? user_entity_js_1.UserStatus.Active),
                provider: this.toPrismaProvider(dto.provider ?? 'email'),
                socialId: dto.socialId ?? null,
                roleId: dto.roleId ?? null,
                customPermissions: dto.customPermissions,
                hash: dto.hash ?? null,
                emailOtpHash: dto.emailOtpHash ?? null,
                emailOtpExpiresAt: dto.emailOtpExpiresAt ?? null,
                emailOtpLastSentAt: dto.emailOtpLastSentAt ?? null,
                emailOtpAttempts: dto.emailOtpAttempts ?? 0,
            },
        });
        return this.toEntity(row);
    }
    async findOneUser(options) {
        const where = this.toWhere(options);
        const row = await this.prisma.user.findFirst({ where });
        return row ? this.toEntity(row) : null;
    }
    async findByEmail(email) {
        const row = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        return row ? this.toEntity(row) : null;
    }
    async findUsersWithPagination(options) {
        const where = {
            email: options.email ? { contains: options.email.trim(), mode: 'insensitive' } : undefined,
            fullName: options.name ? { contains: options.name.trim(), mode: 'insensitive' } : undefined,
            isBlocked: options.isBlocked,
            isDeleted: options.isDeleted ?? false,
        };
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.user.findMany({ where, skip: (options.page - 1) * options.limit, take: options.limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.user.count({ where }),
        ]);
        return { data: rows.map((row) => this.toEntity(row)), total };
    }
    async updateUser(id, payload) {
        const existing = await this.findOneUser({ id });
        if (!existing)
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        if (payload.roleId)
            await this.rolesService.findOne(payload.roleId);
        const next = { ...payload };
        if (next.isBlocked === true)
            next.blockedAt = existing.blockedAt ?? new Date();
        if (next.isBlocked === false)
            next.blockedAt = null;
        if (next.isDeleted === true)
            next.status = user_entity_js_1.UserStatus.Inactive;
        const row = await this.prisma.user.update({ where: { id }, data: await this.toUpdateData(next, existing) });
        await this.recordHistory(row, history_js_1.HISTORY_ACTIONS.USER_UPDATED, 'Cập nhật người dùng');
        this.permissionsService.invalidateCache(id);
        return this.toEntity(row);
    }
    async deleteUser(id) {
        const existing = await this.findOneUser({ id });
        if (!existing)
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        const row = await this.prisma.user.update({ where: { id }, data: { isDeleted: true, status: 'INACTIVE' } });
        await this.recordHistory(row, history_js_1.HISTORY_ACTIONS.USER_DELETED, 'Xóa người dùng');
    }
    async saveUser(user) {
        const existing = await this.findOneUser({ id: user.id });
        if (!existing)
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        const row = await this.prisma.user.update({ where: { id: user.id }, data: await this.toUpdateData(user, existing) });
        return this.toEntity(row);
    }
    async assignRole(userId, roleId) {
        await this.rolesService.findOne(roleId);
        return this.updateUser(userId, { roleId });
    }
    async removeRole(userId) {
        return this.updateUser(userId, { roleId: null });
    }
    toWhere(input) {
        return {
            id: input.id,
            email: typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined,
            socialId: input.socialId,
            provider: input.provider ? this.toPrismaProvider(String(input.provider)) : undefined,
            hash: input.hash,
        };
    }
    async toUpdateData(payload, existing) {
        const passwordChanged = payload.password != null && payload.password !== existing.password;
        return {
            email: payload.email === undefined ? undefined : payload.email?.trim().toLowerCase(),
            password: passwordChanged ? await (0, helpers_js_1.hashPassword)(payload.password) : undefined,
            fullName: payload.fullName,
            provider: payload.provider ? this.toPrismaProvider(payload.provider) : undefined,
            status: payload.status ? this.toPrismaStatus(payload.status) : undefined,
            role: payload.role ? this.toPrismaRole(payload.role) : undefined,
            socialId: payload.socialId,
            roleId: payload.roleId,
            customPermissions: payload.customPermissions === null ? client_1.Prisma.JsonNull : payload.customPermissions,
            hash: payload.hash,
            emailOtpHash: payload.emailOtpHash,
            emailOtpExpiresAt: payload.emailOtpExpiresAt,
            emailOtpLastSentAt: payload.emailOtpLastSentAt,
            emailOtpAttempts: payload.emailOtpAttempts,
            isBlocked: payload.isBlocked,
            blockedAt: payload.blockedAt,
            isDeleted: payload.isDeleted,
            lastLoginAt: payload.lastLoginAt,
        };
    }
    toEntity(row) {
        return Object.assign(new user_entity_js_1.User(), row, {
            role: row.role.toLowerCase(),
            status: row.status.toLowerCase(),
            provider: row.provider.toLowerCase(),
            customPermissions: row.customPermissions,
            previousPassword: row.password,
        });
    }
    toPrismaRole(value) { return String(value).toUpperCase(); }
    toPrismaStatus(value) { return String(value).toUpperCase(); }
    toPrismaProvider(value) { return String(value).toUpperCase(); }
    async recordHistory(row, action, prefix) {
        await this.historyService.create({ action, message: `${prefix} ${row.email}`, actorId: row.id, actorEmail: row.email ?? undefined, targetType: 'user', targetId: row.id });
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(constants_js_1.Services.ROLES)),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        history_service_js_1.HistoryService, Object, permissions_service_js_1.PermissionsService])
], UsersService);
//# sourceMappingURL=users.service.js.map