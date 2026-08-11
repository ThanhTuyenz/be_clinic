import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator.js'
import { SKIP_PERMISSIONS_KEY } from '../../modules/permissions/decorators/skip-permissions.decorator.js'

type RequestUser = {
  role?: string
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) {
      return true
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user as RequestUser | undefined

    return Boolean(user?.role && requiredRoles.includes(user.role))
  }
}
