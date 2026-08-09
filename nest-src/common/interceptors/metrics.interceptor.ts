// common/interceptors/metrics.interceptor.ts

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsInterceptor
  implements NestInterceptor
{
  private readonly httpRequestsTotal: Counter<string>;

  private readonly httpRequestDuration: Histogram<string>;

  constructor() {
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route'],
    });
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest();

    const method = request.method;
    const route = request.route?.path || request.url;

    const endTimer =
      this.httpRequestDuration.startTimer({
        method,
        route,
      });

    return next.handle().pipe(
      tap({
        next: () => {
          const response =
            context.switchToHttp().getResponse();

          this.httpRequestsTotal.inc({
            method,
            route,
            status_code: response.statusCode,
          });

          endTimer();
        },

        error: () => {
          endTimer();
        },
      }),
    );
  }
}