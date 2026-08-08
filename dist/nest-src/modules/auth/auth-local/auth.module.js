"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const auth_service_1 = require("./auth.service");
const auth_controller_1 = require("./auth.controller");
const constants_1 = require("../../../common/utils/constants");
const users_module_1 = require("../users/users.module");
const session_module_1 = require("../session/session.module");
const passport_1 = require("@nestjs/passport");
const jwt_strategy_1 = require("./strategies/jwt.strategy");
const jwt_refresh_strategy_1 = require("./strategies/jwt-refresh.strategy");
const anonymous_strategy_1 = require("./strategies/anonymous.strategy");
const mails_module_1 = require("../../mails/mails.module");
const forgot_password_module_1 = require("../forgot-password/forgot-password.module");
const history_module_1 = require("../../history/history.module");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            users_module_1.UsersModule,
            session_module_1.SessionModule,
            mails_module_1.MailsModule,
            passport_1.PassportModule,
            forgot_password_module_1.ForgotPasswordModule,
            history_module_1.HistoryModule,
        ],
        controllers: [auth_controller_1.AuthController],
        providers: [
            jwt_refresh_strategy_1.JwtRefreshStrategy,
            jwt_strategy_1.JwtStrategy,
            anonymous_strategy_1.AnonymousStrategy,
            {
                provide: constants_1.Services.AUTH,
                useClass: auth_service_1.AuthService,
            },
        ],
        exports: [
            {
                provide: constants_1.Services.AUTH,
                useClass: auth_service_1.AuthService,
            },
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map