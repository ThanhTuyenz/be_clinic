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
exports.CreateUserDto = void 0;
const class_transformer_1 = require("class-transformer");
const typeorm_1 = require("typeorm");
const class_validator_1 = require("class-validator");
const class_transformer_2 = require("class-transformer");
const lower_case_transformer_1 = require("../../../../common/utils/transformers/lower-case.transformer");
const user_entity_1 = require("../entities/user.entity");
const swagger_1 = require("@nestjs/swagger");
const create_role_dto_1 = require("../../../roles/dtos/create-role.dto");
class CreateUserDto {
    email;
    password;
    fullName;
    role;
    roleId;
    customPermissions;
    status;
    provider;
    socialId;
    hash;
}
exports.CreateUserDto = CreateUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'vuminhduc.contact@gmail.com' }),
    (0, class_transformer_1.Transform)(lower_case_transformer_1.lowerCaseTransformer),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123456' }),
    (0, class_validator_1.MinLength)(6),
    __metadata("design:type", String)
], CreateUserDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Vu Minh Duc' }),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "fullName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: user_entity_1.UserRole.Patient, default: user_entity_1.UserRole.Patient }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, typeorm_1.Column)({ default: user_entity_1.UserRole.Patient }),
    (0, class_validator_1.IsEnum)(user_entity_1.UserRole, { message: 'Role không hợp lệ' }),
    __metadata("design:type", String)
], CreateUserDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ description: 'Role ID to assign to user', required: false }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "roleId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Custom permissions for user',
        required: false,
        type: [create_role_dto_1.RolePermissionDto],
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_2.Type)(() => create_role_dto_1.RolePermissionDto),
    __metadata("design:type", Array)
], CreateUserDto.prototype, "customPermissions", void 0);
//# sourceMappingURL=create-user.dto.js.map