import { Request, Response } from 'express';
import { IAuthService } from './auth';
import { AuthEmailLoginDto } from './dtos/auth-email-login.dto';
import { LoginResponseType } from './types/login-response.type';
import { AuthRegisterDto } from './dtos/auth-register.dto';
import { AuthConfirmEmailDto } from './dtos/auth-confirm-email.dto';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { User } from '../users/entities/user.entity';
import { AuthForgotPasswordDto } from './dtos/auth-forgot-password.dto';
import { AuthResetPasswordDto } from './dtos/auth-reset-password.dto';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from 'src/config/config.type';
export declare class AuthController {
    private readonly authService;
    private readonly configService;
    private readonly logger;
    constructor(authService: IAuthService, configService: ConfigService<AllConfigType>);
    private getCookieMaxAge;
    checkEmail(email: string): Promise<{
        isValid: boolean;
    }>;
    login(loginDto: AuthEmailLoginDto, res: Response): Promise<LoginResponseType>;
    register(createUserDto: AuthRegisterDto): Promise<void>;
    confirmEmail(confirmEmailDto: AuthConfirmEmailDto): Promise<void>;
    confirmEmailByHash(hash: string): Promise<void>;
    status(request: any): Promise<NullableType<User>>;
    forgotPassword(forgotPasswordDto: AuthForgotPasswordDto): Promise<void>;
    resetPassword(resetPasswordDto: AuthResetPasswordDto): Promise<void>;
    refresh(req: Request, res: Response, bodyRefreshToken?: string): Promise<Omit<LoginResponseType, 'user'>>;
    logout(request: Request, res: Response): Promise<void>;
}
