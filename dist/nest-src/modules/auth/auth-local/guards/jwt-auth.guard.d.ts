import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IUsersService } from 'src/modules/auth/users/users';
export declare class JwtAuthGuard implements CanActivate {
    private readonly reflector;
    private readonly jwtService;
    private readonly usersService;
    private readonly logger;
    constructor(reflector: Reflector, jwtService: JwtService, usersService: IUsersService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
