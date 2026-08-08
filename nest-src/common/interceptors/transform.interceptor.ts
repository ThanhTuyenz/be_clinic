import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { Request, Response } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const http = context.switchToHttp();

    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data: T) => {
        // Prevent wrapping file stream
        if (data instanceof StreamableFile) {
          return data;
        }

        // Prevent double wrapping
        if (this.isApiResponse(data)) {
          return data;
        }

        return {
          success: true,
          statusCode: response.statusCode || HttpStatus.OK,
          message: this.getSuccessMessage(response.statusCode),
          timestamp: new Date().toISOString(),
          path: request.originalUrl,
          data,
        };
      }),
    );
  }

  private isApiResponse(data: any): boolean {
    return (
      data &&
      typeof data === 'object' &&
      'success' in data &&
      'statusCode' in data &&
      'data' in data
    );
  }

  private getSuccessMessage(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.OK:
        return 'Request successful';

      case HttpStatus.CREATED:
        return 'Resource created successfully';

      case HttpStatus.ACCEPTED:
        return 'Request accepted';

      case HttpStatus.NO_CONTENT:
        return 'No content';

      default:
        return 'Success';
    }
  }
}