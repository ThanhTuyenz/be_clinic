import type { Prisma } from '@prisma/client';

/** Allocate the order's actual payment once, with deterministic rounding per member. */
export function allocateAppointmentPayment(
  amount: number,
  appointmentId: string,
  appointments: readonly { id: string; servicePrice: Prisma.Decimal | number }[],
): number | null {
  if (!Number.isFinite(amount) || amount < 0 || !appointments.some(item => item.id === appointmentId)) return null;
  if (appointments.length === 1) return amount;
  const members = [...appointments].sort((a, b) => a.id.localeCompare(b.id));
  if (members.some(item => item.servicePrice == null || !Number.isFinite(Number(item.servicePrice)) || Number(item.servicePrice) < 0)) return null;
  const weight = members.reduce((sum, item) => sum + Number(item.servicePrice), 0);
  if (weight <= 0) return null;
  let cumulative = 0;
  for (const member of members) {
    const previous = Math.round(amount * cumulative / weight);
    cumulative += Number(member.servicePrice);
    if (member.id === appointmentId) return Math.round(amount * cumulative / weight) - previous;
  }
  return null;
}
