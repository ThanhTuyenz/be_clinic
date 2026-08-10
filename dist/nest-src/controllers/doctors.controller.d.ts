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
    homepage(branchId?: string): Promise<{
        selectedBranch: {
            name: string;
            id: string;
            address: string;
            phoneNumber: string;
            code: string;
        };
        branches: {
            name: string;
            id: string;
            address: string;
            phoneNumber: string;
            code: string;
        }[];
        departments: {
            name: string;
            id: number;
            specialties: {
                name: string;
                id: number;
            }[];
        }[];
        featuredDoctors: {
            branchAssignments: {
                branch: {
                    name: string;
                    id: string;
                    address: string;
                };
                isPrimary: boolean;
            }[];
            id: string;
            experienceYears: number;
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
            biography: string;
            ratingAverage: number;
            ratingCount: number;
            isFeatured: boolean;
        }[];
        healthPackages: {
            branchId: string;
            branchBookingMethodId: string;
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
            code: string;
            price: import("@prisma/client/runtime/library.js").Decimal;
        }[];
        bookingMethods: any[];
        stats: {
            doctorCount: number;
            branchCount: number;
            specialtyCount: number;
            reviewCount: number;
            averageRating: number;
        };
    }>;
    specialties(): import(".prisma/client").Prisma.PrismaPromise<{
        name: string;
        description: string;
        id: number;
        specialties: {
            name: string;
            description: string;
            id: number;
        }[];
    }[]>;
    specialtyServices(branchId: string, specialtyId: string): Promise<{
        branchId: string;
        branchBookingMethodId: string;
        bookingMethod: {
            name: string;
            id: string;
            code: string;
        };
        name: string;
        description: string;
        id: string;
        specialtyId: number;
        code: string;
        price: import("@prisma/client/runtime/library.js").Decimal;
        durationMin: number;
    }[]>;
    healthPackages(branchId?: string): Promise<{
        branchId: string;
        branchBookingMethodId: string;
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
        code: string;
        price: import("@prisma/client/runtime/library.js").Decimal;
    }[]>;
    bookingMethods(branchId: string): Promise<{
        bookingMethodId: string;
        type: string;
        code: string;
        displayName: string;
        description: string;
        route: string;
        id: string;
        sortOrder: number;
        branchId: string;
        isEnabled: boolean;
    }[]>;
}
export declare class DoctorsController {
    private readonly directory;
    constructor(directory: DirectoryService);
    doctors(branchId?: string, departmentId?: string, specialtyId?: string, q?: string): Promise<{
        branchAssignments: {
            branch: {
                name: string;
                id: string;
                address: string;
            };
            isPrimary: boolean;
        }[];
        id: string;
        experienceYears: number;
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
        biography: string;
        ratingAverage: number;
        ratingCount: number;
        isFeatured: boolean;
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
