import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../../config/config.type';
import { AuthGoogleLoginDto } from './dtos/auth-google-login.dto';
import { SocialType } from '../../../common/utils/social.type';
import { IAuthGoogleService } from './auth-google';
export declare class AuthGoogleService implements IAuthGoogleService {
    private configService;
    private google;
    constructor(configService: ConfigService<AllConfigType>);
    getProfileByToken(loginDto: AuthGoogleLoginDto): Promise<SocialType>;
}
