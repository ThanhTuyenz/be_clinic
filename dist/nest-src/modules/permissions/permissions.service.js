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
var PermissionsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const user_entity_1 = require("../auth/users/entities/user.entity");
const constants_1 = require("../../common/utils/constants");
const enums_1 = require("./enums");
const permissions_helpers_1 = require("./permissions.helpers");
const permissions_cache_service_1 = require("./services/permissions-cache.service");
let PermissionsService = PermissionsService_1 = class PermissionsService {
    usersRepository;
    cacheService;
    rolesService;
    logger = new common_1.Logger(PermissionsService_1.name);
    constructor(usersRepository, cacheService, rolesService) {
        this.usersRepository = usersRepository;
        this.cacheService = cacheService;
        this.rolesService = rolesService;
    }
    async getMany(userId) {
        const cached = this.cacheService.get(userId);
        if (cached) {
            this.logger.debug(`Returning cached permissions for user ${userId}`);
            return { role: cached.role, permissions: cached.permissions };
        }
        const permissions = [];
        const user = await this.usersRepository.findOne({
            where: { id: userId },
        });
        if (!user) {
            this.logger.warn(`User not found: ${userId}`);
            throw new common_1.NotFoundException('User not found');
        }
        if (user.isDeleted) {
            this.logger.warn(`User is deleted: ${userId}`);
            throw new common_1.NotFoundException('User has been deleted');
        }
        if (user.isBlocked) {
            this.logger.warn(`User is blocked: ${userId}`);
            throw new common_1.NotFoundException('User has been blocked');
        }
        const permissionRole = (0, enums_1.mapUserRoleToPermissionRole)(user.role);
        if (user.roleId) {
            try {
                const role = await this.rolesService.findOne(user.roleId);
                this.logger.log(`Found role ${role.id} with ${role.permissions?.length || 0} permissions`);
                if (role.permissions?.length) {
                    permissions.push(...role.permissions);
                }
            }
            catch (error) {
                this.logger.warn(`Unable to load role ${user.roleId} for user ${userId}, falling back to global role permissions`);
            }
        }
        if (user.customPermissions?.length) {
            this.logger.log(`Found custom permissions with length ${user.customPermissions.length}`);
            permissions.push(...user.customPermissions);
        }
        if (!permissions.length) {
            this.logger.log(`No role or custom permissions found, using global permissions for ${permissionRole}`);
            permissions.push(...(0, permissions_helpers_1.generateGlobalPermissions)(permissionRole));
        }
        this.cacheService.set(userId, permissionRole, permissions);
        return { role: permissionRole, permissions };
    }
    invalidateCache(userId) {
        this.cacheService.invalidate(userId);
        this.logger.log(`Invalidated permission cache for user ${userId}`);
    }
    invalidateAllCache() {
        this.cacheService.invalidateAll();
        this.logger.log('Invalidated all permission caches');
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = PermissionsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(2, (0, common_1.Inject)(constants_1.Services.ROLES)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        permissions_cache_service_1.PermissionsCacheService, Object])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map