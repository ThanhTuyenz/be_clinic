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
exports.User = exports.UserRole = exports.UserStatus = void 0;
const typeorm_1 = require("typeorm");
const mongodb_1 = require("mongodb");
const crypto_1 = require("crypto");
const entity_helper_1 = require("../../../../common/utils/entity-helper");
const class_transformer_1 = require("class-transformer");
const auth_providers_enum_1 = require("../../auth-local/enums/auth-providers.enum");
const helpers_1 = require("../../../../common/utils/helpers");
var UserStatus;
(function (UserStatus) {
    UserStatus["Active"] = "active";
    UserStatus["Inactive"] = "inactive";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
var UserRole;
(function (UserRole) {
    UserRole["SuperAdmin"] = "super_admin";
    UserRole["Admin"] = "admin";
    UserRole["BranchManager"] = "branch_manager";
    UserRole["Doctor"] = "doctor";
    UserRole["Pharmacist"] = "pharmacist";
    UserRole["Cashier"] = "cashier";
    UserRole["Receptionist"] = "receptionist";
    UserRole["Patient"] = "patient";
    UserRole["Staff"] = "staff";
    UserRole["User"] = "user";
})(UserRole || (exports.UserRole = UserRole = {}));
let User = class User extends entity_helper_1.EntityHelper {
    _id;
    id;
    email;
    password;
    previousPassword;
    loadPreviousPassword() {
        this.previousPassword = this.password;
    }
    setId() {
        if (!this.id) {
            this.id = (0, crypto_1.randomUUID)();
        }
    }
    async setPassword() {
        if (this.previousPassword !== this.password && this.password) {
            this.password = await (0, helpers_1.hashPassword)(this.password);
        }
    }
    provider;
    status;
    role;
    socialId;
    fullName;
    roleId;
    customPermissions;
    hash;
    emailOtpHash;
    emailOtpExpiresAt;
    emailOtpLastSentAt;
    emailOtpAttempts;
    isBlocked;
    blockedAt;
    isDeleted;
    lastLoginAt;
    createdAt;
    updatedAt;
    setCreatedAt() {
        if (!this.createdAt) {
            this.createdAt = new Date();
        }
    }
    setUpdatedAt() {
        this.updatedAt = new Date();
    }
};
exports.User = User;
__decorate([
    (0, typeorm_1.ObjectIdColumn)(),
    __metadata("design:type", mongodb_1.ObjectId)
], User.prototype, "_id", void 0);
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: String }),
    __metadata("design:type", String)
], User.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    __metadata("design:type", String)
], User.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", String)
], User.prototype, "password", void 0);
__decorate([
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", String)
], User.prototype, "previousPassword", void 0);
__decorate([
    (0, typeorm_1.AfterLoad)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], User.prototype, "loadPreviousPassword", null);
__decorate([
    (0, typeorm_1.BeforeInsert)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], User.prototype, "setId", null);
__decorate([
    (0, typeorm_1.BeforeInsert)(),
    (0, typeorm_1.BeforeUpdate)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], User.prototype, "setPassword", null);
__decorate([
    (0, typeorm_1.Column)({ default: auth_providers_enum_1.AuthProvidersEnum.email }),
    __metadata("design:type", String)
], User.prototype, "provider", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: UserStatus.Active }),
    __metadata("design:type", String)
], User.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: UserRole.Patient }),
    __metadata("design:type", String)
], User.prototype, "role", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    __metadata("design:type", String)
], User.prototype, "socialId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    __metadata("design:type", String)
], User.prototype, "fullName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    __metadata("design:type", String)
], User.prototype, "roleId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Array)
], User.prototype, "customPermissions", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    (0, typeorm_1.Index)(),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", String)
], User.prototype, "hash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", String)
], User.prototype, "emailOtpHash", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date, nullable: true }),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", Date)
], User.prototype, "emailOtpExpiresAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date, nullable: true }),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", Date)
], User.prototype, "emailOtpLastSentAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Number, default: 0 }),
    (0, class_transformer_1.Exclude)({ toPlainOnly: true }),
    __metadata("design:type", Number)
], User.prototype, "emailOtpAttempts", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    (0, typeorm_1.Index)(),
    __metadata("design:type", Boolean)
], User.prototype, "isBlocked", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date, nullable: true, default: null }),
    __metadata("design:type", Date)
], User.prototype, "blockedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    (0, typeorm_1.Index)(),
    __metadata("design:type", Boolean)
], User.prototype, "isDeleted", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date, nullable: true, default: null }),
    (0, typeorm_1.Index)(),
    __metadata("design:type", Date)
], User.prototype, "lastLoginAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date }),
    __metadata("design:type", Date)
], User.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date }),
    __metadata("design:type", Date)
], User.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.BeforeInsert)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], User.prototype, "setCreatedAt", null);
__decorate([
    (0, typeorm_1.BeforeUpdate)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], User.prototype, "setUpdatedAt", null);
exports.User = User = __decorate([
    (0, typeorm_1.Entity)()
], User);
//# sourceMappingURL=user.entity.js.map