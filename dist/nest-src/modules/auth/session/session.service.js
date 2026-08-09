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
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../../../infrastructure/database/prisma/prisma.service.js");
const session_entity_js_1 = require("./entities/session.entity.js");
const user_entity_js_1 = require("../users/entities/user.entity.js");
let SessionService = class SessionService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findOne(options) {
        const where = this.toWhere((options.where ?? {}));
        const row = await this.prisma.session.findFirst({ where, include: { user: true } });
        return row && !row.deletedAt ? this.toEntity(row) : null;
    }
    async findMany(options) {
        const rows = await this.prisma.session.findMany({
            where: { ...this.toWhere((options.where ?? {})), deletedAt: null },
            include: { user: true },
        });
        return rows.map((row) => this.toEntity(row));
    }
    async create(data) {
        const userId = data.user?.id ?? data.userId;
        if (!userId)
            throw new Error('Session requires userId');
        const row = await this.prisma.session.create({
            data: { userId, deletedAt: data.deletedAt ?? null },
            include: { user: true },
        });
        return this.toEntity(row);
    }
    async softDelete({ excludeId, ...criteria }) {
        await this.prisma.session.updateMany({
            where: {
                id: criteria.id,
                userId: criteria.user?.id,
                deletedAt: null,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            data: { deletedAt: new Date() },
        });
    }
    toWhere(where) {
        const user = where.user;
        return { id: where.id, userId: user?.id };
    }
    toEntity(row) {
        return Object.assign(new session_entity_js_1.Session(), {
            id: row.id,
            userId: row.userId,
            user: row.user ? this.toUser(row.user) : undefined,
            createdAt: row.createdAt,
            deletedAt: row.deletedAt,
        });
    }
    toUser(row) {
        return Object.assign(new user_entity_js_1.User(), row, {
            role: row.role?.toLowerCase(),
            status: row.status?.toLowerCase(),
            provider: row.provider?.toLowerCase(),
        });
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], SessionService);
//# sourceMappingURL=session.service.js.map