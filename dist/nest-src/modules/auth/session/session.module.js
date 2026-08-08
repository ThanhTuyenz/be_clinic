"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionModule = void 0;
const common_1 = require("@nestjs/common");
const session_service_1 = require("./session.service");
const typeorm_1 = require("@nestjs/typeorm");
const constants_1 = require("../../../common/utils/constants");
const session_entity_1 = require("./entities/session.entity");
let SessionModule = class SessionModule {
};
exports.SessionModule = SessionModule;
exports.SessionModule = SessionModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([session_entity_1.Session])],
        providers: [
            {
                provide: constants_1.Services.SESSION,
                useClass: session_service_1.SessionService,
            },
        ],
        exports: [
            {
                provide: constants_1.Services.SESSION,
                useClass: session_service_1.SessionService,
            },
        ],
    })
], SessionModule);
//# sourceMappingURL=session.module.js.map