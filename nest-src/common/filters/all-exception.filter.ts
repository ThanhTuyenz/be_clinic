// all-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<import('express').Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    this.logger.error({
      message: exception instanceof Error ? exception.message : 'Unknown error',
      status,
      stack: exception instanceof Error ? exception.stack : null,
      path: request.url,
      method: request.method,
    });
  }
}
