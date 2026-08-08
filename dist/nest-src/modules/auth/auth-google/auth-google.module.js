"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGoogleModule = void 0;
const common_1 = require("@nestjs/common");
const auth_google_service_1 = require("./auth-google.service");
const auth_google_controller_1 = require("./auth-google.controller");
const auth_module_1 = require("../auth-local/auth.module");
const config_1 = require("@nestjs/config");
const constants_1 = require("../../../common/utils/constants");
const jwt_strategy_1 = require("../auth-local/strategies/jwt.strategy");
const google_strategy_1 = require("./strategies/google.strategy");
const passport_1 = require("@nestjs/passport");
let AuthGoogleModule = class AuthGoogleModule {
};
exports.AuthGoogleModule = AuthGoogleModule;
exports.AuthGoogleModule = AuthGoogleModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, config_1.ConfigModule, passport_1.PassportModule],
        providers: [
            jwt_strategy_1.JwtStrategy,
            google_strategy_1.GoogleStrategy,
            {
                provide: constants_1.Services.AUTH_GOOGLE,
                useClass: auth_google_service_1.AuthGoogleService,
            },
        ],
        exports: [
            {
                provide: constants_1.Services.AUTH_GOOGLE,
                useClass: auth_google_service_1.AuthGoogleService,
            },
        ],
        controllers: [auth_google_controller_1.AuthGoogleController],
    })
], AuthGoogleModule);
//# sourceMappingURL=auth-google.module.js.map