declare const _default: mongoose.Model<{
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    email: string;
    emailVerified: boolean;
    emailOtpHash: string;
    emailOtpExpires: NativeDate;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
