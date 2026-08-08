"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionRole = void 0;
exports.mapUserRoleToPermissionRole = mapUserRoleToPermissionRole;
const user_entity_1 = require("../../auth/users/entities/user.entity");
var PermissionRole;
(function (PermissionRole) {
    PermissionRole["SUPER_ADMIN"] = "super_admin";
    PermissionRole["ADMIN"] = "admin";
    PermissionRole["STAFF"] = "staff";
    PermissionRole["USER"] = "user";
})(PermissionRole || (exports.PermissionRole = PermissionRole = {}));
function mapUserRoleToPermissionRole(userRole) {
    switch (userRole) {
        case user_entity_1.UserRole.SuperAdmin:
            return PermissionRole.SUPER_ADMIN;
        case user_entity_1.UserRole.Admin:
            return PermissionRole.ADMIN;
        case user_entity_1.UserRole.Staff:
            return PermissionRole.STAFF;
        case user_entity_1.UserRole.User:
            return PermissionRole.USER;
        default:
            throw new Error(`Unsupported user role: ${userRole}`);
    }
}
//# sourceMappingURL=role.enum.js.map