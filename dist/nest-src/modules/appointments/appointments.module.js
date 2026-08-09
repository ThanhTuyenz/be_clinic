"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppointmentsModule = void 0;
const common_1 = require("@nestjs/common");
const appointments_controller_js_1 = require("../../controllers/appointments.controller.js");
const booking_controller_js_1 = require("./booking.controller.js");
const booking_service_js_1 = require("./booking.service.js");
const payment_webhook_signature_service_js_1 = require("./payment-webhook-signature.service.js");
const staff_appointments_controller_js_1 = require("./staff-appointments.controller.js");
const staff_appointments_service_js_1 = require("./staff-appointments.service.js");
let AppointmentsModule = class AppointmentsModule {
};
exports.AppointmentsModule = AppointmentsModule;
exports.AppointmentsModule = AppointmentsModule = __decorate([
    (0, common_1.Module)({
        controllers: [appointments_controller_js_1.AppointmentsController, staff_appointments_controller_js_1.StaffAppointmentsController, booking_controller_js_1.BookingController, booking_controller_js_1.PaymentWebhookController, booking_controller_js_1.CheckInController],
        providers: [booking_service_js_1.BookingService, payment_webhook_signature_service_js_1.PaymentWebhookSignatureService, staff_appointments_service_js_1.StaffAppointmentsService],
        exports: [booking_service_js_1.BookingService],
    })
], AppointmentsModule);
//# sourceMappingURL=appointments.module.js.map