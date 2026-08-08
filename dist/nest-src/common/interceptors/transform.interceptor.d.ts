import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiResponse } from '../interfaces/api-response.interface';
export declare class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T>;
    private isApiResponse;
    private getSuccessMessage;
}
