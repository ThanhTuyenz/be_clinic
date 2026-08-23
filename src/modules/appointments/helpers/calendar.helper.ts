/**
 * Helper sinh Google Calendar URL và file .ics
 * cho lịch hẹn khám bệnh.
 */

export interface AppointmentCalendarData {
  appointmentId: string;
  bookingCode?: string | null;
  patientName: string;
  doctorName?: string | null;
  serviceName?: string | null;
  branchName: string;
  branchAddress?: string | null;
  appointmentDate: string; // YYYY-MM-DD
  startTime: string;       // HH:MM (UTC)
  endTime: string;         // HH:MM (UTC)
  medicalNote?: string;    // Hướng dẫn y tế (nhịn ăn, mang giấy tờ...)
}

/**
 * Chuyển YYYY-MM-DD + HH:MM → chuỗi iCalendar timestamp (UTC)
 * VD: "20260820T013000Z"
 */
function toICalDateTime(date: string, time: string): string {
  // time là HH:MM UTC (đã lưu UTC trong DB)
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00Z`;
}

/**
 * Sinh Google Calendar URL cho nút "Thêm vào lịch"
 * https://calendar.google.com/calendar/render?action=TEMPLATE&...
 */
export function buildGoogleCalendarUrl(data: AppointmentCalendarData): string {
  const title = data.doctorName
    ? `Khám với ${data.doctorName}`
    : data.serviceName
      ? `Khám: ${data.serviceName}`
      : 'Lịch khám bệnh';

  const details = [
    `Mã đặt lịch: ${data.bookingCode ?? data.appointmentId}`,
    data.patientName ? `Bệnh nhân: ${data.patientName}` : '',
    data.medicalNote ? `\n📋 Lưu ý: ${data.medicalNote}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const startDt = toICalDateTime(data.appointmentDate, data.startTime);
  const endDt = toICalDateTime(data.appointmentDate, data.endTime);
  const location = [data.branchName, data.branchAddress].filter(Boolean).join(', ');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startDt}/${endDt}`,
    details,
    location,
    sf: 'true',
    output: 'xml',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Sinh nội dung file .ics (RFC 5545) để tải về
 */
export function buildIcsContent(data: AppointmentCalendarData): string {
  const title = data.doctorName
    ? `Khám với ${data.doctorName}`
    : data.serviceName
      ? `Khám: ${data.serviceName}`
      : 'Lịch khám bệnh';

  const description = [
    `Mã đặt lịch: ${data.bookingCode ?? data.appointmentId}`,
    `Bệnh nhân: ${data.patientName}`,
    data.doctorName ? `Bác sĩ: ${data.doctorName}` : '',
    data.serviceName ? `Dịch vụ: ${data.serviceName}` : '',
    data.medicalNote ? `Lưu ý y tế: ${data.medicalNote}` : '',
  ]
    .filter(Boolean)
    .join('\\n');

  const startDt = toICalDateTime(data.appointmentDate, data.startTime);
  const endDt = toICalDateTime(data.appointmentDate, data.endTime);
  const location = [data.branchName, data.branchAddress].filter(Boolean).join(', ');
  const uid = `${data.appointmentId}@vitacare.clinic`;
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VitaCare Clinic//SmartBooking//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${startDt}`,
    `DTEND:${endDt}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Nhắc nhở: ${title} sắp diễn ra trong 2 giờ nữa`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT1440M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Nhắc nhở: ${title} vào ngày mai`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
