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
var PermissionsCacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsCacheService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let PermissionsCacheService = PermissionsCacheService_1 = class PermissionsCacheService {
    configService;
    logger = new common_1.Logger(PermissionsCacheService_1.name);
    cache = new Map();
    ttl;
    cleanupInterval;
    constructor(configService) {
        this.configService = configService;
        this.ttl =
            this.configService.get('PERMISSIONS_CACHE_TTL') || 300000;
    }
    onModuleInit() {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpired();
        }, 60000);
        this.logger.log(`Permissions cache initialized with TTL: ${this.ttl}ms`);
    }
    onModuleDestroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
    }
    get(userId) {
        const cached = this.cache.get(userId);
        if (!cached) {
            return null;
        }
        const now = Date.now();
        const age = now - cached.cachedAt;
        if (age > this.ttl) {
            this.cache.delete(userId);
            this.logger.debug(`Cache expired for user ${userId}`);
            return null;
        }
        this.logger.debug(`Cache hit for user ${userId}, age: ${age}ms`);
        return cached;
    }
    set(userId, role, permissions) {
        this.cache.set(userId, {
            role,
            permissions,
            cachedAt: Date.now(),
        });
        this.logger.debug(`Cached permissions for user ${userId}`);
    }
    invalidate(userId) {
        const deleted = this.cache.delete(userId);
        if (deleted) {
            this.logger.debug(`Invalidated cache for user ${userId}`);
        }
    }
    invalidateAll() {
        const size = this.cache.size;
        this.cache.clear();
        this.logger.log(`Invalidated all cached permissions (${size} entries)`);
    }
    getStats() {
        return {
            size: this.cache.size,
            ttl: this.ttl,
        };
    }
    cleanupExpired() {
        const now = Date.now();
        let cleaned = 0;
        for (const [userId, cached] of this.cache.entries()) {
            const age = now - cached.cachedAt;
            if (age > this.ttl) {
                this.cache.delete(userId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
        }
    }
};
exports.PermissionsCacheService = PermissionsCacheService;
exports.PermissionsCacheService = PermissionsCacheService = PermissionsCacheService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PermissionsCacheService);
//# sourceMappingURL=permissions-cache.service.js.map