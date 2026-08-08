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
const swagger_1 = require("@nestjs/swagger");
const appointment_swagger_dto_js_1 = require("./dtos/appointment.swagger.dto.js");
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
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách lịch khám của bệnh nhân hiện tại' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Danh sách lịch khám' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listMyAppointments", null);
__decorate([
    (0, common_1.Get)('doctor'),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách lịch khám của bác sĩ hiện tại' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listDoctorAppointments", null);
__decorate([
    (0, common_1.Get)('lookup-ticket'),
    (0, swagger_1.ApiOperation)({ summary: 'Tra cứu lịch khám bằng mã vé (tiếp nhận)' }),
    (0, swagger_1.ApiQuery)({ name: 'ticket', example: '260810-ABC123' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "lookupAppointmentByTicket", null);
__decorate([
    (0, common_1.Get)('patient-by-code'),
    (0, swagger_1.ApiOperation)({ summary: 'Tra cứu bệnh nhân bằng mã bệnh nhân' }),
    (0, swagger_1.ApiQuery)({ name: 'code' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "lookupPatientByCode", null);
__decorate([
    (0, common_1.Get)('patients'),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách bệnh nhân cho bộ phận tiếp nhận' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'pageSize', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'patientCode', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'name', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'phone', required: false }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listPatientsReception", null);
__decorate([
    (0, common_1.Get)('patient-history'),
    (0, swagger_1.ApiOperation)({ summary: 'Lịch sử khám của một bệnh nhân' }),
    (0, swagger_1.ApiQuery)({ name: 'patientId' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listPatientHistoryReception", null);
__decorate([
    (0, common_1.Get)('reception'),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách lịch khám cho bộ phận tiếp nhận' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false, example: '2026-08-01' }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false, example: '2026-08-31' }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, enum: ['all', 'pending', 'confirmed', 'cancelled'] }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false, description: 'Từ khóa tìm kiếm' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "listReceptionAppointments", null);
__decorate([
    (0, common_1.Get)('availability'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy các khung giờ còn trống của bác sĩ' }),
    (0, swagger_1.ApiQuery)({ name: 'doctorId' }),
    (0, swagger_1.ApiQuery)({ name: 'date', example: '2026-08-10' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "getAvailability", null);
__decorate([
    (0, common_1.Get)('schedule-dates'),
    (0, swagger_1.ApiOperation)({ summary: 'Lấy các ngày làm việc của bác sĩ' }),
    (0, swagger_1.ApiQuery)({ name: 'doctorId' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false, example: '2026-08-01' }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false, example: '2026-08-31' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "getDoctorScheduleDates", null);
__decorate([
    (0, common_1.Post)('reception'),
    (0, swagger_1.ApiOperation)({ summary: 'Tiếp nhận đặt lịch thay cho bệnh nhân' }),
    (0, swagger_1.ApiBody)({ type: appointment_swagger_dto_js_1.CreateReceptionAppointmentSwaggerDto }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Đặt lịch tại quầy thành công' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "createAppointmentReception", null);
__decorate([
    (0, common_1.Patch)(':id/status'),
    (0, swagger_1.ApiOperation)({ summary: 'Cập nhật trạng thái lịch khám' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'MongoDB ID của lịch khám' }),
    (0, swagger_1.ApiBody)({ type: appointment_swagger_dto_js_1.UpdateAppointmentStatusSwaggerDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "updateAppointmentStatusReception", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    (0, swagger_1.ApiOperation)({ summary: 'Bệnh nhân hủy lịch khám' }),
    (0, swagger_1.ApiParam)({ name: 'id', description: 'MongoDB ID của lịch khám' }),
    (0, swagger_1.ApiBody)({ type: appointment_swagger_dto_js_1.CancelAppointmentSwaggerDto }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "cancelAppointment", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Bệnh nhân đặt lịch khám online' }),
    (0, swagger_1.ApiBody)({ type: appointment_swagger_dto_js_1.CreateAppointmentSwaggerDto }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Đặt lịch thành công' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Trùng lịch hoặc khung giờ đã được đặt' }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AppointmentsController.prototype, "createAppointment", null);
exports.AppointmentsController = AppointmentsController = __decorate([
    (0, swagger_1.ApiTags)('Appointments'),
    (0, swagger_1.ApiBearerAuth)('access-token'),
    (0, common_1.Controller)('appointments'),
    (0, skip_permissions_decorator_js_1.SkipPermissions)()
], AppointmentsController);
//# sourceMappingURL=appointments.controller.js.map