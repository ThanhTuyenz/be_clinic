export const CLINIC_SESSIONS = [
  { code: 'MORNING', start: '07:30', end: '11:30' },
  { code: 'AFTERNOON', start: '13:30', end: '17:00' },
  { code: 'EVENING', start: '17:00', end: '20:30' },
] as const;

export const CLINIC_SESSION_WINDOWS = Object.fromEntries(
  CLINIC_SESSIONS.map(({ code, start, end }) => [code, { start, end }]),
) as Record<(typeof CLINIC_SESSIONS)[number]['code'], { start: string; end: string }>;

// Keep historical/custom slots visible, while using the same afternoon/evening boundaries.
export function clinicPeriod(start: string): (typeof CLINIC_SESSIONS)[number]['code'] {
  if (start >= CLINIC_SESSION_WINDOWS.EVENING.start) return 'EVENING';
  if (start >= CLINIC_SESSION_WINDOWS.AFTERNOON.start) return 'AFTERNOON';
  return 'MORNING';
}
