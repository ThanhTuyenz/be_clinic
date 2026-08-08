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
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const session_entity_1 = require("./entities/session.entity");
let SessionService = class SessionService {
    sessionRepository;
    constructor(sessionRepository) {
        this.sessionRepository = sessionRepository;
    }
    async findOne(options) {
        const session = await this.sessionRepository.findOne({
            where: options.where,
        });
        if (!session || session.deletedAt) {
            return null;
        }
        return session;
    }
    async findMany(options) {
        const sessions = await this.sessionRepository.find({
            where: options.where,
        });
        return sessions.filter((session) => !session.deletedAt);
    }
    async create(data) {
        const session = this.sessionRepository.create(data);
        return this.sessionRepository.save(session);
    }
    async softDelete({ excludeId, ...criteria }) {
        const sessions = await this.sessionRepository.find({
            where: criteria,
        });
        const sessionsToDelete = sessions.filter((session) => {
            if (session.deletedAt) {
                return false;
            }
            if (excludeId && session.id === excludeId) {
                return false;
            }
            return true;
        });
        if (!sessionsToDelete.length) {
            return;
        }
        const deletedAt = new Date();
        await this.sessionRepository.save(sessionsToDelete.map((session) => ({
            ...session,
            deletedAt,
        })));
    }
};
exports.SessionService = SessionService;
exports.SessionService = SessionService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(session_entity_1.Session)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], SessionService);
//# sourceMappingURL=session.service.js.map