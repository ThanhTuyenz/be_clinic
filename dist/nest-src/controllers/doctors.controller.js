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
exports.DoctorsController = exports.PublicDirectoryController = exports.BranchesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const public_decorator_js_1 = require("../common/decorators/public.decorator.js");
const directory_service_js_1 = require("../modules/doctors/directory.service.js");
let BranchesController = class BranchesController {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    branches() { return this.directory.branches(); }
    departments(branchId) { return this.directory.departments(branchId); }
};
exports.BranchesController = BranchesController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách cơ sở đang hoạt động' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BranchesController.prototype, "branches", null);
__decorate([
    (0, common_1.Get)(':branchId/departments'),
    (0, swagger_1.ApiOperation)({ summary: 'Chuyên khoa có bác sĩ tại cơ sở' }),
    __param(0, (0, common_1.Param)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BranchesController.prototype, "departments", null);
exports.BranchesController = BranchesController = __decorate([
    (0, public_decorator_js_1.Public)(),
    (0, swagger_1.ApiTags)('Branches'),
    (0, common_1.Controller)('branches'),
    __metadata("design:paramtypes", [directory_service_js_1.DirectoryService])
], BranchesController);
let PublicDirectoryController = class PublicDirectoryController {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    navigation() { return this.directory.publicNavigation(); }
    specialtyServices(branchId, specialtyId) {
        return this.directory.specialtyServices(branchId, Number(specialtyId));
    }
    healthPackages(branchId) { return this.directory.healthPackages(branchId); }
    bookingMethods(branchId) { return this.directory.bookingMethods(branchId); }
};
exports.PublicDirectoryController = PublicDirectoryController;
__decorate([
    (0, common_1.Get)('navigation'),
    (0, swagger_1.ApiOperation)({ summary: 'Danh mục công khai dùng cho menu website bệnh nhân' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PublicDirectoryController.prototype, "navigation", null);
__decorate([
    (0, common_1.Get)('specialty-services'),
    (0, swagger_1.ApiOperation)({ summary: 'Dịch vụ khám bắt buộc theo chi nhánh và chuyên khoa' }),
    __param(0, (0, common_1.Query)('branchId')),
    __param(1, (0, common_1.Query)('specialtyId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PublicDirectoryController.prototype, "specialtyServices", null);
__decorate([
    (0, common_1.Get)('health-packages'),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách gói khám sức khỏe công khai' }),
    __param(0, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PublicDirectoryController.prototype, "healthPackages", null);
__decorate([
    (0, common_1.Get)('booking-methods'),
    (0, swagger_1.ApiOperation)({ summary: 'Hình thức đặt khám đang bật tại một chi nhánh' }),
    __param(0, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PublicDirectoryController.prototype, "bookingMethods", null);
exports.PublicDirectoryController = PublicDirectoryController = __decorate([
    (0, public_decorator_js_1.Public)(),
    (0, swagger_1.ApiTags)('Public directory'),
    (0, common_1.Controller)('public'),
    __metadata("design:paramtypes", [directory_service_js_1.DirectoryService])
], PublicDirectoryController);
let DoctorsController = class DoctorsController {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    doctors(branchId, departmentId) {
        return this.directory.doctors(branchId, departmentId ? Number(departmentId) : undefined);
    }
    availableDates(doctorId, branchId) {
        return this.directory.availableDates(doctorId, branchId);
    }
    timeslots(doctorId, branchId, date) {
        return this.directory.timeslots(doctorId, branchId, date);
    }
};
exports.DoctorsController = DoctorsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Danh sách bác sĩ theo cơ sở/chuyên khoa' }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'departmentId', required: false, type: Number }),
    __param(0, (0, common_1.Query)('branchId')),
    __param(1, (0, common_1.Query)('departmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], DoctorsController.prototype, "doctors", null);
__decorate([
    (0, common_1.Get)(':doctorId/available-dates'),
    (0, swagger_1.ApiOperation)({ summary: 'Các ngày bác sĩ còn khung giờ khả dụng' }),
    (0, swagger_1.ApiQuery)({ name: 'branchId' }),
    __param(0, (0, common_1.Param)('doctorId')),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], DoctorsController.prototype, "availableDates", null);
__decorate([
    (0, common_1.Get)(':doctorId/timeslots'),
    (0, swagger_1.ApiOperation)({ summary: 'Khung giờ và số chỗ còn lại theo ngày' }),
    (0, swagger_1.ApiQuery)({ name: 'branchId' }),
    (0, swagger_1.ApiQuery)({ name: 'date', example: '2026-08-10' }),
    __param(0, (0, common_1.Param)('doctorId')),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], DoctorsController.prototype, "timeslots", null);
exports.DoctorsController = DoctorsController = __decorate([
    (0, public_decorator_js_1.Public)(),
    (0, swagger_1.ApiTags)('Doctors'),
    (0, common_1.Controller)('doctors'),
    __metadata("design:paramtypes", [directory_service_js_1.DirectoryService])
], DoctorsController);
//# sourceMappingURL=doctors.controller.js.map