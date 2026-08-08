import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { OrNeverType } from 'src/common/utils/types/or-never.type';
import { AllConfigType } from '../../../../config/config.type';
import { JwtPayloadType } from './types/jwt-payload.type';
declare const JwtStrategy_base: new (...args: [opt: import("passport-jwt").StrategyOptionsWithoutRequest] | [opt: import("passport-jwt").StrategyOptionsWithRequest]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class JwtStrategy extends JwtStrategy_base {
    private configService;
    constructor(configService: ConfigService<AllConfigType>);
    validate(payload: JwtPayloadType): OrNeverType<JwtPayloadType>;
}
export {};
