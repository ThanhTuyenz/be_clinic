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
exports.ForgotPassword = void 0;
const typeorm_1 = require("typeorm");
const class_validator_1 = require("class-validator");
const entity_helper_1 = require("../../../../common/utils/entity-helper");
const crypto_1 = require("crypto");
const mongodb_1 = require("mongodb");
let ForgotPassword = class ForgotPassword extends entity_helper_1.EntityHelper {
    _id;
    id;
    hash;
    user;
    userId;
    createdAt;
    deletedAt;
    setId() {
        if (!this.id) {
            this.id = (0, crypto_1.randomUUID)();
        }
        if (!this.createdAt) {
            this.createdAt = new Date();
        }
    }
};
exports.ForgotPassword = ForgotPassword;
__decorate([
    (0, typeorm_1.ObjectIdColumn)(),
    __metadata("design:type", mongodb_1.ObjectId)
], ForgotPassword.prototype, "_id", void 0);
__decorate([
    (0, typeorm_1.PrimaryColumn)({ type: String }),
    __metadata("design:type", String)
], ForgotPassword.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.Allow)(),
    (0, typeorm_1.Column)(),
    (0, typeorm_1.Index)(),
    __metadata("design:type", String)
], ForgotPassword.prototype, "hash", void 0);
__decorate([
    (0, class_validator_1.Allow)(),
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", Object)
], ForgotPassword.prototype, "user", void 0);
__decorate([
    (0, class_validator_1.Allow)(),
    (0, typeorm_1.Column)({ type: String, nullable: true }),
    __metadata("design:type", String)
], ForgotPassword.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date }),
    __metadata("design:type", Date)
], ForgotPassword.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: Date, nullable: true }),
    __metadata("design:type", Date)
], ForgotPassword.prototype, "deletedAt", void 0);
__decorate([
    (0, typeorm_1.BeforeInsert)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ForgotPassword.prototype, "setId", null);
exports.ForgotPassword = ForgotPassword = __decorate([
    (0, typeorm_1.Entity)()
], ForgotPassword);
//# sourceMappingURL=forgot-password.entity.js.map