import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class DatabaseModule implements OnModuleInit {
    private readonly configService;
    constructor(configService: ConfigService);
    onModuleInit(): Promise<void>;
}
