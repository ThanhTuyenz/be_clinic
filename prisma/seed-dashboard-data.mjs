import { createHash } from 'node:crypto';
import fs from 'node:fs';

const DAY = 86_400_000;
const uid = (key) => {
  const hex = createHash('sha256').update('vitacare-demo-v2:' + key).digest('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
};
export function demoDate(offset = 0, now = new Date()) {
  const vnDate = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(vnDate + 'T00:00:00Z').getTime() + offset * DAY);
}
const hour = (h, m = 0) => new Date(Date.UTC(1970, 0, 1, h, m));
const at = (date, hours) => new Date(date.getTime() + hours * 3_600_000);
const keyOf = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');

export const demoStaff = [
  ['admin@vitacare.local', 'Quản trị hệ thống', 'ADMIN', '0988100001', null],
  ['chain-manager@vitacare.local', 'Nguyễn Hoàng Minh', 'CHAIN_MANAGER', '0988100002', null],
  ['manager@vitacare.local', 'Trần Quốc Huy', 'BRANCH_MANAGER', '0988100003', 'VC-CENTRAL'],
  ['manager.east@vitacare.local', 'Lê Ngọc Anh', 'BRANCH_MANAGER', '0988100004', 'VC-EAST'],
  ['receptionist@vitacare.local', 'Tiếp nhận Đỗ Lan', 'RECEPTIONIST', '0988100005', 'VC-CENTRAL'],
  ['receptionist.east@vitacare.local', 'Tiếp nhận Phạm Thu Hà', 'RECEPTIONIST', '0988100006', 'VC-EAST'],
  ['receptionist.central2@vitacare.local', 'Tiếp nhận Nguyễn Bảo Trâm', 'RECEPTIONIST', '0988100007', 'VC-CENTRAL'],
  ['receptionist.east2@vitacare.local', 'Tiếp nhận Võ Minh Thư', 'RECEPTIONIST', '0988100008', 'VC-EAST'],
  ['manager.locked@vitacare.local', 'Quản lý dự phòng Nguyễn Đức Long', 'BRANCH_MANAGER', '0988100009', 'VC-EAST', 'LOCKED'],
  ['receptionist.locked@vitacare.local', 'Tiếp nhận Trần Mỹ Duyên', 'RECEPTIONIST', '0988100010', 'VC-CENTRAL', 'LOCKED'],
  ['receptionist.inactive@vitacare.local', 'Tiếp nhận nghỉ việc Lý Thanh Tâm', 'RECEPTIONIST', '0988100011', 'VC-EAST', 'INACTIVE'],
  ['patient.locked@vitacare.local', 'Bệnh nhân Nguyễn Hồng Phúc', 'PATIENT', '0988100012', null, 'LOCKED'],
  ['doctor.locked@vitacare.local', 'BS. Phạm Đức Khánh', 'DOCTOR', '0988100013', 'VC-CENTRAL', 'LOCKED'],
];

// Demo records only: all IDs/codes are deterministic; no provider calls or real messages.
export async function seedDashboardData(prisma, { passwordHash }) {
  const now = new Date();
  const branches = await prisma.branch.findMany({
    where: { code: { in: ['VC-CENTRAL', 'VC-EAST'] } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  if (branches.length !== 2) throw new Error('Cần seed đủ hai chi nhánh trước dữ liệu dashboard.');
  const branchMap = new Map(branches.map(b => [b.code, b]));
  const accounts = new Map();
  for (const [index, [email, fullName, role, phoneNumber, branchCode, state]] of demoStaff.entries()) {
    const isBlocked = state === 'LOCKED';
    const fields = { fullName, role, phoneNumber, status: state === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      isBlocked, blockedAt: isBlocked ? new Date(now.getTime() - DAY) : null,
      isDeleted: false, lastLoginAt: new Date(now.getTime() - (isBlocked ? DAY * 2 : (index + 1) * 180_000)) };
    const user = await prisma.user.upsert({
      where: { email }, update: fields,
      create: { email, ...fields, password: passwordHash, provider: 'EMAIL' },
    });
    accounts.set(email, user);
    if (branchCode) {
      const branchId = branchMap.get(branchCode).id;
      await prisma.userBranchAssignment.upsert({
        where: { userId_branchId: { userId: user.id, branchId } },
        update: { isPrimary: true }, create: { userId: user.id, branchId, isPrimary: true },
      });
    }
    if (role === 'RECEPTIONIST') {
      const data = { employeeCode: 'LT-DEMO-' + String(index).padStart(3, '0'), deskNumber: index % 2 ? 'Quầy 2' : 'Quầy 1', isActive: !isBlocked && state !== 'INACTIVE' };
      await prisma.receptionist.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
    }
    if (role === 'DOCTOR') {
      const data = { academicRank: 'Bác sĩ CKI', licenseNumber: 'DEMO-CCHN-LOCKED', experienceYears: 10,
        biography: 'Hồ sơ minh họa bác sĩ tạm khóa tài khoản, không phân công lịch trực.',
        consultationFee: 250000, onlineConsultationFee: 200000, isActive: false };
      await prisma.doctor.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
    }
  }

  const names = ['Nguyễn Minh Quân', 'Trần Ngọc Linh', 'Lê Văn Thành', 'Phạm Thanh Hương',
    'Võ Quốc Bảo', 'Đặng Thu Thảo', 'Bùi Anh Tuấn', 'Đỗ Hồng Nhung',
    'Ngô Đức Hải', 'Dương Thị Yến', 'Lý Minh Khoa', 'Hồ Ngọc Ánh',
    'Phan Gia Huy', 'Vũ Thanh Vân', 'Mai Trung Kiên', 'Tạ Bảo Ngọc'];
  for (let i = 0; i < names.length; i++) {
    const email = 'patient.demo' + String(i + 1).padStart(2, '0') + '@vitacare.local';
    const phoneNumber = '097400' + String(i + 1).padStart(4, '0');
    const userData = { fullName: names[i], phoneNumber, role: 'PATIENT', status: 'ACTIVE', isDeleted: false,
      lastLoginAt: new Date(now.getTime() - (i + 1) * 600_000) };
    const user = await prisma.user.upsert({ where: { email }, update: userData,
      create: { email, ...userData, password: passwordHash } });
    const nationalId = '079190' + String(i + 100001);
    const fields = {
      patientCode: 'BN-DEMO-' + String(i + 1).padStart(3, '0'),
      fullName: names[i], phoneNumber, nationalId, dateOfBirth: new Date(Date.UTC(1980 + i, i % 12, 10)),
      healthInsuranceNumber: 'GD47979' + String(31000000 + i), gender: i % 2 ? 'FEMALE' : 'MALE',
      provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh', districtCode: '760', districtName: 'Quận 1',
      wardCode: '26734', wardName: 'Phường Bến Thành', streetAddress: (20 + i) + ' Lê Lợi',
      address: (20 + i) + ' Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM',
      ethnicity: 'Kinh', nationality: 'Việt Nam', occupation: i % 2 ? 'Nhân viên văn phòng' : 'Kỹ sư',
      guardianName: 'Nguyễn Thanh Bình', guardianPhone: '0974999999', guardianRelationship: 'Người thân',
      bloodGroup: ['O+', 'A+', 'B+', 'AB+'][i % 4], allergies: 'Không ghi nhận',
      height: 158 + i, weight: 50 + i, medicalHistory: i % 3 ? 'Không ghi nhận bệnh mạn tính' : 'Theo dõi tăng huyết áp',
      relationshipToAccount: 'SELF', isMainProfile: true,
    };
    await prisma.patientProfile.upsert({ where: { accountId_nationalId: { accountId: user.id, nationalId } },
      update: fields, create: { accountId: user.id, ...fields } });
  }
  const lockedPatient = accounts.get('patient.locked@vitacare.local');
  const lockedProfile = { fullName: lockedPatient.fullName, phoneNumber: lockedPatient.phoneNumber, nationalId: '079190999999',
    patientCode: 'BN-DEMO-LOCK', dateOfBirth: new Date('1990-04-12'), gender: 'MALE',
    healthInsuranceNumber: 'GD4797931999999', provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh',
    districtCode: '760', districtName: 'Quận 1', wardCode: '26734', wardName: 'Phường Bến Thành',
    streetAddress: '88 Lê Lợi', address: '88 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM',
    ethnicity: 'Kinh', nationality: 'Việt Nam', occupation: 'Kinh doanh', guardianName: 'Nguyễn Thị Hoa',
    guardianPhone: '0974999998', guardianRelationship: 'Vợ', bloodGroup: 'O+', height: 170, weight: 65,
    allergies: 'Không ghi nhận', medicalHistory: 'Không ghi nhận', relationshipToAccount: 'SELF', isMainProfile: true };
  await prisma.patientProfile.upsert({
    where: { accountId_nationalId: { accountId: lockedPatient.id, nationalId: lockedProfile.nationalId } },
    update: lockedProfile, create: { accountId: lockedPatient.id, ...lockedProfile },
  });

  // Fill contact/session fields for original seed accounts, including every doctor.
  const allUsers = await prisma.user.findMany({ orderBy: { email: 'asc' },
    select: { id: true, email: true, fullName: true, phoneNumber: true, lastLoginAt: true } });
  for (const [i, user] of allUsers.entries()) {
    if (!user.email || !user.fullName) throw new Error('Tài khoản seed thiếu tên hoặc email: ' + user.id);
    await prisma.user.update({ where: { id: user.id }, data: {
      ...(!user.phoneNumber ? { phoneNumber: '098820' + String(i + 1).padStart(4, '0') } : {}),
      ...(!user.lastLoginAt ? { lastLoginAt: new Date(now.getTime() - (i + 1) * 60_000) } : {}),
    } });
  }

  const profiles = await prisma.patientProfile.findMany({
    where: { account: { isBlocked: false, status: 'ACTIVE' } },
    select: { id: true, accountId: true }, orderBy: { patientCode: 'asc' },
  });
  const doctors = await prisma.doctor.findMany({
    where: { isActive: true, user: { isBlocked: false, status: 'ACTIVE' } },
    select: { id: true, userId: true, consultationFee: true, user: { select: { email: true } } },
  });
  const doctorFixtures = JSON.parse(fs.readFileSync(new URL('./data/doctors.json', import.meta.url), 'utf8'));
  const fixturesByEmail = new Map(doctorFixtures.map(d => [d.email, d]));
  const rooms = await prisma.clinicRoom.findMany({ where: { isActive: true }, select: { id: true, code: true, branchId: true } });
  const method = await prisma.bookingMethod.findUniqueOrThrow({ where: { code: 'CONSULTATION' } });
  const touchedSlots = new Set();
  const todayScenarios = [
    ['CHECKED_IN', 'CASH'], ['CHECKED_IN', 'VIETQR'], ['COMPLETED', 'CASH'], ['COMPLETED', 'ONLINE'],
    ['CONFIRMED', 'ONLINE'], ['CONFIRMED', 'VIETQR'], ['HOLD', null], ['CANCELLED', null],
    ['NO_SHOW', 'ONLINE'], ['COMPLETED', 'POS_CARD'], ['HOLD', null], ['CONFIRMED', 'ONLINE'],
  ];
  let appointmentCount = 0;
  for (let offset = -60; offset <= 7; offset++) {
    const date = demoDate(offset, now);
    for (const [branchIndex, branch] of branches.entries()) {
      const eligible = doctors.filter(d => fixturesByEmail.get(d.user.email)?.branchCode === branch.code);
      if (!eligible.length) throw new Error('Không có bác sĩ cho ' + branch.code);
      // Today includes one sample per assigned doctor, plus all reception scenarios.
      const count = offset === 0 ? Math.max(12, eligible.length) : offset < 0 ? 4 : 3;
      for (let i = 0; i < count; i++) {
        const doctor = eligible[i % eligible.length];
        const fixture = fixturesByEmail.get(doctor.user.email);
        const roomCode = fixture.roomCode;
        const room = rooms.find(r => r.branchId === branch.id && r.code === roomCode);
        if (!room) throw new Error('Thiếu phòng ' + roomCode);
        const schedule = await prisma.doctorSchedule.upsert({
          where: { doctorId_branchId_workDate_startTime: { doctorId: doctor.id, branchId: branch.id, workDate: date, startTime: hour(8) } },
          update: {},
          create: { doctorId: doctor.id, branchId: branch.id, roomId: room.id, workDate: date,
            startTime: hour(8), endTime: hour(11, 30), slotDurationMin: 30, capacityPerSlot: 10 },
        });
        const slot = await prisma.doctorScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: hour(8, (i % 4) * 30) } },
          update: {},
          create: { scheduleId: schedule.id, startTime: hour(8, (i % 4) * 30), endTime: hour(8, (i % 4 + 1) * 30), capacity: 10 },
        });
        const [status, paymentMethod] = offset === 0 ? todayScenarios[i % todayScenarios.length]
          : offset > 0 ? ['CONFIRMED', 'ONLINE']
          : i === 3 && offset % 3 === 0 ? ['CANCELLED', null] : ['COMPLETED', ['CASH', 'VIETQR', 'ONLINE', 'POS_CARD'][(i + Math.abs(offset)) % 4]];
        const profile = profiles[(Math.abs(offset) * 3 + i + branchIndex) % profiles.length];
        const price = Number(doctor.consultationFee);
        const code = 'DEMO-' + branch.code.replace('VC-', '') + '-' + keyOf(date) + '-' + String(i + 1).padStart(2, '0');
        const online = paymentMethod === 'ONLINE';
        const receptionist = accounts.get(branch.code === 'VC-CENTRAL' ? 'receptionist@vitacare.local' : 'receptionist.east@vitacare.local');
        const visitAt = offset < 0 ? at(date, 2) : new Date(now.getTime() - 600_000 - i * 1000);
        const createdAt = offset > 0 ? new Date(now.getTime() - 2 * DAY) : at(date, -23);
        const paidAt = paymentMethod ? offset < 0 ? at(date, 1.5) : new Date(now.getTime() - 1_200_000 - i * 1000) : null;
        const checkedIn = status === 'CHECKED_IN' || status === 'COMPLETED';
        await prisma.$transaction(async tx => {
          let orderId = null;
          if (online) {
            const order = { accountId: profile.accountId, orderCode: 'ORD-' + code, status: 'PAID', totalAmount: price,
              createdAt, note: '[DEMO] Đặt lịch trực tuyến' };
            const saved = await tx.bookingOrder.upsert({ where: { orderCode: order.orderCode }, update: order, create: order });
            orderId = saved.id;
          }
          const fields = { bookingOrderId: orderId, patientProfileId: profile.id, branchId: branch.id,
            bookingMethodId: method.id, scheduleSlotId: slot.id, servicePrice: price, status,
            // Confirmed bookings already own a queue number before reception check-in.
            queueNumber: status === 'HOLD' ? null : i + 1, checkedInAt: checkedIn ? visitAt : null,
            checkedInById: checkedIn ? receptionist.id : null,
            holdExpiresAt: status === 'HOLD' ? new Date(now.getTime() + 2 * 3_600_000) : null,
            symptomsDescription: '[DEMO] ' + (i % 2 ? 'Tái tư vấn và theo dõi sức khỏe định kỳ' : 'Đặt lịch tư vấn chuyên khoa'),
            createdAt };
          const appt = await tx.appointment.upsert({ where: { bookingCode: code }, update: fields, create: { bookingCode: code, ...fields } });
          const invoiceFields = { appointmentId: appt.id, bookingOrderId: orderId, issuedBranchId: branch.id,
            subtotal: price, totalAmount: price, status: paymentMethod ? 'PAID' : status === 'CANCELLED' ? 'CANCELLED' : 'UNPAID',
            paidAt, createdAt };
          const invoice = await tx.invoice.upsert({ where: { appointmentId: appt.id }, update: invoiceFields, create: invoiceFields });
          const invoiceItemId = BigInt('0x' + createHash('sha256').update(code).digest('hex').slice(0, 13));
          const item = { invoiceId: invoice.id, description: '[DEMO] Phí tư vấn chuyên khoa', quantity: 1, unitPrice: price, amount: price };
          await tx.invoiceItem.upsert({ where: { id: invoiceItemId }, update: item, create: { id: invoiceItemId, ...item } });
          if (paymentMethod) {
            const payment = { invoiceId: invoice.id, provider: online ? 'DEMO_PAYOS' : 'DEMO_COUNTER',
              providerTransactionId: 'TXN-' + code, method: paymentMethod, amount: price, status: 'SUCCESS', paidAt,
              createdAt, rawPayload: { demo: true, channel: online ? 'WEB' : 'COUNTER', collectedBy: online ? null : receptionist.id } };
            await tx.paymentTransaction.upsert({ where: { idempotencyKey: 'IDEM-' + code }, update: payment,
              create: { idempotencyKey: 'IDEM-' + code, ...payment } });
          }
          await tx.appointmentStatusHistory.deleteMany({ where: { appointmentId: appt.id } });
          const histories = [{ appointmentId: appt.id, fromStatus: null, toStatus: 'HOLD',
            actorId: online ? profile.accountId : receptionist.id, reason: '[DEMO] Tạo lịch hẹn', createdAt }];
          if (status !== 'HOLD') histories.push({ appointmentId: appt.id, fromStatus: 'HOLD', toStatus: status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
            actorId: online ? profile.accountId : receptionist.id, reason: '[DEMO] Xác nhận lịch hẹn', createdAt: new Date(createdAt.getTime() + 60_000) });
          if (checkedIn) histories.push({ appointmentId: appt.id, fromStatus: 'CONFIRMED', toStatus: 'CHECKED_IN',
            actorId: receptionist.id, reason: '[DEMO] Tiếp nhận tại quầy', createdAt: visitAt });
          if (status === 'COMPLETED' || status === 'NO_SHOW') histories.push({ appointmentId: appt.id,
            fromStatus: status === 'COMPLETED' ? 'CHECKED_IN' : 'CONFIRMED', toStatus: status,
            actorId: status === 'COMPLETED' ? doctor.userId : receptionist.id,
            reason: '[DEMO] ' + (status === 'COMPLETED' ? 'Hoàn tất lượt tư vấn' : 'Bệnh nhân không đến'), createdAt: new Date(visitAt.getTime() + 60_000) });
          await tx.appointmentStatusHistory.createMany({ data: histories });
          const tokenHash = createHash('sha256').update('demo-ticket:' + code).digest('hex');
          const qr = { tokenHash, expiresAt: at(date, 24), usedAt: checkedIn ? visitAt : null };
          await tx.appointmentQrToken.upsert({ where: { appointmentId: appt.id }, update: qr, create: { appointmentId: appt.id, ...qr } });
        });
        touchedSlots.add(slot.id);
        appointmentCount++;
      }
    }
  }
  for (const id of touchedSlots) {
    const occupiedCount = await prisma.appointment.count({ where: { scheduleSlotId: id,
      status: { in: ['HOLD', 'PENDING_PAYMENT', 'BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_EXAMINATION', 'COMPLETED', 'NO_SHOW'] } } });
    const slot = await prisma.doctorScheduleSlot.findUniqueOrThrow({ where: { id }, select: { capacity: true } });
    const reserved = await prisma.appointment.aggregate({ where: { scheduleSlotId: id }, _max: { queueNumber: true } });
    await prisma.doctorScheduleSlot.update({ where: { id }, data: { occupiedCount,
      nextQueueNumber: (reserved._max.queueNumber || 0) + 1, slotStatus: occupiedCount >= slot.capacity ? 'FULL' : 'AVAILABLE' } });
  }

  // Audit examples are visibly labeled synthetic. No login or integration action is actually executed.
  const admin = accounts.get('admin@vitacare.local');
  const actions = ['DEMO_USER_LOGIN', 'DEMO_USER_CREATE', 'DEMO_USER_LOCK', 'DEMO_ROLE_UPDATE', 'DEMO_INTEGRATION_VERIFY'];
  await prisma.auditLog.deleteMany({ where: { action: { in: actions } } });
  await prisma.auditLog.createMany({ data: Array.from(accounts.values()).map((u, i) => ({
    actorId: i % 2 ? admin.id : u.id, action: actions[i % actions.length], targetType: 'USER',
    targetId: u.id, metadata: { demo: true, note: 'Nhật ký minh họa từ seed, không phải thao tác thực tế' },
    createdAt: new Date(now.getTime() - i * 180_000),
  })) });
  // Future availability prevents the real publisher from processing demo pending rows.
  for (const [i, status] of ['FAILED', 'FAILED', 'PENDING', 'PENDING', 'PUBLISHED'].entries()) {
    const fields = { aggregateType: 'DEMO', aggregateId: 'seed-dashboard', eventType: 'demo.system.health.' + i,
      payload: { demo: true, note: 'Sự kiện minh họa, không gửi thông báo' }, status,
      availableAt: new Date(now.getTime() + 3650 * DAY), attempts: status === 'FAILED' ? 3 : status === 'PUBLISHED' ? 1 : 0,
      lastError: status === 'FAILED' ? '[DEMO] Mô phỏng lỗi kết nối dịch vụ tích hợp' : null,
      publishedAt: status === 'PUBLISHED' ? now : null, createdAt: new Date(now.getTime() - i * 60_000) };
    await prisma.outboxEvent.upsert({ where: { id: uid('outbox-' + i) }, update: fields, create: { id: uid('outbox-' + i), ...fields } });
  }
  for (const [i, user] of allUsers.entries()) {
    const fields = { userId: user.id, title: '[DEMO] Chào mừng đến VitaCare',
      content: 'Dữ liệu minh họa đã sẵn sàng. Kiểm tra lịch làm việc và lịch hẹn tại chi nhánh của bạn.',
      type: 'SYSTEM', data: { demo: true }, isRead: i % 3 === 0, createdAt: now };
    await prisma.notification.upsert({ where: { id: uid('notification-' + user.email) },
      update: fields, create: { id: uid('notification-' + user.email), ...fields } });
  }
  console.log('✓ Dashboard demo: ' + appointmentCount + ' lịch hẹn, 60 ngày lịch sử + hôm nay + 7 ngày sắp tới.');
  console.log('✓ 2 quản lý cơ sở hoạt động, 4 lễ tân hoạt động, 4 tài khoản khóa, 1 tài khoản ngừng hoạt động.');
  console.log('✓ Doanh thu CASH / VIETQR / POS_CARD / ONLINE; nhật ký, thông báo và Outbox đều gắn nhãn DEMO.');
  return { appointmentCount };
}
