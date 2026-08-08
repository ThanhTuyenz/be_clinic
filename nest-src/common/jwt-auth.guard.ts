import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import jwt from 'jsonwebtoken'

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET trong .env cần ít nhất 16 ký tự.')
  }
  return secret
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: Record<string, unknown> }>()
    const header = request.headers.authorization

    if (!header || typeof header !== 'string') {
      throw new UnauthorizedException('Thiếu Authorization header.')
    }

    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Authorization header không hợp lệ.')
    }

    try {
      const decoded = jwt.verify(token, jwtSecret()) as {
        sub?: string
        userType?: string
        role?: string
      }

      if (!decoded?.sub) {
        throw new UnauthorizedException('Token không hợp lệ.')
      }

      request.user = {
        id: decoded.sub,
        userType: decoded.userType,
        role: decoded.role,
      }
      return true
    } catch {
      throw new UnauthorizedException('Token hết hạn hoặc không hợp lệ.')
    }
  }
}
