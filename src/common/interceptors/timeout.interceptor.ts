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
  private readonly timeoutMs = 15000;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const requestTimeoutMs =
      (Reflect.getMetadata('requestTimeoutMs', context.getHandler()) as number | undefined) ??
      (Reflect.getMetadata('requestTimeoutMs', context.getClass()) as number | undefined);

    const response = context.switchToHttp().getResponse<any>();
    // If headers are already sent for stream or timeout is explicitly disabled (0)
    if (response?.headersSent || requestTimeoutMs === 0) {
      return next.handle();
    }

    return next.handle().pipe(
      timeout(requestTimeoutMs ?? this.timeoutMs),
      catchError((error) => {
        if (error instanceof TimeoutError) {
          throw new GatewayTimeoutException('Request timeout');
        }
        throw error;
      }),
    );
  }
}
