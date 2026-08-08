"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggingInterceptor = void 0;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
let LoggingInterceptor = class LoggingInterceptor {
    logger = new common_1.Logger('HTTP');
    SLOW_API_THRESHOLD = 500;
    intercept(context, next) {
        const http = context.switchToHttp();
        const request = http.getRequest();
        const response = http.getResponse();
        const { method, originalUrl, ip, headers, query, body, } = request;
        const userAgent = headers['user-agent'] || 'unknown';
        const requestId = headers['x-request-id'] ||
            headers['x-correlation-id'] ||
            this.generateRequestId();
        const userId = request?.user?.id || 'anonymous';
        const startTime = Date.now();
        this.logger.log(JSON.stringify({
            type: 'REQUEST',
            requestId,
            method,
            url: originalUrl,
            ip,
            userId,
            userAgent,
            query,
            body: this.sanitizeBody(body),
            timestamp: new Date().toISOString(),
        }));
        return next.handle().pipe((0, operators_1.tap)(() => {
            const responseTime = Date.now() - startTime;
            const statusCode = response.statusCode;
            const contentLength = response.getHeader('content-length') || 0;
            const memoryUsage = process.memoryUsage();
            const logPayload = {
                type: 'RESPONSE',
                requestId,
                method,
                url: originalUrl,
                statusCode,
                responseTime: `${responseTime}ms`,
                contentLength,
                userId,
                memory: {
                    rss: this.formatBytes(memoryUsage.rss),
                    heapUsed: this.formatBytes(memoryUsage.heapUsed),
                },
                timestamp: new Date().toISOString(),
            };
            if (responseTime > this.SLOW_API_THRESHOLD) {
                this.logger.warn({
                    level: 'WARN',
                    message: 'SLOW_API',
                    ...logPayload,
                });
            }
            else {
                this.logger.log(logPayload);
            }
        }), (0, operators_1.catchError)((error) => {
            const responseTime = Date.now() - startTime;
            this.logger.error({
                type: 'ERROR',
                requestId,
                method,
                url: originalUrl,
                responseTime: `${responseTime}ms`,
                statusCode: error?.status || 500,
                message: error?.message,
                stack: error?.stack,
                timestamp: new Date().toISOString(),
            });
            throw error;
        }));
    }
    sanitizeBody(body) {
        if (!body || typeof body !== 'object') {
            return body;
        }
        const clonedBody = { ...body };
        const sensitiveFields = [
            'password',
            'confirmPassword',
            'accessToken',
            'refreshToken',
            'token',
            'secret',
        ];
        for (const field of sensitiveFields) {
            if (field in clonedBody) {
                clonedBody[field] = '******';
            }
        }
        return clonedBody;
    }
    generateRequestId() {
        return Math.random()
            .toString(36)
            .substring(2, 15);
    }
    formatBytes(bytes) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }
};
exports.LoggingInterceptor = LoggingInterceptor;
exports.LoggingInterceptor = LoggingInterceptor = __decorate([
    (0, common_1.Injectable)()
], LoggingInterceptor);
//# sourceMappingURL=logging.interceptor.js.map