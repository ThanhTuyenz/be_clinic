import { DirectoryService } from '../modules/doctors/directory.service.js';
export declare class BranchesController {
    private readonly directory;
    constructor(directory: DirectoryService);
    branches(): import(".prisma/client").Prisma.PrismaPromise<{
        name: string;
        id: string;
        address: string;
        phoneNumber: string;
        code: string;
        timezone: string;
    }[]>;
    departments(branchId: string): import(".prisma/client").Prisma.PrismaPromise<{
        name: string;
        description: string;
        id: number;
    }[]>;
}
export declare class DoctorsController {
    private readonly directory;
    constructor(directory: DirectoryService);
    doctors(branchId?: string, departmentId?: string): Promise<{
        branchAssignments: {
            branch: {
                name: string;
                id: string;
            };
            isPrimary: boolean;
        }[];
        id: string;
        consultationFee: import("@prisma/client/runtime/library.js").Decimal;
        specialties: {
            specialty: {
                name: string;
                id: number;
            };
            isPrimary: boolean;
        }[];
        department: {
            name: string;
            id: number;
        };
        fullName: string;
        academicRank: string;
    }[]>;
    availableDates(doctorId: string, branchId: string): Promise<string[]>;
    timeslots(doctorId: string, branchId: string, date: string): Promise<{
        startTime: string;
        endTime: string;
        remainingCapacity: number;
        isAvailable: boolean;
        id: string;
        capacity: number;
        occupiedCount: number;
    }[]>;
}
