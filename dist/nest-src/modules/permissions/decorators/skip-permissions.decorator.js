"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkipPermissions = exports.SKIP_PERMISSIONS_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.SKIP_PERMISSIONS_KEY = 'skipPermissions';
const SkipPermissions = () => (0, common_1.SetMetadata)(exports.SKIP_PERMISSIONS_KEY, true);
exports.SkipPermissions = SkipPermissions;
//# sourceMappingURL=skip-permissions.decorator.js.map