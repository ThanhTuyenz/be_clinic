import { Prisma } from '@prisma/client';

export const APPOINTMENT_BRANCH_FIELDS = { id: true, code: true, name: true, address: true, phoneNumber: true } as const;
export const RECEPTION_SLOT_LOCATION_SELECT = {
  receptionSchedule: { select: {
    branchId: true, servicePackageId: true, isActive: true,
    branch: { select: APPOINTMENT_BRANCH_FIELDS },
  } },
} satisfies Prisma.PackageReceptionSlotSelect;
export const APPOINTMENT_BRANCH_SELECT = {
  scheduleSlot: { select: { schedule: { select: { branchId: true, branch: { select: APPOINTMENT_BRANCH_FIELDS } } } } },
  receptionSlot: { select: RECEPTION_SLOT_LOCATION_SELECT },
} satisfies Prisma.AppointmentSelect;

export function appointmentBranchWhere(branchId?: number | Prisma.IntFilter): Prisma.AppointmentWhereInput {
  if (branchId === undefined) return {};
  return { OR: [
    { scheduleSlot: { schedule: { branchId } } },
    { receptionSlot: { receptionSchedule: { branchId } } },
  ] };
}

type BranchInfo = { id?: number; code?: string; name?: string; address?: string; phoneNumber?: string };
export type AppointmentLocation = {
  scheduleSlot?: { schedule?: { branchId?: number; branch?: BranchInfo | null } } | null;
  receptionSlot?: { receptionSchedule?: { branchId?: number; branch?: BranchInfo | null } | null } | null;
};

export function appointmentBranchId(row: AppointmentLocation): number {
  const id = row.receptionSlot?.receptionSchedule?.branchId ?? row.scheduleSlot?.schedule?.branchId
    ?? row.receptionSlot?.receptionSchedule?.branch?.id ?? row.scheduleSlot?.schedule?.branch?.id;
  if (id === undefined) throw new Error('Appointment must reference exactly one slot with a branch');
  return id;
}

export function appointmentBranch(row: AppointmentLocation): BranchInfo {
  const branch = row.receptionSlot?.receptionSchedule?.branch ?? row.scheduleSlot?.schedule?.branch;
  if (!branch) throw new Error('Appointment branch must be selected through its slot');
  return branch;
}

// Retain the API's branch/branchId fields without storing them on Appointment.
export function withAppointmentBranch<T extends AppointmentLocation>(row: T) {
  const branch = row.receptionSlot?.receptionSchedule?.branch ?? row.scheduleSlot?.schedule?.branch;
  return { ...row, branchId: appointmentBranchId(row), branch };
}
