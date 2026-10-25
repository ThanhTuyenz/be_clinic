import {
  HttpException,
  HttpStatus,
  ValidationError,
  ValidationPipeOptions,
} from '@nestjs/common';

function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const err of errors) {
    const propPath = parentPath ? `${parentPath}.${err.property}` : err.property;

    if (err.constraints) {
      result[propPath] = Object.values(err.constraints).join(', ');
    }

    if (err.children && err.children.length > 0) {
      Object.assign(result, formatValidationErrors(err.children, propPath));
    }
  }

  return result;
}

const validationOptions: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: (errors: ValidationError[]) => {
    const formatted = formatValidationErrors(errors);
    console.error('[ValidationPipe 422 Errors]:', JSON.stringify(formatted, null, 2));
    return new HttpException(
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: formatted,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  },
};

export default validationOptions;
