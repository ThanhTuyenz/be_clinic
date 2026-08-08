import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './types/jwt-refresh-payload.type';
import { OrNeverType } from 'src/common/utils/types/or-never.type';
import { AllConfigType } from '../../../../config/config.type';
declare const JwtRefreshStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithoutRequest] | [opt: import("passport-jwt").StrategyOptionsWithRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtRefreshStrategy extends JwtRefreshStrategy_base {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService<AllConfigType>);
    validate(payload: JwtRefreshPayloadType): OrNeverType<JwtRefreshPayloadType>;
}
export {};
