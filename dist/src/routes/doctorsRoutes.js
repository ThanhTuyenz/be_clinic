"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const doctorsController_js_1 = require("../controllers/doctorsController.js");
const router = (0, express_1.Router)();
router.get('/', doctorsController_js_1.listDoctors);
exports.default = router;
//# sourceMappingURL=doctorsRoutes.js.map