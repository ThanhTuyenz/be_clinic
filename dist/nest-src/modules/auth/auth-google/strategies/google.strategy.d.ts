import { Profile, Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../../config/config.type';
import { IAuthService } from '../../auth-local/auth';
declare const GoogleStrategy_base: new (...args: [options: import("passport-google-oauth20").StrategyOptionsWithRequest] | [options: import("passport-google-oauth20").StrategyOptions] | [options: import("passport-google-oauth20").StrategyOptions] | [options: import("passport-google-oauth20").StrategyOptionsWithRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class GoogleStrategy extends GoogleStrategy_base {
    private readonly authService;
    private readonly configService;
    constructor(authService: IAuthService, configService: ConfigService<AllConfigType>);
    validate(accessToken: string, refreshToken: string, profile: Profile): Promise<Readonly<{
        token: string;
        refreshToken: string;
        tokenExpires: number;
        user: import("../../users/entities/user.entity").User;
    }>>;
}
export {};
