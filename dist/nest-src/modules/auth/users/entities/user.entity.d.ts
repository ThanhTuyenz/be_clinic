import { ObjectId } from 'mongodb';
import { EntityHelper } from 'src/common/utils/entity-helper';
export declare enum UserStatus {
    Active = "active",
    Inactive = "inactive"
}
export declare enum UserRole {
    SuperAdmin = "super_admin",
    Admin = "admin",
    BranchManager = "branch_manager",
    Doctor = "doctor",
    Pharmacist = "pharmacist",
    Cashier = "cashier",
    Receptionist = "receptionist",
    Patient = "patient",
    Staff = "staff",
    User = "user"
}
export declare class User extends EntityHelper {
    _id: ObjectId;
    id: string;
    email: string | null;
    password: string;
    previousPassword: string;
    loadPreviousPassword(): void;
    setId(): void;
    setPassword(): Promise<void>;
    provider: string;
    status: UserStatus;
    role: UserRole;
    socialId: string | null;
    fullName: string | null;
    roleId: string | null;
    customPermissions: Array<{
        resourceType: string;
        action: string;
        resourceTarget: string;
        effect: string;
    }> | null;
    hash: string | null;
    emailOtpHash: string | null;
    emailOtpExpiresAt: Date | null;
    emailOtpLastSentAt: Date | null;
    emailOtpAttempts: number;
    isBlocked: boolean;
    blockedAt: Date | null;
    isDeleted: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    setCreatedAt(): void;
    setUpdatedAt(): void;
}
