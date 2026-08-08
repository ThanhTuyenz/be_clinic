export function isValidIsoDateOnly(s: any): boolean;
export function isValidHHmm(s: any): boolean;
export function buildSlotTimesFromRange(startTime: any, endTime: any, slotMinutes?: number): string[];
export function findDoctorSchedulesForDate(db: any, doctorId: any, dateStr: any): Promise<any>;
export function findDoctorScheduleDateKeys(db: any, doctorId: any, fromStr: any, toStr: any): Promise<any[]>;
export function loadShiftMap(db: any, shiftIds: any): Promise<Map<any, any>>;
export function computeAvailabilityFromSchedule({ db, doctorId, dateStr, bookedSet, now }: {
    db: import("mongodb").Db;
    doctorId: string;
    dateStr: string;
    bookedSet: Set<string>;
    now?: Date;
}): Promise<{
    slots: any[];
    shifts: {
        shiftID: string;
        name: string;
        startTime: string;
        endTime: string;
        slots: string[];
    }[];
    hasSchedule: boolean;
}>;
export const DEFAULT_SLOT_MINUTES: 12;
