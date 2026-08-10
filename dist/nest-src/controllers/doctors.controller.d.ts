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
export declare class PublicDirectoryController {
    private readonly directory;
    constructor(directory: DirectoryService);
    navigation(): Promise<{
        departments: {
            name: string;
            id: number;
            specialties: {
                name: string;
                id: number;
            }[];
        }[];
        branches: {
            name: string;
            id: string;
            address: string;
            phoneNumber: string;
            code: string;
        }[];
    }>;
    specialtyServices(branchId: string, specialtyId: string): import(".prisma/client").Prisma.PrismaPromise<{
        name: string;
        description: string;
        id: string;
        specialtyId: number;
        branchId: string;
        code: string;
        price: import("@prisma/client/runtime/library.js").Decimal;
        durationMin: number;
    }[]>;
    healthPackages(branchId?: string): import(".prisma/client").Prisma.PrismaPromise<{
        name: string;
        description: string;
        id: string;
        items: {
            medicalService: {
                name: string;
                id: string;
                code: string;
                category: import(".prisma/client").$Enums.MedicalServiceCategory;
            };
            quantity: number;
        }[];
        schedules: {
            id: string;
            capacity: number;
            room: {
                name: string;
                id: string;
                code: string;
            };
            examDate: Date;
        }[];
        branchId: string;
        code: string;
        price: import("@prisma/client/runtime/library.js").Decimal;
    }[]>;
    bookingMethods(branchId: string): import(".prisma/client").Prisma.PrismaPromise<{
        description: string;
        id: string;
        type: import(".prisma/client").$Enums.BookingMethodType;
        displayName: string;
        sortOrder: number;
        branchId: string;
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
