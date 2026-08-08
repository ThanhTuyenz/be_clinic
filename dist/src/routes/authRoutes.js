"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_js_1 = require("../controllers/authController.js");
const authMiddleware_js_1 = require("../middleware/authMiddleware.js");
const router = (0, express_1.Router)();
router.post('/register', authController_js_1.register);
router.post('/start-register', authController_js_1.startRegister);
router.post('/verify-email', authController_js_1.verifyEmail);
router.post('/complete-register', authController_js_1.completeRegister);
router.post('/resend-otp', authController_js_1.resendOtp);
router.post('/login', authController_js_1.login);
router.post('/staff-login', authController_js_1.staffLogin);
router.get('/me', authMiddleware_js_1.requireAuth, authController_js_1.me);
router.patch('/me', authMiddleware_js_1.requireAuth, authController_js_1.updateMe);
exports.default = router;
//# sourceMappingURL=authRoutes.js.map