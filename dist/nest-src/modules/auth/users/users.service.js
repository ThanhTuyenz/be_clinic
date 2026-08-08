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
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const user_entity_1 = require("./entities/user.entity");
const history_service_1 = require("../../history/history.service");
const history_1 = require("../../history/history");
const constants_1 = require("../../../common/utils/constants");
const permissions_service_1 = require("../../permissions/permissions.service");
let UsersService = class UsersService {
    usersRepository;
    historyService;
    rolesService;
    permissionsService;
    constructor(usersRepository, historyService, rolesService, permissionsService) {
        this.usersRepository = usersRepository;
        this.historyService = historyService;
        this.rolesService = rolesService;
        this.permissionsService = permissionsService;
    }
    async createUser(createUserDto) {
        const email = createUserDto.email;
        if (!email)
            throw new Error('Email không được gửi tới server.');
        const existingUser = await this.usersRepository.findOne({
            where: { email: email },
        });
        if (existingUser)
            throw new common_1.HttpException('User already exists', common_1.HttpStatus.CONFLICT);
        if (createUserDto.roleId) {
            await this.rolesService.findOne(createUserDto.roleId);
        }
        const user = this.usersRepository.create({
            ...createUserDto,
            status: createUserDto.status || user_entity_1.UserStatus.Active,
            customPermissions: createUserDto.customPermissions || null,
        });
        return this.usersRepository.save(user);
    }
    findOneUser(options) {
        return this.usersRepository.findOne({
            where: options,
        });
    }
    escapeRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    async findUsersWithPagination(options) {
        const emailTerm = options.email?.trim();
        const nameTerm = options.name?.trim();
        const where = {};
        const andConditions = [];
        if (emailTerm) {
            where.email = {
                $regex: this.escapeRegex(emailTerm),
                $options: 'i',
            };
        }
        if (nameTerm) {
            where.fullName = {
                $regex: this.escapeRegex(nameTerm),
                $options: 'i',
            };
        }
        if (options.isBlocked !== undefined) {
            where.isBlocked = options.isBlocked;
        }
        if (options.isDeleted === true) {
            andConditions.push({ isDeleted: true });
        }
        else {
            andConditions.push({
                $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
            });
        }
        if (andConditions.length > 0) {
            where.$and = andConditions;
        }
        const [data, total] = await this.usersRepository.findAndCount({
            where: (Object.keys(where).length > 0 ? where : {}),
            skip: (options.page - 1) * options.limit,
            take: options.limit,
            order: { createdAt: 'DESC' },
        });
        return { data, total };
    }
    async findByEmail(email) {
        return await this.usersRepository.findOne({
            where: { email: email },
        });
    }
    async updateUser(id, payload) {
        const existingUser = await this.findOneUser({ id });
        if (!existingUser) {
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        }
        if (payload.roleId !== undefined && payload.roleId !== null) {
            await this.rolesService.findOne(payload.roleId);
        }
        const nextPayload = { ...payload };
        if (nextPayload.isBlocked === true) {
            nextPayload.blockedAt = existingUser.blockedAt ?? new Date();
        }
        if (nextPayload.isBlocked === false) {
            nextPayload.blockedAt = null;
        }
        if (nextPayload.isDeleted === true) {
            nextPayload.status = user_entity_1.UserStatus.Inactive;
        }
        Object.assign(existingUser, nextPayload);
        const updatedUser = await this.usersRepository.save(existingUser);
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_UPDATED,
            message: `Cập nhật người dùng ${existingUser.email}`,
            actorId: existingUser.id,
            actorEmail: existingUser.email ?? undefined,
            targetType: 'user',
            targetId: existingUser.id,
        });
        try {
            this.permissionsService.invalidateCache(existingUser.id);
        }
        catch (err) {
        }
        return updatedUser;
    }
    async deleteUser(id) {
        const existingUser = await this.findOneUser({ id });
        if (!existingUser) {
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        }
        existingUser.isDeleted = true;
        await this.usersRepository.save(existingUser);
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_DELETED,
            message: `Xóa người dùng ${existingUser.email}`,
            actorId: existingUser.id,
            actorEmail: existingUser.email ?? undefined,
            targetType: 'user',
            targetId: existingUser.id,
        });
    }
    async saveUser(user) {
        return this.usersRepository.save(user);
    }
    async assignRole(userId, roleId) {
        const user = await this.findOneUser({ id: userId });
        if (!user) {
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        }
        await this.rolesService.findOne(roleId);
        user.roleId = roleId;
        const updatedUser = await this.usersRepository.save(user);
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_UPDATED,
            message: `Gán role cho người dùng ${user.email}`,
            actorId: user.id,
            actorEmail: user.email ?? undefined,
            targetType: 'user',
            targetId: user.id,
        });
        try {
            this.permissionsService.invalidateCache(user.id);
        }
        catch (err) { }
        return updatedUser;
    }
    async removeRole(userId) {
        const user = await this.findOneUser({ id: userId });
        if (!user) {
            throw new common_1.NotFoundException('Không tìm thấy người dùng');
        }
        user.roleId = null;
        const updatedUser = await this.usersRepository.save(user);
        await this.historyService.create({
            action: history_1.HISTORY_ACTIONS.USER_UPDATED,
            message: `Xóa role của người dùng ${user.email}`,
            actorId: user.id,
            actorEmail: user.email ?? undefined,
            targetType: 'user',
            targetId: user.id,
        });
        try {
            this.permissionsService.invalidateCache(user.id);
        }
        catch (err) { }
        return updatedUser;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.User)),
    __param(2, (0, common_1.Inject)(constants_1.Services.ROLES)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        history_service_1.HistoryService, Object, permissions_service_1.PermissionsService])
], UsersService);
//# sourceMappingURL=users.service.js.map