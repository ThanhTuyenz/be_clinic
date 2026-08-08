"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const clinicRoomsController_js_1 = require("../controllers/clinicRoomsController.js");
const router = (0, express_1.Router)();
router.get('/', clinicRoomsController_js_1.listClinicRooms);
exports.default = router;
//# sourceMappingURL=clinicRoomsRoutes.js.map