export const REALTIME_EVENTS = {
  APPOINTMENT_BOOKED: 'appointment:booked',
  APPOINTMENT_STATUS_CHANGED: 'appointment:status_changed',
  QUEUE_CALLED: 'queue:called',
  CLINICAL_ORDER_UPDATED: 'clinical_order:updated',
  NOTIFICATION: 'notification:new',
} as const;

export const REALTIME_ROOMS = {
  RECEPTION: 'room:reception',
  BRANCH: (branchId: string) => `branch:${branchId}`,
  DOCTOR: (doctorId: string) => `doctor:${doctorId}`,
  ROOM: (roomId: string) => `clinic_room:${roomId}`,
} as const;
