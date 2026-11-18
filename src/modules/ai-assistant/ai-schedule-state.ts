import { CLINIC_SESSION_WINDOWS } from '../../common/constants/clinic-sessions.js';

export const SCHEDULE_METHODS = ['CONSULTATION', 'ONLINE_CONSULTATION', 'SPECIALTY_EXAM', 'AFTER_HOURS'] as const;

export interface ScheduleState {
  branchId: number | null;
  servicePackageId: number | null;
  doctorId: string | null;
  bookingMethodCode: typeof SCHEDULE_METHODS[number] | null;
  date: string | null;
  earliestDate: boolean;
  period: 'MORNING' | 'AFTERNOON' | 'EVENING' | null;
  startTime: string | null;
  packageQuery: string | null;
  doctorQuery: string | null;
  pending?: 'SERVICE' | 'BRANCH' | 'METHOD' | 'DATE';
}

const nullableText = { type: ['string', 'null'] };
export const SCHEDULE_PROPERTIES = {
  branchId: { type: ['integer', 'null'], minimum: 1 }, servicePackageId: { type: ['integer', 'null'], minimum: 1 }, doctorId: nullableText,
  bookingMethodCode: { type: ['string', 'null'], enum: [...SCHEDULE_METHODS, null] },
  date: nullableText,
  earliestDate: { type: 'boolean' },
  period: { type: ['string', 'null'], enum: ['MORNING', 'AFTERNOON', 'EVENING', null] },
  startTime: nullableText, packageQuery: nullableText, doctorQuery: nullableText,
};

export function scheduleTimeLabel(schedule: ScheduleState): string {
  const periods = { MORNING: 'buổi sáng', AFTERNOON: 'buổi chiều', EVENING: 'buổi tối' };
  const window = schedule.period && CLINIC_SESSION_WINDOWS[schedule.period];
  return [
    schedule.period && `${periods[schedule.period]} (${window!.start}–${window!.end})`,
    schedule.startTime && `lúc ${schedule.startTime}`,
    schedule.date && `ngày ${new Date(schedule.date + 'T00:00:00+07:00').toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    schedule.earliestDate && 'ngày còn lịch sớm nhất',
  ].filter(Boolean).join(' ');
}

export function isScheduleState(value: unknown): value is ScheduleState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ScheduleState;
  const fields = value as Record<string, unknown>;
  if (typeof state.earliestDate !== 'boolean') return false;
  if (!['branchId', 'servicePackageId'].every(key => key in fields && (fields[key] === null || (typeof fields[key] === 'number' && Number.isInteger(fields[key]) && fields[key] > 0)))) return false;
  if (!Object.keys(SCHEDULE_PROPERTIES).filter(key => !['earliestDate', 'branchId', 'servicePackageId'].includes(key)).every(key => key in fields
    && (fields[key] === null || (typeof fields[key] === 'string'
      && fields[key].length > 0 && fields[key].length <= 200)))) return false;
  return (state.bookingMethodCode === null || SCHEDULE_METHODS.includes(state.bookingMethodCode))
    && (state.period === null || ['MORNING', 'AFTERNOON', 'EVENING'].includes(state.period))
    && (state.date === null || /^\d{4}-\d{2}-\d{2}$/.test(state.date))
    && !(state.date && state.earliestDate)
    && (state.startTime === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(state.startTime))
    && !(state.doctorId && state.servicePackageId)
    && !(state.doctorId && state.packageQuery)
    && !(state.servicePackageId && state.doctorQuery)
    && !(state.doctorQuery && state.packageQuery);
}

