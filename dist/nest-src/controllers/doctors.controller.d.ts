import { DirectoryService } from '../modules/doctors/directory.service.js';
export declare class BranchesController {
    private readonly directory;
    constructor(directory: DirectoryService);
    branches(): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        address: string;
        name: string;
        phoneNumber: string;
        code: string;
        timezone: string;
    }[]>;
    departments(branchId: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: number;
        name: string;
        description: string;
    }[]>;
}
export declare class DoctorsController {
    private readonly directory;
    constructor(directory: DirectoryService);
    doctors(branchId?: string, departmentId?: string): import(".prisma/client").Prisma.PrismaPromise<{
        department: {
            id: number;
            name: string;
        };
        id: string;
        fullName: string;
        academicRank: string;
        consultationFee: import("@prisma/client/runtime/library.js").Decimal;
        specialties: {
            specialty: {
                id: number;
                name: string;
            };
            isPrimary: boolean;
        }[];
        branchAssignments: {
            branch: {
                id: string;
                name: string;
            };
        }[];
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
