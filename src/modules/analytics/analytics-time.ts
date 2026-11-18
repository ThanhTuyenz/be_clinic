const OFFSET = 7 * 3600_000;
export const vietnamDateKey = (date: Date) => new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);
export function analyticsRange(filter: { timeFilter?: string; startDate?: string; endDate?: string }, now = new Date()) {
  const today = vietnamDateKey(now);
  const days = filter.timeFilter === 'today' ? 1 : ['week', '7days'].includes(filter.timeFilter || '') ? 7
    : filter.timeFilter === 'quarter' ? 90 : 30;
  const endKey = filter.endDate || today;
  const startKey = filter.startDate || vietnamDateKey(new Date(new Date(`${today}T00:00:00+07:00`).getTime() - (days - 1) * 86400_000));
  const start = new Date(`${startKey}T00:00:00+07:00`);
  const end = new Date(new Date(`${endKey}T00:00:00+07:00`).getTime() + 86400_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('Khoảng ngày không hợp lệ');
  return { start, end, startKey, endKey };
}
