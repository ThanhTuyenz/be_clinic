"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDb = connectDb;
const mongoose_1 = __importDefault(require("mongoose"));
const seedRoles_js_1 = require("./seedRoles.js");
const seedDoctors_js_1 = require("./seedDoctors.js");
async function connectDb() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('Thiếu biến MONGODB_URI trong .env');
    }
    await mongoose_1.default.connect(uri);
    await (0, seedRoles_js_1.seedRoles)();
}
//# sourceMappingURL=db.js.map