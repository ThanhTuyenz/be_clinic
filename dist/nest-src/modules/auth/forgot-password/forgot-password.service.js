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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgotPasswordService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../../../infrastructure/database/prisma/prisma.service.js");
const forgot_password_entity_js_1 = require("./entities/forgot-password.entity.js");
let ForgotPasswordService = class ForgotPasswordService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(data) {
        const userId = data.userId ?? (typeof data.user === 'object' ? data.user?.id : data.user);
        if (!userId || !data.hash)
            throw new Error('Password reset requires userId and hash');
        const row = await this.prisma.passwordResetToken.create({
            data: {
                userId,
                tokenHash: data.hash,
                expiresAt: data.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
            },
            include: { user: true },
        });
        return this.toEntity(row);
    }
    async findOne(options) {
        const hash = options.where?.hash;
        if (!hash)
            return null;
        const row = await this.prisma.passwordResetToken.findFirst({
            where: { tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
            include: { user: true },
        });
        return row ? this.toEntity(row) : null;
    }
    async softDelete(id) {
        await this.prisma.passwordResetToken.updateMany({
            where: { id, consumedAt: null },
            data: { consumedAt: new Date() },
        });
    }
    toEntity(row) {
        return Object.assign(new forgot_password_entity_js_1.ForgotPassword(), {
            id: row.id,
            hash: row.tokenHash,
            userId: row.userId,
            user: row.user ? { ...row.user, role: row.user.role?.toLowerCase(), status: row.user.status?.toLowerCase(), provider: row.user.provider?.toLowerCase() } : row.userId,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            deletedAt: row.consumedAt,
        });
    }
};
exports.ForgotPasswordService = ForgotPasswordService;
exports.ForgotPasswordService = ForgotPasswordService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], ForgotPasswordService);
//# sourceMappingURL=forgot-password.service.js.map