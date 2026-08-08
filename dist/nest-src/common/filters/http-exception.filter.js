"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = exports.HttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const error_code_enum_1 = require("../constants/error-code.enum");
let HttpExceptionFilter = class HttpExceptionFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const status = exception.getStatus();
        const exceptionResponse = exception.getResponse();
        let errorCode = this.getErrorCode(status);
        let message = exception.message;
        let errors = undefined;
        if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
            const resObj = exceptionResponse;
            if (typeof resObj.errorCode === 'string') {
                errorCode = resObj.errorCode;
            }
            if (resObj.message !== undefined) {
                message = resObj.message;
            }
            if (resObj.errors !== undefined) {
                errors = resObj.errors;
            }
        }
        response.status(status).json({
            statusCode: status,
            errorCode: errorCode,
            message: message,
            errors: errors,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
    getErrorCode(status) {
        switch (status) {
            case common_1.HttpStatus.BAD_REQUEST:
                return error_code_enum_1.ErrorCode.BAD_REQUEST_VALIDATION;
            case common_1.HttpStatus.UNAUTHORIZED:
                return error_code_enum_1.ErrorCode.UNAUTHORIZED_ACCESS;
            case common_1.HttpStatus.FORBIDDEN:
                return error_code_enum_1.ErrorCode.FORBIDDEN_RESOURCE;
            case common_1.HttpStatus.NOT_FOUND:
                return error_code_enum_1.ErrorCode.RESOURCE_NOT_FOUND;
            default:
                return error_code_enum_1.ErrorCode.INTERNAL_SERVER_ERROR;
        }
    }
};
exports.HttpExceptionFilter = HttpExceptionFilter;
exports.HttpExceptionFilter = HttpExceptionFilter = __decorate([
    (0, common_1.Catch)(common_1.HttpException)
], HttpExceptionFilter);
let AllExceptionsFilter = class AllExceptionsFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        console.error('Unhandled exception:', exception);
        response.status(500).json({
            statusCode: 500,
            errorCode: error_code_enum_1.ErrorCode.INTERNAL_SERVER_ERROR,
            message: exception instanceof Error ? exception.message : 'Internal server error',
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
//# sourceMappingURL=http-exception.filter.js.map