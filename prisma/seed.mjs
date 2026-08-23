import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const roles = [
  ['admin@vitacare.local', 'Quản trị hệ thống', 'ADMIN'],
  ['manager@vitacare.local', 'Quản lý cơ sở', 'BRANCH_MANAGER'],
  ['doctor.cardio@vitacare.local', 'BS. Nguyễn Minh Tâm', 'DOCTOR'],
  ['doctor.pediatrics@vitacare.local', 'BS. Trần Thu Hà', 'DOCTOR'],
  ['receptionist@vitacare.local', 'Tiếp nhận Đỗ Lan', 'RECEPTIONIST'],
  ['patient@vitacare.local', 'Nguyễn Văn An', 'PATIENT'],
  ['patient01@vitacare.local', 'Trần Thị Mai', 'PATIENT'],
  ['patient02@vitacare.local', 'Lê Hoàng Nam', 'PATIENT'],
  ['patient03@vitacare.local', 'Phạm Ngọc Anh', 'PATIENT'],
  ['patient04@vitacare.local', 'Võ Minh Khang', 'PATIENT'],
  ['patient05@vitacare.local', 'Đặng Thu Hương', 'PATIENT'],
];

const additionalPatientSeeds = [
  { email: 'patient01@vitacare.local', nationalId: '079198000101', dateOfBirth: '1988-03-12', gender: 'FEMALE', address: 'Quận 3, TP.HCM' },
  { email: 'patient02@vitacare.local', nationalId: '079199000102', dateOfBirth: '1992-07-25', gender: 'MALE', address: 'Quận Bình Thạnh, TP.HCM' },
  { email: 'patient03@vitacare.local', nationalId: '079200000103', dateOfBirth: '1995-11-08', gender: 'FEMALE', address: 'TP. Thủ Đức, TP.HCM' },
  { email: 'patient04@vitacare.local', nationalId: '079201000104', dateOfBirth: '1985-01-30', gender: 'MALE', address: 'Quận 7, TP.HCM' },
  { email: 'patient05@vitacare.local', nationalId: '079202000105', dateOfBirth: '1998-09-16', gender: 'FEMALE', address: 'Quận Gò Vấp, TP.HCM' },
];

function dateOnly(daysFromNow) {
  const localNow = new Date();
  return new Date(Date.UTC(localNow.getFullYear(), localNow.getMonth(), localNow.getDate() + daysFromNow));
}

function time(hour, minute = 0) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

function servicePackageSlots() {
  const slots = [];
  for (const [startHour, startMinute, endHour, endMinute] of [[8, 0, 11, 30], [13, 30, 16, 30]]) {
    let cursor = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    while (cursor < end) {
      slots.push({ startTime: time(Math.floor(cursor / 60), cursor % 60), endTime: time(Math.floor((cursor + 30) / 60), (cursor + 30) % 60), capacity: 7 });
      cursor += 30;
    }
  }
  return slots;
}

async function resetApplicationData() {
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  if (!tables.length) return;

  const identifiers = tables
    .map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
  console.log(`Reset completed: cleared ${tables.length} application tables.`);
}

async function main() {
  await resetApplicationData();
  const password = await bcrypt.hash('VitaCare@123', 10);
  const users = new Map();
  for (const [email, fullName, role] of roles) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { fullName, role, status: 'ACTIVE', isBlocked: false, isDeleted: false },
      create: { email, fullName, role, status: 'ACTIVE', provider: 'EMAIL', password },
    });
    users.set(email, user);
  }

  const clinic = await prisma.clinic.upsert({
    where: { slug: 'vitacare-clinic' },
    update: { name: 'VitaCare Clinic', isActive: true },
    create: { name: 'VitaCare Clinic', slug: 'vitacare-clinic' },
  });

  const branchInputs = [
    { code: 'VC-CENTRAL', name: 'VitaCare Trung tâm', address: 'Quận 1, TP.HCM' },
    { code: 'VC-EAST', name: 'VitaCare Cơ sở Đông', address: 'TP. Thủ Đức, TP.HCM' },
  ];
  const branches = [];
  for (const item of branchInputs) {
    branches.push(await prisma.branch.upsert({
      where: { code: item.code }, update: { ...item, clinicId: clinic.id }, create: { ...item, clinicId: clinic.id },
    }));
  }

  const bookingMethodSeeds = [
    ['SPECIALTY_EXAM', 'Đặt khám theo chuyên khoa', 'Chọn chuyên khoa, dịch vụ, bác sĩ và thời gian khám.', '/dat-lich?type=specialty', 1],
    ['HEALTH_PACKAGE', 'Gói khám sức khỏe', 'Đăng ký gói khám sức khỏe theo lịch của cơ sở.', '/dich-vu?view=health-packages', 2],
    ['CONSULTATION', 'Tư vấn khám bệnh', 'Tư vấn ban đầu với bác sĩ trước khi đặt lịch khám.', '/dat-lich?type=consultation', 3],
    ['AFTER_HOURS', 'Đặt khám ngoài giờ', 'Đặt lịch khám ngoài khung giờ hành chính.', '/dat-lich?type=after-hours', 4],
  ];
  const bookingMethods = new Map();
  for (const [code, name, description, route] of bookingMethodSeeds) {
    bookingMethods.set(code, await prisma.bookingMethod.upsert({
      where: { code },
      update: { name, description, route, isActive: true },
      create: { code, name, description, route },
    }));
  }
  for (const branch of branches) {
    for (const [code, , , , sortOrder] of bookingMethodSeeds) {
      const bookingMethod = bookingMethods.get(code);
      await prisma.branchBookingMethod.upsert({
        where: { branchId_bookingMethodId: { branchId: branch.id, bookingMethodId: bookingMethod.id } },
        update: { sortOrder, isEnabled: true },
        create: { branchId: branch.id, bookingMethodId: bookingMethod.id, sortOrder },
      });
    }
  }

  const rooms = [];
  for (const [code, name] of [['P101', 'Phòng khám Nội 101'], ['P102', 'Phòng khám Nhi 102']]) {
    rooms.push(await prisma.clinicRoom.upsert({
      where: { branchId_code: { branchId: branches[0].id, code } },
      update: { name, isActive: true }, create: { branchId: branches[0].id, code, name },
    }));
  }
  for (const [code, name] of [['LAB01', 'Phòng xét nghiệm'], ['XRAY01', 'Phòng X-quang'], ['US01', 'Phòng siêu âm']]) {
    rooms.push(await prisma.clinicRoom.upsert({
      where: { branchId_code: { branchId: branches[0].id, code } },
      update: { name, isActive: true },
      create: { branchId: branches[0].id, code, name },
    }));
  }
  rooms.push(await prisma.clinicRoom.upsert({
    where: { branchId_code: { branchId: branches[1].id, code: 'P201' } },
    update: { name: 'Phòng khám 201', isActive: true },
    create: { branchId: branches[1].id, code: 'P201', name: 'Phòng khám 201' },
  }));

  for (const email of ['manager@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: users.get(email).id, branchId: branches[0].id } },
      update: {}, create: { userId: users.get(email).id, branchId: branches[0].id, isPrimary: true },
    });
  }

  const specialtySeeds = [
    { name: 'Nội tổng quát', slug: 'noi-tong-quat', description: 'Khám, tư vấn sức khỏe chung và tầm soát bệnh lý mạn tính người lớn.', sortOrder: 1 },
    { name: 'Tim mạch', slug: 'tim-mach', description: 'Khám và điều trị tăng huyết áp, xơ vữa động mạch, suy tim và rối loạn nhịp tim.', sortOrder: 2 },
    { name: 'Tiêu hóa – Gan mật', slug: 'tieu-hoa-gan-mat', description: 'Viêm loét dạ dày - đại tràng, trào ngược, viêm gan B/C và sỏi mật.', sortOrder: 3 },
    { name: 'Hô hấp', slug: 'ho-hap', description: 'Viêm phế quản, hen suyễn, viêm phổi và bệnh phổi tắc nghẽn mạn tính.', sortOrder: 4 },
    { name: 'Nội tiết – Đái tháo đường', slug: 'noi-tiet-dai-thao-duong', description: 'Kiểm soát đường huyết, bệnh lý tuyến giáp và rối loạn chuyển hóa lipid.', sortOrder: 5 },
    { name: 'Thần kinh', slug: 'than-kinh', description: 'Khám đau đầu mạn tính, mất ngủ, rối loạn tiền đình và suy giảm trí nhớ.', sortOrder: 6 },
    { name: 'Ngoại tổng quát', slug: 'ngoai-tong-quat', description: 'Bệnh lý hậu môn trực tràng, thoát vị bẹn và áp xe.', sortOrder: 7 },
    { name: 'Ngoại Chấn thương Chỉnh hình', slug: 'ngoai-chan-thuong-chinh-hinh', description: 'Bệnh lý xương khớp, thoái hóa khớp, trật khớp, gãy xương và chấn thương thể thao.', sortOrder: 8 },
    { name: 'Nhi khoa', slug: 'nhi-khoa', description: 'Khám, điều trị và theo dõi sự phát triển toàn diện của trẻ em.', sortOrder: 9 },
    { name: 'Sản – Phụ khoa', slug: 'san-phu-khoa', description: 'Chăm sóc sức khỏe sinh sản, phụ khoa và theo dõi thai kỳ.', sortOrder: 10 },
    { name: 'Mắt', slug: 'mat', description: 'Đo thị lực, khám tật khúc xạ, viêm kết mạc và đục thủy tinh thể.', sortOrder: 11 },
    { name: 'Tai Mũi Họng', slug: 'tai-mui-hong', description: 'Nội soi tai mũi họng, viêm xoang, viêm họng hạt, viêm VA và viêm tai giữa.', sortOrder: 12 },
    { name: 'Răng Hàm Mặt', slug: 'rang-ham-mat', description: 'Khám răng, nhổ răng, trám răng, điều trị tủy và lấy cao răng.', sortOrder: 13 },
    { name: 'Da liễu', slug: 'da-lieu', description: 'Khám, điều trị bệnh da và chăm sóc thẩm mỹ da cơ bản.', sortOrder: 14 },
  ];

  const specialtiesByName = new Map();
  for (const s of specialtySeeds) {
    const row = await prisma.specialty.upsert({
      where: { name: s.name },
      update: { description: s.description, slug: s.slug, sortOrder: s.sortOrder, isActive: true },
      create: { name: s.name, slug: s.slug, description: s.description, sortOrder: s.sortOrder, isActive: true },
    });
    specialtiesByName.set(s.name, row);
  }

  const cardioSpecialty = specialtiesByName.get('Tim mạch');
  const pediatricsSpecialty = specialtiesByName.get('Nhi khoa');

  const doctorInputs = [
    { email: 'doctor.cardio@vitacare.local', specialty: cardioSpecialty, fee: 300000, room: rooms[0] },
    { email: 'doctor.pediatrics@vitacare.local', specialty: pediatricsSpecialty, fee: 250000, room: rooms[1] },
  ];
  const doctors = new Map();
  for (const input of doctorInputs) {
    const user = users.get(input.email);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { consultationFee: input.fee, isActive: true, isFeatured: true },
      create: { userId: user.id, consultationFee: input.fee, academicRank: 'Bác sĩ CKI', isFeatured: true },
    });
    doctors.set(input.email, doctor);
    await prisma.doctorSpecialty.upsert({
      where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: input.specialty.id } },
      update: { isPrimary: true },
      create: { doctorId: doctor.id, specialtyId: input.specialty.id, isPrimary: true },
    });
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: user.id, branchId: branches[0].id } },
      update: { isPrimary: true },
      create: { userId: user.id, branchId: branches[0].id, isPrimary: true },
    });

    for (let day = 0; day <= 30; day += 1) {
      const workDate = dateOnly(day);
      if (workDate.getUTCDay() === 0 && day !== 0) continue;
      const schedule = await prisma.doctorSchedule.upsert({
        where: { doctorId_branchId_workDate_startTime: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8) } },
        update: { status: 'OPEN', roomId: input.room.id, slotDurationMin: 60, capacityPerSlot: 10 },
        create: { doctorId: doctor.id, branchId: branches[0].id, roomId: input.room.id, workDate, startTime: time(8), endTime: time(11, 30), slotDurationMin: 60, capacityPerSlot: 10, status: 'OPEN' },
      });
      for (const [startHour, endHour, endMinute, capacity] of [[8, 9, 0, 10], [9, 10, 0, 10], [10, 11, 0, 10], [11, 11, 30, 10]]) {
        await prisma.doctorScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: time(startHour) } },
          update: { endTime: time(endHour, endMinute), capacity, isActive: true },
          create: { scheduleId: schedule.id, startTime: time(startHour), endTime: time(endHour, endMinute), capacity },
        });
      }
    }
  }

  // Đảm bảo các chuyên khoa còn lại đều có bác sĩ demo
  const allSpecialties = [...specialtiesByName.values()];
  for (const [index, specialty] of allSpecialties.entries()) {
    if ([cardioSpecialty.id, pediatricsSpecialty.id].includes(specialty.id)) continue;
    const email = `doctor.specialty.${specialty.id}@vitacare.local`;
    const fullName = `BS. ${specialty.name}`;
    const user = await prisma.user.upsert({
      where: { email },
      update: { fullName, role: 'DOCTOR', status: 'ACTIVE', isBlocked: false, isDeleted: false },
      create: { email, fullName, role: 'DOCTOR', status: 'ACTIVE', provider: 'EMAIL', password },
    });
    users.set(email, user);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { consultationFee: 250000, isActive: true },
      create: { userId: user.id, consultationFee: 250000, academicRank: 'Bác sĩ CKI', isActive: true },
    });
    doctors.set(email, doctor);
    await prisma.doctorSpecialty.upsert({ where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: specialty.id } }, update: { isPrimary: true }, create: { doctorId: doctor.id, specialtyId: specialty.id, isPrimary: true } });
    await prisma.userBranchAssignment.upsert({ where: { userId_branchId: { userId: user.id, branchId: branches[0].id } }, update: { isPrimary: true }, create: { userId: user.id, branchId: branches[0].id, isPrimary: true } });
    const room = rooms[index % rooms.length];
    let weekdaysCreated = 0;
    for (let day = 1; weekdaysCreated < 10; day += 1) {
      const workDate = dateOnly(day);
      if ([0, 6].includes(workDate.getUTCDay())) continue;
      const schedule = await prisma.doctorSchedule.upsert({
        where: { doctorId_branchId_workDate_startTime: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8) } },
        update: { roomId: room.id, endTime: time(16, 30), status: 'OPEN', capacityPerSlot: 10 },
        create: { doctorId: doctor.id, branchId: branches[0].id, roomId: room.id, workDate, startTime: time(8), endTime: time(16, 30), capacityPerSlot: 10, status: 'OPEN' },
      });
      for (const slot of servicePackageSlots()) {
        await prisma.doctorScheduleSlot.upsert({ where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } }, update: { endTime: slot.endTime, capacity: 10, isActive: true }, create: { scheduleId: schedule.id, startTime: slot.startTime, endTime: slot.endTime, capacity: 10 } });
      }
      weekdaysCreated += 1;
    }
  }

  // Tạo hồ sơ bệnh nhân
  const patient = users.get('patient@vitacare.local');
  await prisma.patientProfile.upsert({
    where: { nationalId: '079200000001' },
    update: { accountId: patient.id, fullName: patient.fullName, isMainProfile: true },
    create: { accountId: patient.id, fullName: patient.fullName, nationalId: '079200000001', dateOfBirth: new Date('2000-01-15T00:00:00.000Z'), gender: 'MALE', address: 'Quận 1, TP.HCM', relationshipToAccount: 'SELF', isMainProfile: true },
  });
  await prisma.patientProfile.upsert({
    where: { nationalId: '079201000002' },
    update: { accountId: patient.id, fullName: 'Nguyễn Minh An' },
    create: { accountId: patient.id, fullName: 'Nguyễn Minh An', nationalId: '079201000002', dateOfBirth: new Date('2018-05-20T00:00:00.000Z'), gender: 'MALE', relationshipToAccount: 'CHILD', isMainProfile: false },
  });

  for (const patientSeed of additionalPatientSeeds) {
    const account = users.get(patientSeed.email);
    await prisma.patientProfile.upsert({
      where: { nationalId: patientSeed.nationalId },
      update: {
        accountId: account.id,
        fullName: account.fullName,
        dateOfBirth: new Date(`${patientSeed.dateOfBirth}T00:00:00.000Z`),
        gender: patientSeed.gender,
        address: patientSeed.address,
        relationshipToAccount: 'SELF',
        isMainProfile: true,
      },
      create: {
        accountId: account.id,
        fullName: account.fullName,
        nationalId: patientSeed.nationalId,
        dateOfBirth: new Date(`${patientSeed.dateOfBirth}T00:00:00.000Z`),
        gender: patientSeed.gender,
        address: patientSeed.address,
        relationshipToAccount: 'SELF',
        isMainProfile: true,
      },
    });
  }

  await seedAuthTables(users, patient);
  await seedBookingTables({ users, doctors, branches, rooms, specialtiesByName });
  await seedTodayWaitingAppointments({ users, doctors, branches, rooms });
  console.log('Seed completed successfully! Test password: VitaCare@123');
}

async function seedAuthTables(users, patient) {
  await prisma.session.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    update: { deletedAt: null, expiresAt: dateOnly(7) },
    create: { id: '10000000-0000-4000-8000-000000000001', userId: patient.id, refreshTokenHash: createHash('sha256').update('seed-refresh-token').digest('hex'), userAgent: 'VitaCare Seed Client', ipAddress: '127.0.0.1', expiresAt: dateOnly(7) },
  });
  await prisma.oAuthAccount.upsert({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'seed-google-account' } },
    update: { userId: patient.id },
    create: { userId: patient.id, provider: 'GOOGLE', providerAccountId: 'seed-google-account' },
  });
  await prisma.authVerificationToken.upsert({
    where: { id: '10000000-0000-4000-8000-000000000002' },
    update: { consumedAt: new Date(), expiresAt: dateOnly(-1) },
    create: { id: '10000000-0000-4000-8000-000000000002', userId: patient.id, tokenHash: createHash('sha256').update('seed-used-otp').digest('hex'), expiresAt: dateOnly(-1), consumedAt: new Date() },
  });
  await prisma.passwordResetToken.upsert({
    where: { tokenHash: createHash('sha256').update('seed-used-reset').digest('hex') },
    update: { consumedAt: new Date(), expiresAt: dateOnly(-1) },
    create: { id: '10000000-0000-4000-8000-000000000003', userId: patient.id, tokenHash: createHash('sha256').update('seed-used-reset').digest('hex'), expiresAt: dateOnly(-1), consumedAt: new Date() },
  });
}

async function seedTodayWaitingAppointments({ users, doctors, branches, rooms }) {
  const doctor = doctors.get('doctor.cardio@vitacare.local');
  const receptionist = users.get('receptionist@vitacare.local');
  if (!doctor || !receptionist || !branches[0] || !rooms[0]) {
    throw new Error('Thiếu bác sĩ, lễ tân, chi nhánh hoặc phòng để seed hàng đợi hôm nay');
  }

  const schedule = await prisma.doctorSchedule.upsert({
    where: {
      doctorId_branchId_workDate_startTime: {
        doctorId: doctor.id,
        branchId: branches[0].id,
        workDate: dateOnly(0),
        startTime: time(8),
      },
    },
    update: { roomId: rooms[0].id, endTime: time(17), status: 'OPEN' },
    create: {
      doctorId: doctor.id,
      branchId: branches[0].id,
      roomId: rooms[0].id,
      workDate: dateOnly(0),
      startTime: time(8),
      endTime: time(17),
      status: 'OPEN',
    },
  });
  const slot = await prisma.doctorScheduleSlot.upsert({
    where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: time(8) } },
    update: { endTime: time(17), capacity: 10, occupiedCount: 5, nextQueueNumber: 5, isActive: true },
    create: { scheduleId: schedule.id, startTime: time(8), endTime: time(17), capacity: 10, occupiedCount: 5, nextQueueNumber: 5 },
  });

  for (let index = 0; index < additionalPatientSeeds.length; index += 1) {
    const account = users.get(additionalPatientSeeds[index].email);
    const profile = await prisma.patientProfile.findFirstOrThrow({
      where: { accountId: account.id, isMainProfile: true },
    });
    const queueNumber = index + 1;
    const bookingCode = `TODAY-${String(queueNumber).padStart(2, '0')}`;
    const checkedInAt = new Date(Date.now() - (additionalPatientSeeds.length - index) * 4 * 60 * 1000);
    const existing = await prisma.appointment.findUnique({ where: { bookingCode } });
    if (existing) {
      await prisma.appointment.update({
        where: { id: existing.id },
        data: {
          patientProfileId: profile.id,
          branchId: branches[0].id,
          scheduleSlotId: slot.id,
          servicePackageId: null,
          servicePackageScheduleSlotId: null,
          servicePrice: doctor.consultationFee,
          symptomsDescription: ['Đau đầu và chóng mặt', 'Hồi hộp, đánh trống ngực', 'Theo dõi tăng huyết áp', 'Đau tức ngực nhẹ', 'Khám tim mạch định kỳ'][index],
          status: 'CHECKED_IN',
          queueNumber,
          checkedInAt,
          checkedInById: receptionist.id,
        },
      });
    } else {
      await prisma.appointment.create({
        data: {
          bookingCode,
          patientProfileId: profile.id,
          branchId: branches[0].id,
          scheduleSlotId: slot.id,
          servicePrice: doctor.consultationFee,
          symptomsDescription: ['Đau đầu và chóng mặt', 'Hồi hộp, đánh trống ngực', 'Theo dõi tăng huyết áp', 'Đau tức ngực nhẹ', 'Khám tim mạch định kỳ'][index],
          status: 'CHECKED_IN',
          queueNumber,
          checkedInAt,
          checkedInById: receptionist.id,
          statusHistories: {
            create: { toStatus: 'CHECKED_IN', actorId: receptionist.id, reason: 'SEED_WAITING_TODAY' },
          },
        },
      });
    }
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { bookingCode } });
    const invoice = await prisma.invoice.upsert({
      where: { appointmentId: appointment.id },
      update: {
        issuedBranchId: branches[0].id,
        totalAmount: doctor.consultationFee,
        status: 'PAID',
        paidAt: checkedInAt,
      },
      create: {
        appointmentId: appointment.id,
        issuedBranchId: branches[0].id,
        totalAmount: doctor.consultationFee,
        status: 'PAID',
        paidAt: checkedInAt,
        items: {
          create: {
            description: `Khám với ${users.get('doctor.cardio@vitacare.local')?.fullName || ''}`,
            quantity: 1,
            unitPrice: doctor.consultationFee,
            amount: doctor.consultationFee,
          },
        },
      },
    });
    await prisma.paymentTransaction.upsert({
      where: { idempotencyKey: `seed-paid:${bookingCode}` },
      update: { invoiceId: invoice.id, amount: doctor.consultationFee, status: 'SUCCESS', paidAt: checkedInAt },
      create: {
        invoiceId: invoice.id,
        provider: 'SEED',
        providerTransactionId: `SEED-${bookingCode}`,
        idempotencyKey: `seed-paid:${bookingCode}`,
        method: 'CASH',
        amount: doctor.consultationFee,
        status: 'SUCCESS',
        paidAt: checkedInAt,
      },
    });
  }
}

async function seedBookingTables({ users, doctors, branches, rooms, specialtiesByName }) {
  const cardioDoctor = doctors.get('doctor.cardio@vitacare.local');
  const configuredMethods = await prisma.branchBookingMethod.findMany({ where: { branchId: branches[0].id }, include: { bookingMethod: true } });
  const branchMethodByCode = new Map(configuredMethods.map((item) => [item.bookingMethod.code, item]));
  const patientUser = users.get('patient@vitacare.local');

  const medicalServiceCatalog = [
    { code: 'LAB_CBC', name: 'Công thức máu toàn bộ (CBC)', description: 'Công thức máu 18/24 thông số, tầm soát thiếu máu và nhiễm trùng.', category: 'LAB_TEST', price: 120000, durationMin: 20 },
    { code: 'LAB_GLUCOSE_HBA1C', name: 'Định lượng đường huyết (Glucose / HbA1c)', description: 'Tầm soát và theo dõi đái tháo đường.', category: 'LAB_TEST', price: 180000, durationMin: 30 },
    { code: 'LAB_LIPID_PROFILE', name: 'Bộ mỡ máu', description: 'Định lượng Cholesterol, Triglyceride, HDL-C và LDL-C.', category: 'LAB_TEST', price: 250000, durationMin: 30 },
    { code: 'LAB_LIVER_FUNCTION', name: 'Đánh giá chức năng gan', description: 'Định lượng AST, ALT, GGT để tầm soát tổn thương tế bào gan.', category: 'LAB_TEST', price: 220000, durationMin: 30 },
    { code: 'LAB_KIDNEY_FUNCTION', name: 'Đánh giá chức năng thận', description: 'Định lượng Urea và Creatinine để tầm soát suy thận.', category: 'LAB_TEST', price: 180000, durationMin: 30 },
    { code: 'LAB_URINALYSIS_10', name: 'Tổng phân tích nước tiểu 10 thông số', description: 'Sàng lọc bệnh lý tiết niệu, thận và chuyển hóa.', category: 'LAB_TEST', price: 100000, durationMin: 20 },
    { code: 'IMG_ABDOMINAL_ULTRASOUND', name: 'Siêu âm màu ổ bụng tổng quát', description: 'Khảo sát gan, mật, tụy, lách, thận và bàng quang.', category: 'IMAGING', price: 300000, durationMin: 30 },
    { code: 'IMG_THYROID_ULTRASOUND', name: 'Siêu âm tuyến giáp', description: 'Khảo sát cấu trúc và bất thường tuyến giáp.', category: 'IMAGING', price: 250000, durationMin: 25 },
    { code: 'IMG_BREAST_ULTRASOUND', name: 'Siêu âm vú', description: 'Khảo sát mô tuyến vú và phát hiện bất thường.', category: 'IMAGING', price: 300000, durationMin: 30 },
    { code: 'IMG_ECHOCARDIOGRAPHY', name: 'Siêu âm tim', description: 'Đánh giá cấu trúc và chức năng tim.', category: 'IMAGING', price: 500000, durationMin: 40 },
    { code: 'IMG_XRAY_CHEST', name: 'X-quang kỹ thuật số ngực thẳng', description: 'Khảo sát phổi, tim và lồng ngực.', category: 'IMAGING', price: 200000, durationMin: 20 },
    { code: 'PROC_ECG', name: 'Đo điện tâm đồ (ECG)', description: 'Tầm soát thiếu máu cơ tim và rối loạn nhịp.', category: 'PROCEDURE', price: 150000, durationMin: 20 },
    { code: 'PROC_ENT_ENDOSCOPY', name: 'Nội soi Tai Mũi Họng ống mềm', description: 'Nội soi chẩn đoán tai, mũi và họng bằng ống mềm.', category: 'PROCEDURE', price: 250000, durationMin: 25 },
    { code: 'PROC_DENTAL_SCALING', name: 'Lấy cao răng & đánh bóng hai hàm', description: 'Làm sạch cao răng và đánh bóng bề mặt răng.', category: 'PROCEDURE', price: 400000, durationMin: 45 },
  ];

  const medicalServicesByCode = new Map();
  for (const service of medicalServiceCatalog) {
    const row = await prisma.medicalService.upsert({
      where: { code: service.code },
      update: { ...service, isActive: true },
      create: { ...service },
    });
    medicalServicesByCode.set(row.code, row);
  }

  const bookingSpecialties = await prisma.specialty.findMany({ orderBy: { id: 'asc' } });
  for (const branch of branches) {
    for (const specialty of bookingSpecialties) {
      await prisma.branchSpecialty.upsert({
        where: { branchId_specialtyId: { branchId: branch.id, specialtyId: specialty.id } },
        update: { isActive: true },
        create: { branchId: branch.id, specialtyId: specialty.id, isActive: true },
      });
    }
  }

  const activeRooms = await prisma.clinicRoom.findMany({ where: { isActive: true }, orderBy: [{ branchId: 'asc' }, { code: 'asc' }] });
  for (const room of activeRooms) {
    for (const [priority, specialty] of bookingSpecialties.entries()) {
      await prisma.clinicRoomSpecialty.upsert({
        where: { roomId_specialtyId: { roomId: room.id, specialtyId: specialty.id } },
        update: { isActive: true, priority: bookingSpecialties.length - priority },
        create: { roomId: room.id, specialtyId: specialty.id, priority: bookingSpecialties.length - priority, isActive: true },
      });
    }
  }

  for (const [specialtyIndex, specialty] of bookingSpecialties.entries()) {
    const codeSuffix = String(specialty.id).padStart(3, '0');
    const specialtyName = String(specialty.name || 'chuyên khoa').trim().replace(/^Khám\s+/i, '');
    const specialtyServices = [
      { code: `CONSULT-${codeSuffix}-STANDARD`, name: `Khám ${specialtyName} trong giờ`, price: 220000, durationMin: 30, description: `Khám ban đầu các triệu chứng và bệnh lý thuộc ${specialtyName}, thực hiện trong giờ hành chính.` },
      { code: `CONSULT-${codeSuffix}-AFTER`, name: `Khám ${specialtyName} ngoài giờ`, price: 270000, durationMin: 30, description: `Khám các triệu chứng và bệnh lý thuộc ${specialtyName} ngoài giờ hành chính theo lịch được công bố.` },
      { code: `CONSULT-${codeSuffix}-FOLLOWUP`, name: `Tái khám ${specialtyName}`, price: 180000, durationMin: 20, description: `Theo dõi đáp ứng điều trị, xem lại kết quả và điều chỉnh kế hoạch điều trị thuộc ${specialtyName}.` },
      { code: `CONSULT-${codeSuffix}-ADVICE`, name: `Tư vấn ${specialtyName}`, price: 150000, durationMin: 20, description: `Tư vấn ban đầu về triệu chứng, nguy cơ và hướng thăm khám phù hợp thuộc ${specialtyName}.` },
    ];
    for (const service of specialtyServices) {
      const methodCode = service.code.endsWith('-AFTER') ? 'AFTER_HOURS' : service.code.endsWith('-ADVICE') ? 'CONSULTATION' : 'SPECIALTY_EXAM';
      const branchBookingMethod = branchMethodByCode.get(methodCode);
      if (!branchBookingMethod) continue;
      const servicePackage = await prisma.servicePackage.upsert({
        where: { code: service.code },
        update: { ...service, branchBookingMethodId: branchBookingMethod.id, specialtyId: specialty.id, isActive: true },
        create: { ...service, branchBookingMethodId: branchBookingMethod.id, specialtyId: specialty.id },
      });
      const roomId = rooms[specialtyIndex % rooms.length].id;
      let scheduleDays = 0;
      for (let day = 1; scheduleDays < 10; day += 1) {
        const examDate = dateOnly(day);
        if ([0, 6].includes(examDate.getUTCDay())) continue;
        const schedule = await prisma.servicePackageSchedule.upsert({
          where: { servicePackageId_examDate: { servicePackageId: servicePackage.id, examDate } },
          update: { roomId, isActive: true }, create: { servicePackageId: servicePackage.id, roomId, examDate },
        });
        for (const slot of servicePackageSlots()) {
          await prisma.servicePackageScheduleSlot.upsert({ where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } }, update: { endTime: slot.endTime, capacity: slot.capacity, isActive: true }, create: { scheduleId: schedule.id, ...slot } });
        }
        scheduleDays += 1;
      }
    }
  }

  const healthPackageSeeds = [
    { code: 'PKG-GENERAL-BASIC', name: 'Gói khám sức khỏe tổng quát cơ bản', description: 'Tầm soát sức khỏe định kỳ với xét nghiệm và chẩn đoán hình ảnh cơ bản.', price: 1290000, itemCodes: ['LAB_CBC', 'LAB_GLUCOSE_HBA1C', 'LAB_LIVER_FUNCTION', 'LAB_KIDNEY_FUNCTION', 'LAB_URINALYSIS_10', 'IMG_XRAY_CHEST'] },
    { code: 'PKG-CARDIO-SCREENING', name: 'Gói tầm soát nguy cơ tim mạch', description: 'Đánh giá các yếu tố nguy cơ tim mạch bằng xét nghiệm và thăm dò chức năng.', price: 990000, itemCodes: ['LAB_GLUCOSE_HBA1C', 'LAB_LIPID_PROFILE', 'PROC_ECG', 'IMG_ECHOCARDIOGRAPHY'] },
    { code: 'PKG-WOMEN-WELLNESS', name: 'Gói kiểm tra sức khỏe nữ', description: 'Gói kiểm tra sức khỏe định kỳ dành cho nữ.', price: 1490000, itemCodes: ['LAB_CBC', 'LAB_GLUCOSE_HBA1C', 'IMG_BREAST_ULTRASOUND', 'IMG_ABDOMINAL_ULTRASOUND'] },
  ];
  for (const [packageIndex, seed] of healthPackageSeeds.entries()) {
    const { itemCodes, ...packageData } = seed;
    const healthPackageMethod = branchMethodByCode.get('HEALTH_PACKAGE');
    if (!healthPackageMethod) continue;
    const healthPackage = await prisma.servicePackage.upsert({
      where: { code: seed.code },
      update: { ...packageData, branchBookingMethodId: healthPackageMethod.id, isActive: true },
      create: { ...packageData, branchBookingMethodId: healthPackageMethod.id },
    });
    await prisma.servicePackageItem.deleteMany({ where: { servicePackageId: healthPackage.id } });
    const items = itemCodes.map((code, sortOrder) => {
      const medicalService = medicalServicesByCode.get(code);
      if (!medicalService) throw new Error(`Không tìm thấy dịch vụ ${code} để tạo gói ${seed.code}`);
      return { servicePackageId: healthPackage.id, medicalServiceId: medicalService.id, quantity: 1, sortOrder };
    });
    await prisma.servicePackageItem.createMany({ data: items });
    let weekdaysCreated = 0;
    for (let day = 1; weekdaysCreated < 10; day += 1) {
      const examDate = dateOnly(day);
      const dayOfWeek = examDate.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      const roomId = rooms[packageIndex % rooms.length].id;
      const schedule = await prisma.servicePackageSchedule.upsert({
        where: { servicePackageId_examDate: { servicePackageId: healthPackage.id, examDate } },
        update: { roomId, isActive: true },
        create: { servicePackageId: healthPackage.id, roomId, examDate },
      });
      for (const slot of servicePackageSlots()) {
        await prisma.servicePackageScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } },
          update: { endTime: slot.endTime, capacity: slot.capacity, isActive: true },
          create: { scheduleId: schedule.id, ...slot },
        });
      }
      weekdaysCreated += 1;
    }
  }

  if (cardioDoctor) {
    await prisma.review.upsert({
      where: { doctorId_reviewerId: { doctorId: cardioDoctor.id, reviewerId: patientUser.id } },
      update: { rating: 5, comment: 'Bác sĩ tư vấn tận tình, quy trình khám rõ ràng.', isActive: true },
      create: {
        doctorId: cardioDoctor.id,
        reviewerId: patientUser.id,
        rating: 5,
        comment: 'Bác sĩ tư vấn tận tình, quy trình khám rõ ràng.',
      },
    });
    await prisma.doctor.update({
      where: { id: cardioDoctor.id },
      data: { ratingAverage: 5, ratingCount: 1 },
    });
  }
}

main().finally(() => prisma.$disconnect());
