import type { Request, Response } from 'express';
export declare class AuthController {
    register(req: Request, res: Response): Promise<any>;
    startRegister(req: Request, res: Response): Promise<any>;
    verifyEmail(req: Request, res: Response): Promise<any>;
    completeRegister(req: Request, res: Response): Promise<any>;
    resendOtp(req: Request, res: Response): Promise<any>;
    login(req: Request, res: Response): Promise<any>;
    staffLogin(req: Request, res: Response): Promise<any>;
    me(req: Request, res: Response): Promise<any>;
    updateMe(req: Request, res: Response): Promise<any>;
}
