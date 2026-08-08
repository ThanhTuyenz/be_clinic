declare const _default: mongoose.Model<{
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps, {}, {
    collection: string;
    timestamps: true;
}> & {
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    collection: string;
    timestamps: true;
}, {
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    collection: string;
    timestamps: true;
}>> & mongoose.FlatRecord<{
    description?: string;
    deptID?: string;
    deptName?: string;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
