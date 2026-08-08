"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const examinationsController_js_1 = require("../controllers/examinationsController.js");
const authMiddleware_js_1 = require("../middleware/authMiddleware.js");
const router = (0, express_1.Router)();
router.post('/', authMiddleware_js_1.requireAuth, examinationsController_js_1.upsertExamination);
exports.default = router;
//# sourceMappingURL=examinationsRoutes.js.map