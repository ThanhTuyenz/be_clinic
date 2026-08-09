import { AuthConfig } from './config.type';
export declare function ttlToMilliseconds(value: string): number;
declare const _default: import("@nestjs/config").ConfigFactory<AuthConfig> & import("@nestjs/config").ConfigFactoryKeyHost<AuthConfig | Promise<AuthConfig>>;
export default _default;
