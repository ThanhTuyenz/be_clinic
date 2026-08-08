import { LoggerService } from '@nestjs/common';
export declare class CompositeLogger implements LoggerService {
    private readonly winstonLogger;
    private readonly consoleLogger;
    constructor(winstonLogger: LoggerService);
    log(message: string, context?: string): void;
    error(message: string, trace?: string, context?: string): void;
    warn(message: string, context?: string): void;
    debug(message: string, context?: string): void;
    verbose(message: string, context?: string): void;
}
