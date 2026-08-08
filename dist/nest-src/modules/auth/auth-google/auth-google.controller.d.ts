import { IAuthService } from '../auth-local/auth';
export declare class AuthGoogleController {
    private readonly authService;
    constructor(authService: IAuthService);
    googleLogin(): Promise<void>;
    googleLoginCallback(req: any): Promise<Readonly<{
        token: string;
        refreshToken: string;
        tokenExpires: number;
        user: import("../users/entities/user.entity").User;
    }>>;
}
