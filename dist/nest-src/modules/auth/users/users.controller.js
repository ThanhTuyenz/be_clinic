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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const permissions_decorator_1 = require("../../permissions/decorators/permissions.decorator");
const constants_1 = require("../../../common/utils/constants");
const create_user_dto_1 = require("./dtos/create-user.dto");
const update_user_admin_dto_1 = require("./dtos/update-user-admin.dto");
const users_pagination_query_dto_1 = require("./dtos/users-pagination-query.dto");
const assign_role_dto_1 = require("./dtos/assign-role.dto");
let UsersController = class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    create(createUserDto) {
        return this.usersService.createUser(createUserDto);
    }
    findAll(query) {
        return this.usersService.findUsersWithPagination({
            page: query.page,
            limit: query.limit,
            email: query.email,
            name: query.name,
            isBlocked: query.isBlocked,
            isDeleted: query.isDeleted,
        });
    }
    update(id, updateUserDto) {
        return this.usersService.updateUser(id, updateUserDto);
    }
    async remove(id) {
        await this.usersService.deleteUser(id);
    }
    assignRole(id, assignRoleDto) {
        return this.usersService.assignRole(id, assignRoleDto.roleId);
    }
    async removeRole(id) {
        await this.usersService.removeRole(id);
    }
    assignCustomPermissions(id, permissions) {
        return this.usersService.updateUser(id, { customPermissions: permissions });
    }
    async removeCustomPermissions(id) {
        await this.usersService.updateUser(id, { customPermissions: null });
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.CREATE, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Tạo mới người dùng (admin)' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.CreateUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.GET, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: 'Danh sách người dùng (phân trang, admin; lọc tùy chọn theo email, họ tên)',
    }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [users_pagination_query_dto_1.UsersPaginationQueryDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.EDIT, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_user_admin_dto_1.UpdateUserAdminDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.DELETE, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa mềm người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Patch)(':id/role'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.EDIT, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Gán role cho người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assign_role_dto_1.AssignRoleDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "assignRole", null);
__decorate([
    (0, common_1.Delete)(':id/role'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.EDIT, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa role của người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "removeRole", null);
__decorate([
    (0, common_1.Post)(':id/permissions'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.EDIT, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Gán quyền tùy chỉnh cho người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "assignCustomPermissions", null);
__decorate([
    (0, common_1.Delete)(':id/permissions'),
    (0, permissions_decorator_1.RequiresPermission)(permissions_decorator_1.PermissionResource.USER, permissions_decorator_1.PermissionAction.EDIT, permissions_decorator_1.PermissionResourceTarget.ANY),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'UUID người dùng' }),
    (0, swagger_1.ApiOperation)({ summary: 'Xóa quyền tùy chỉnh của người dùng (admin)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "removeCustomPermissions", null);
exports.UsersController = UsersController = __decorate([
    (0, swagger_1.ApiTags)('Users'),
    (0, common_1.Controller)(constants_1.Routes.USERS),
    __param(0, (0, common_1.Inject)(constants_1.Services.USERS)),
    __metadata("design:paramtypes", [Object])
], UsersController);
//# sourceMappingURL=users.controller.js.map