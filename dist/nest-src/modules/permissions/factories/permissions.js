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
exports.Permissions = exports.PERMISSIONS = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const permissions_helpers_1 = require("../permissions.helpers");
exports.PERMISSIONS = Symbol('PERMISSIONS');
let Permissions = class Permissions {
    request;
    constructor(request) {
        this.request = request;
    }
    canActivate(resourceType, action, target) {
        if (!this.context) {
            return false;
        }
        const requiredPermission = (0, permissions_helpers_1.generatePermission)(resourceType, action, target);
        return (0, permissions_helpers_1.grantedMatchRequired)(this.context.grantedPermissions, requiredPermission);
    }
    get allowedResourcesIds() {
        return this.context?.allowedResourcesIds ?? null;
    }
    get deniedResourcesIds() {
        return this.context?.deniedResourcesIds ?? null;
    }
    get context() {
        return this.request.permissionsContext;
    }
};
exports.Permissions = Permissions;
exports.Permissions = Permissions = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(core_1.REQUEST)),
    __metadata("design:paramtypes", [Object])
], Permissions);
//# sourceMappingURL=permissions.js.map