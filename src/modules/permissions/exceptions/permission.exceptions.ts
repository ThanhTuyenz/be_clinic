import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';

export enum PermissionErrorCode {
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  INVALID_RESOURCE_ID = 'INVALID_RESOURCE_ID',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  MISSING_PERMISSION_DEFINITION = 'MISSING_PERMISSION_DEFINITION',
}

export class InsufficientPermissionsException extends ForbiddenException {
  constructor(
    public readonly resourceType: string,
    public readonly action: string,
    public readonly resourceTarget: string,
  ) {
    super({
      statusCode: HttpStatus.FORBIDDEN,
      error: PermissionErrorCode.INSUFFICIENT_PERMISSIONS,
      message: `Insufficient permissions to ${action} ${resourceType}${resourceTarget !== '*' ? ` with id ${resourceTarget}` : ''}`,
      details: {
        resourceType,
        action,
        resourceTarget,
      },
    });
  }
}

export class ResourceNotFoundException extends HttpException {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        error: PermissionErrorCode.RESOURCE_NOT_FOUND,
        message: `Resource ${resourceType} with id ${resourceId} not found`,
        details: {
          resourceType,
          resourceId,
        },
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class InvalidResourceIdException extends HttpException {
  constructor(
    public readonly resourceId: string,
    public readonly reason: string,
  ) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: PermissionErrorCode.INVALID_RESOURCE_ID,
        message: `Invalid resource id: ${reason}`,
        details: {
          resourceId,
          reason,
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class MissingPermissionDefinitionException extends HttpException {
  constructor(
    public readonly method: string,
    public readonly url: string,
  ) {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: PermissionErrorCode.MISSING_PERMISSION_DEFINITION,
        message: `Missing permission definition for ${method} ${url}`,
        details: {
          method,
          url,
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
