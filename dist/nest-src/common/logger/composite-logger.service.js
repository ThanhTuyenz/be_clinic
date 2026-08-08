"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeLogger = void 0;
const common_1 = require("@nestjs/common");
class CompositeLogger {
    winstonLogger;
    consoleLogger = new common_1.ConsoleLogger('Backend');
    constructor(winstonLogger) {
        this.winstonLogger = winstonLogger;
    }
    log(message, context) {
        this.consoleLogger.log(message, context);
        this.winstonLogger.log(message, context);
    }
    error(message, trace, context) {
        this.consoleLogger.error(message, trace, context);
        this.winstonLogger.error(message, trace, context);
    }
    warn(message, context) {
        this.consoleLogger.warn(message, context);
        this.winstonLogger.warn(message, context);
    }
    debug(message, context) {
        this.consoleLogger.debug(message, context);
        this.winstonLogger.debug?.(message, context);
    }
    verbose(message, context) {
        this.consoleLogger.verbose(message, context);
        this.winstonLogger.verbose?.(message, context);
    }
}
exports.CompositeLogger = CompositeLogger;
//# sourceMappingURL=composite-logger.service.js.map