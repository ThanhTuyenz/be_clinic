import type { Prisma } from '@prisma/client';

export function reserveBookingSlot(tx: Prisma.TransactionClient, slotId: number) {
  return tx.$executeRaw`
    UPDATE "doctor_schedule_slots"
    SET "occupied_count" = "occupied_count" + 1, "updated_at" = NOW()
    WHERE "id" = ${slotId} AND "is_active" = TRUE
      AND "slot_status" = 'AVAILABLE' AND "occupied_count" < "capacity"
  `;
}
