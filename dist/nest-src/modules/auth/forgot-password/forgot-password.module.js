"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForgotPasswordModule = void 0;
const common_1 = require("@nestjs/common");
const forgot_password_service_1 = require("./forgot-password.service");
const typeorm_1 = require("@nestjs/typeorm");
const forgot_password_entity_1 = require("./entities/forgot-password.entity");
const constants_1 = require("../../../common/utils/constants");
let ForgotPasswordModule = class ForgotPasswordModule {
};
exports.ForgotPasswordModule = ForgotPasswordModule;
exports.ForgotPasswordModule = ForgotPasswordModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([forgot_password_entity_1.ForgotPassword])],
        providers: [
            {
                provide: constants_1.Services.FORGOT_PASSWORD,
                useClass: forgot_password_service_1.ForgotPasswordService,
            },
        ],
        exports: [
            {
                provide: constants_1.Services.FORGOT_PASSWORD,
                useClass: forgot_password_service_1.ForgotPasswordService,
            },
        ],
    })
], ForgotPasswordModule);
//# sourceMappingURL=forgot-password.module.js.map