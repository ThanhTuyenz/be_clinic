import { BadRequestException } from '@nestjs/common';

export const MAX_BOOKING_DAYS = 60;

export function onlineBookingDateRange(daysForward = 30, now = new Date()) {
  const horizon = Math.min(Math.max(Number(daysForward) || 30, 7), MAX_BOOKING_DAYS);
  const nowVn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const [year, month, day] = nowVn.toISOString().slice(0, 10).split('-').map(Number);
  const minLeadDays = nowVn.getUTCHours() > 16 || (nowVn.getUTCHours() === 16 && nowVn.getUTCMinutes() >= 30) ? 2 : 1;
  const minDate = new Date(Date.UTC(year, month - 1, day + minLeadDays));
  const maxDate = new Date(Date.UTC(year, month - 1, day + horizon));
  const earliestDate = minDate.toISOString().slice(0, 10);
  const latestDate = maxDate.toISOString().slice(0, 10);
  const tomorrowLabel = new Date(Date.UTC(year, month - 1, day + 1)).toLocaleDateString('vi-VN', { timeZone: 'UTC' });
  const notice = (minLeadDays === 2
    ? 'Đã qua 16h30 nên không thể đặt lịch khám cho ngày mai (' + tomorrowLabel + ').'
    : 'Không thể đặt lịch khám trong ngày hôm nay.')
    + ' Bạn có thể chọn lịch từ ngày ' + minDate.toLocaleDateString('vi-VN', { timeZone: 'UTC' }) + '.';

  return {
    minDate, maxDate, notice,
    resolveDate(value: string) {
      const [year, month, day] = value.split('-').map(Number);
      const requestedDate = new Date(Date.UTC(year, month - 1, day));
      if (Number.isNaN(requestedDate.getTime()) || requestedDate.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('Ngày khám không hợp lệ');
      }
      if (requestedDate < minDate || requestedDate > maxDate) {
        throw new BadRequestException({
          code: 'BOOKING_DATE_OUT_OF_RANGE', earliestDate, latestDate,
          message: requestedDate < minDate ? notice
            : 'Chỉ có thể đặt lịch đến ngày ' + maxDate.toLocaleDateString('vi-VN', { timeZone: 'UTC' }) + '. Vui lòng chọn ngày trong khoảng cho phép.',
        });
      }
      return { requestedDate, endOfTargetDate: new Date(requestedDate.getTime() + 24 * 60 * 60 * 1000 - 1) };
    },
  };
}
