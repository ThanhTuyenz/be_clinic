declare const _default: mongoose.Model<{
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps, {}, {}, {}, mongoose.Document<unknown, {}, {
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps, {}, {
    timestamps: true;
}> & {
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}, mongoose.Schema<any, mongoose.Model<any, any, any, any, any, any>, {}, {}, {}, {}, {
    timestamps: true;
}, {
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps, mongoose.Document<unknown, {}, mongoose.FlatRecord<{
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps>, {}, mongoose.MergeType<mongoose.DefaultSchemaOptions, {
    timestamps: true;
}>> & mongoose.FlatRecord<{
    patientId: string;
    doctorId: string;
    appointmentDate: NativeDate;
    startTime: string;
    status: string;
    source: "online" | "clinic";
    note: string;
    cancelReason: string;
    clinicRoom: string;
    endTime?: string;
    createdByStaff?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
    };
    cancelledAt?: NativeDate;
    cancelledBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    confirmedAt?: NativeDate;
    confirmedBy?: {
        id?: string;
        displayName?: string;
        email?: string;
        userType?: string;
        role?: string;
    };
    visitQueueNumber?: number;
} & mongoose.DefaultTimestampProps> & {
    _id: mongoose.Types.ObjectId;
} & {
    __v: number;
}>>;
export default _default;
import mongoose from 'mongoose';
