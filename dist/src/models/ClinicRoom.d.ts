declare const _default: mongoose.Model<{
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps, {}, {
    collection: string;
    timestamps: true;
}> & {
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    collection: string;
    timestamps: true;
}, {
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    collection: string;
    timestamps: true;
}>> & mongoose.FlatRecord<{
    name: string;
    isActive: boolean;
    roomID: string;
    building: string;
    floor: string;
    notes: string;
    sortOrder: number;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
