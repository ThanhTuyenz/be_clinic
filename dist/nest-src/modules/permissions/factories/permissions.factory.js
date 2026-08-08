"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsFactory = void 0;
const permissions_1 = require("./permissions");
exports.PermissionsFactory = {
    provide: permissions_1.PERMISSIONS,
    useFactory: (permissions) => {
        return permissions;
    },
    inject: [permissions_1.Permissions],
};
//# sourceMappingURL=permissions.factory.js.map