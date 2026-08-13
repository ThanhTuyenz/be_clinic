// all-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<import('express').Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    this.logger.error({
      message: exception instanceof Error ? exception.message : 'Unknown error',
      status,
      stack: exception instanceof Error ? exception.stack : null,
      path: request.url,
      method: request.method,
    });

    // A catch-all filter must always finish the response. Previously this
    // filter only logged non-HTTP errors, leaving requests open until the
    // client's 15-second Axios timeout expired.
    if (!response.headersSent) {
      response.status(status).json({
        statusCode: status,
        errorCode: status === HttpStatus.INTERNAL_SERVER_ERROR
          ? 'INTERNAL_SERVER_ERROR'
          : 'HTTP_ERROR',
        message: exception instanceof HttpException
          ? exception.message
          : 'Đã xảy ra lỗi máy chủ',
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }
  }
}
