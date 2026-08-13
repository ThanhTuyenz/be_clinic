import { ConsoleLogger, LoggerService } from '@nestjs/common';

export class CompositeLogger implements LoggerService {
  private readonly consoleLogger = new ConsoleLogger('Backend');

  constructor(private readonly winstonLogger: LoggerService) {}

  log(message: string, context?: string): void {
    this.consoleLogger.log(message, context);
    this.winstonLogger.log(message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.consoleLogger.error(message, trace, context);
    this.winstonLogger.error(message, trace, context);
  }

  warn(message: string, context?: string): void {
    this.consoleLogger.warn(message, context);
    this.winstonLogger.warn(message, context);
  }

  debug(message: string, context?: string): void {
    this.consoleLogger.debug(message, context);
    this.winstonLogger.debug?.(message, context);
  }

  verbose(message: string, context?: string): void {
    this.consoleLogger.verbose(message, context);
    this.winstonLogger.verbose?.(message, context);
  }
}
