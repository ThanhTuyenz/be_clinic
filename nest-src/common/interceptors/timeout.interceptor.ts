// common/interceptors/timeout.interceptor.ts

import {
  CallHandler,
  ExecutionContext,
  GatewayTimeoutException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import { Observable, TimeoutError } from 'rxjs';

import { catchError, timeout } from 'rxjs/operators';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs = 5000;

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    return next.handle().pipe(
      timeout(this.timeoutMs),

      catchError((error) => {
        if (error instanceof TimeoutError) {
          throw new GatewayTimeoutException(
            'Request timeout',
          );
        }

        throw error;
      }),
    );
  }
}