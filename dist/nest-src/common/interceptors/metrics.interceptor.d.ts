import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
export declare class MetricsInterceptor implements NestInterceptor {
    private readonly httpRequestsTotal;
    private readonly httpRequestDuration;
    constructor();
    intercept(context: ExecutionContext, next: CallHandler): Observable<any>;
}
