"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransformInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
let TransformInterceptor = class TransformInterceptor {
    intercept(context, next) {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        return next.handle().pipe((0, operators_1.map)((data) => {
            if (data instanceof common_1.StreamableFile) {
                return data;
            }
            if (this.isApiResponse(data)) {
                return data;
            }
            return {
                success: true,
                statusCode: response.statusCode || common_1.HttpStatus.OK,
                message: this.getSuccessMessage(response.statusCode),
                timestamp: new Date().toISOString(),
                path: request.originalUrl,
                data,
            };
        }));
    }
    isApiResponse(data) {
        return (data &&
            typeof data === 'object' &&
            'success' in data &&
            'statusCode' in data &&
            'data' in data);
    }
    getSuccessMessage(statusCode) {
        switch (statusCode) {
            case common_1.HttpStatus.OK:
                return 'Request successful';
            case common_1.HttpStatus.CREATED:
                return 'Resource created successfully';
            case common_1.HttpStatus.ACCEPTED:
                return 'Request accepted';
            case common_1.HttpStatus.NO_CONTENT:
                return 'No content';
            default:
                return 'Success';
        }
    }
};
exports.TransformInterceptor = TransformInterceptor;
exports.TransformInterceptor = TransformInterceptor = __decorate([
    (0, common_1.Injectable)()
], TransformInterceptor);
//# sourceMappingURL=transform.interceptor.js.map