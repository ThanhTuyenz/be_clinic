declare const _default: mongoose.Model<any, {}, {}, {}, any, any> | mongoose.Model<{
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
    collection: string;
}> & {
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
    collection: string;
}, {
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
    collection: string;
}>> & mongoose.FlatRecord<{
    name: string;
    specialty: string;
    avatar_url: string;
    rating: number;
    is_available: boolean;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
