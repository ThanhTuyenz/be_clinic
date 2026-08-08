"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequiresPermission = exports.REQUIRED_PERMISSION = exports.SkipPermissions = exports.PermissionResourceTarget = exports.PermissionAction = exports.PermissionResource = void 0;
exports.GetResourceIdFromParams = GetResourceIdFromParams;
const common_1 = require("@nestjs/common");
const enums_1 = require("../enums");
Object.defineProperty(exports, "PermissionAction", { enumerable: true, get: function () { return enums_1.PermissionAction; } });
Object.defineProperty(exports, "PermissionResource", { enumerable: true, get: function () { return enums_1.PermissionResource; } });
Object.defineProperty(exports, "PermissionResourceTarget", { enumerable: true, get: function () { return enums_1.PermissionResourceTarget; } });
var skip_permissions_decorator_1 = require("./skip-permissions.decorator");
Object.defineProperty(exports, "SkipPermissions", { enumerable: true, get: function () { return skip_permissions_decorator_1.SkipPermissions; } });
function GetResourceIdFromParams(req) {
    const { id } = req.params;
    if (!id) {
        throw new Error('missing resource id in params');
    }
    const resourceId = Array.isArray(id) ? id[0] : id;
    return resourceId;
}
exports.REQUIRED_PERMISSION = Symbol('REQUIRED_PERMISSION');
const RequiresPermission = (resourceType, action, resourceTarget) => (0, common_1.SetMetadata)(exports.REQUIRED_PERMISSION, {
    resourceType,
    action,
    resourceTarget,
    effect: enums_1.PermissionEffect.ALLOW,
});
exports.RequiresPermission = RequiresPermission;
//# sourceMappingURL=permissions.decorator.js.map