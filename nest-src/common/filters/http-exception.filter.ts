import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ErrorCode } from '../constants/error-code.enum';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.getStatus() as unknown as HttpStatus;
    const exceptionResponse = exception.getResponse();

    let errorCode = this.getErrorCode(status);
    let message: unknown = exception.message;
    let errors: unknown = undefined;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resObj = exceptionResponse as Record<string, unknown>;

      if (typeof resObj.errorCode === 'string') {
        errorCode = resObj.errorCode;
      }

      if (resObj.message !== undefined) {
        message = resObj.message;
      }

      if (resObj.errors !== undefined) {
        errors = resObj.errors;
      }
    }

    // HttpException created with an object response but without `message`
    // defaults to the unhelpful text "Http Exception". Derive a useful
    // message from the validation/domain errors before sending it to clients.
    if (message === 'Http Exception') {
      message = this.getMessageFromErrors(errors) ?? this.getDefaultMessage(status);
    }

    response.status(status as number).json({
      statusCode: status as number,
      errorCode: errorCode,
      message: message,
      errors: errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private getMessageFromErrors(errors: unknown): string | undefined {
    if (typeof errors !== 'object' || errors === null) return undefined;

    const messages: Record<string, string> = {
      notFound: 'Không tìm thấy tài khoản với email này',
      inactive: 'Tài khoản chưa được kích hoạt',
      incorrectPassword: 'Mật khẩu không chính xác',
    };

    for (const value of Object.values(errors as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      if (value.startsWith('needLoginViaProvider:')) {
        const provider = value.split(':')[1];
        return `Tài khoản này cần đăng nhập bằng ${provider}`;
      }
      return messages[value] ?? value;
    }

    return undefined;
  }

  private getDefaultMessage(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Yêu cầu không hợp lệ';
      case HttpStatus.UNAUTHORIZED:
        return 'Thông tin đăng nhập không chính xác';
      case HttpStatus.FORBIDDEN:
        return 'Bạn không có quyền thực hiện thao tác này';
      case HttpStatus.NOT_FOUND:
        return 'Không tìm thấy tài nguyên';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'Dữ liệu không hợp lệ';
      default:
        return 'Đã xảy ra lỗi máy chủ';
    }
  }

  private getErrorCode(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST_VALIDATION;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED_ACCESS;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN_RESOURCE;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    console.error('Unhandled exception:', exception);

    response.status(500).json({
      statusCode: 500,
      errorCode: ErrorCode.INTERNAL_SERVER_ERROR,
      message: exception instanceof Error ? exception.message : 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
