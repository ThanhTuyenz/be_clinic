import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
export declare class LoggingInterceptor implements NestInterceptor {
    private readonly logger;
    private readonly SLOW_API_THRESHOLD;
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
    private sanitizeBody;
    private generateRequestId;
    private formatBytes;
}
