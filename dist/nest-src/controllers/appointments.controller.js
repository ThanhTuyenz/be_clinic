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
exports.AppointmentsController = void 0;
const common_1 = require("@nestjs/common");
const appointmentsController_js_1 = require("../../src/controllers/appointmentsController.js");
const skip_permissions_decorator_js_1 = require("../modules/permissions/decorators/skip-permissions.decorator.js");
let AppointmentsController = class AppointmentsController {
    listMyAppointments(req, res) {
        return (0, appointmentsController_js_1.listMyAppointments)(req, res);
    }
    listDoctorAppointments(req, res) {
        return (0, appointmentsController_js_1.listDoctorAppointments)(req, res);
    }
    lookupAppointmentByTicket(req, res) {
        return (0, appointmentsController_js_1.lookupAppointmentByTicket)(req, res);
    }
    lookupPatientByCode(req, res) {
        return (0, appointmentsController_js_1.lookupPatientByCode)(req, res);
    }
    listPatientsReception(req, res) {
        return (0, appointmentsController_js_1.listPatientsReception)(req, res);
    }
    listPatientHistoryReception(req, res) {
        return (0, appointmentsController_js_1.listPatientHistoryReception)(req, res);
    }
    listReceptionAppointments(req, res) {
        return (0, appointmentsController_js_1.listReceptionAppointments)(req, res);
    }
    getAvailability(req, res) {
        return (0, appointmentsController_js_1.getAvailability)(req, res);
    }
    getDoctorScheduleDates(req, res) {
        return (0, appointmentsController_js_1.getDoctorScheduleDates)(req, res);
    }
    createAppointmentReception(req, res) {
        return (0, appointmentsController_js_1.createAppointmentReception)(req, res);
    }
    updateAppointmentStatusReception(req, res) {
        return (0, appointmentsController_js_1.updateAppointmentStatusReception)(req, res);
    }
    cancelAppointment(req, res) {
        return (0, appointmentsController_js_1.cancelAppointment)(req, res);
    }
    createAppointment(req, res) {
        return (0, appointmentsController_js_1.createAppointment)(req, res);
    }
};
exports.AppointmentsController = AppointmentsController;
__decorate([
    (0, common_1.Get)('my'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listMyAppointments", null);
__decorate([
    (0, common_1.Get)('doctor'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listDoctorAppointments", null);
__decorate([
    (0, common_1.Get)('lookup-ticket'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "lookupAppointmentByTicket", null);
__decorate([
    (0, common_1.Get)('patient-by-code'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "lookupPatientByCode", null);
__decorate([
    (0, common_1.Get)('patients'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listPatientsReception", null);
__decorate([
    (0, common_1.Get)('patient-history'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listPatientHistoryReception", null);
__decorate([
    (0, common_1.Get)('reception'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listReceptionAppointments", null);
__decorate([
    (0, common_1.Get)('availability'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "getAvailability", null);
__decorate([
    (0, common_1.Get)('schedule-dates'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "getDoctorScheduleDates", null);
__decorate([
    (0, common_1.Post)('reception'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "createAppointmentReception", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "updateAppointmentStatusReception", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "cancelAppointment", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "createAppointment", null);
exports.AppointmentsController = AppointmentsController = __decorate([
    (0, common_1.Controller)('appointments'),
    (0, skip_permissions_decorator_js_1.SkipPermissions)()
], AppointmentsController);
//# sourceMappingURL=appointments.controller.js.map