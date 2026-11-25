import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';

import { Observable } from 'rxjs';

import { catchError, tap } from 'rxjs/operators';

import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  private readonly SLOW_API_THRESHOLD = 500;

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();

    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const {
      method,
      originalUrl,
      ip,
      headers,
      query,
      body,
    } = request;

    const userAgent = headers['user-agent'] || 'unknown';

    const requestId =
      headers['x-request-id'] ||
      headers['x-correlation-id'] ||
      this.generateRequestId();

    const userId =
      (request as any)?.user?.id || 'anonymous';

    const startTime = Date.now();

    this.logger.log(
      JSON.stringify({
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
      }),
    );

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - startTime;

        const statusCode = response.statusCode;

        const contentLength =
          response.getHeader('content-length') || 0;

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
            heapUsed: this.formatBytes(
              memoryUsage.heapUsed,
            ),
          },
          timestamp: new Date().toISOString(),
        };

        if (
          responseTime > this.SLOW_API_THRESHOLD
        ) {
          this.logger.warn({
            level: 'WARN',
            message: 'SLOW_API',
            ...logPayload,
          });
        } else {
          this.logger.log(logPayload);
        }
      }),

      catchError((error) => {
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
      }),
    );
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const clonedBody = { ...(body as Record<string, unknown>) };

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

  private generateRequestId(): string {
    return Math.random()
      .toString(36)
      .substring(2, 15);
  }

  private formatBytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}