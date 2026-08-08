"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCode = void 0;
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["AUTH_USER_NOT_FOUND"] = "AUTH_USER_NOT_FOUND";
    ErrorCode["AUTH_WRONG_PASSWORD"] = "AUTH_WRONG_PASSWORD";
    ErrorCode["AUTH_TOKEN_EXPIRED"] = "AUTH_TOKEN_EXPIRED";
    ErrorCode["AUTH_TOKEN_INVALID"] = "AUTH_TOKEN_INVALID";
    ErrorCode["AUTH_EMAIL_EXISTED"] = "AUTH_EMAIL_EXISTED";
    ErrorCode["PROGRAM_NOT_FOUND"] = "PROGRAM_NOT_FOUND";
    ErrorCode["SLIDE_NOT_FOUND"] = "SLIDE_NOT_FOUND";
    ErrorCode["LESSON_NOT_FOUND"] = "LESSON_NOT_FOUND";
    ErrorCode["GAME_NOT_FOUND"] = "GAME_NOT_FOUND";
    ErrorCode["GAME_MAX_ATTEMPTS_REACHED"] = "GAME_MAX_ATTEMPTS_REACHED";
    ErrorCode["GAME_TIME_EXCEEDED"] = "GAME_TIME_EXCEEDED";
    ErrorCode["GAME_INVALID_SLIDE_TYPE"] = "GAME_INVALID_SLIDE_TYPE";
    ErrorCode["GAME_NO_CONFIG"] = "GAME_NO_CONFIG";
    ErrorCode["GAME_UNSUPPORTED_TYPE"] = "GAME_UNSUPPORTED_TYPE";
    ErrorCode["BAD_REQUEST_VALIDATION"] = "BAD_REQUEST_VALIDATION";
    ErrorCode["UNAUTHORIZED_ACCESS"] = "UNAUTHORIZED_ACCESS";
    ErrorCode["FORBIDDEN_RESOURCE"] = "FORBIDDEN_RESOURCE";
    ErrorCode["RESOURCE_NOT_FOUND"] = "RESOURCE_NOT_FOUND";
    ErrorCode["INTERNAL_SERVER_ERROR"] = "INTERNAL_SERVER_ERROR";
    ErrorCode["TENANT_NOT_FOUND"] = "TENANT_NOT_FOUND";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
//# sourceMappingURL=error-code.enum.js.map