import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();
const roles = [
  ['admin@vitacare.local', 'Quản trị hệ thống', 'ADMIN'],
  ['manager@vitacare.local', 'Quản lý cơ sở', 'BRANCH_MANAGER'],
  ['doctor.cardio@vitacare.local', 'BS. Nguyễn Minh Tâm', 'DOCTOR'],
  ['doctor.pediatrics@vitacare.local', 'BS. Trần Thu Hà', 'DOCTOR'],
  ['pharmacist@vitacare.local', 'Dược sĩ Lê An', 'PHARMACIST'],
  ['cashier@vitacare.local', 'Thu ngân Phạm Mai', 'CASHIER'],
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

  // Tên bảng được lấy trực tiếp từ PostgreSQL; quote identifier để an toàn.
  const identifiers = tables
    .map(({ tablename }) => `"${String(tablename).replaceAll('"', '""')}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`);
  console.log(`Reset completed: cleared ${tables.length} application tables (kept _prisma_migrations).`);
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
    await prisma.clinicRoom.upsert({
      where: { branchId_code: { branchId: branches[0].id, code } },
      update: { name, isActive: true },
      create: { branchId: branches[0].id, code, name },
    });
  }
  await prisma.clinicRoom.upsert({
    where: { branchId_code: { branchId: branches[1].id, code: 'P201' } },
    update: { name: 'Phòng khám 201', isActive: true },
    create: { branchId: branches[1].id, code: 'P201', name: 'Phòng khám 201' },
  });

  for (const email of ['manager@vitacare.local', 'pharmacist@vitacare.local', 'cashier@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: users.get(email).id, branchId: branches[0].id } },
      update: {}, create: { userId: users.get(email).id, branchId: branches[0].id, isPrimary: true },
    });
  }

  // Dọn hai khoa demo cũ để khi chạy lại seed không bị dư danh mục.
  const legacyDepartments = await prisma.department.findMany({
    where: { name: { in: ['Tim mạch', 'Nhi khoa'] } },
    select: { id: true },
  });
  if (legacyDepartments.length) {
    const legacyDepartmentIds = legacyDepartments.map((department) => department.id);
    await prisma.specialty.deleteMany({ where: { departmentId: { in: legacyDepartmentIds } } });
    await prisma.department.deleteMany({ where: { id: { in: legacyDepartmentIds } } });
  }

  const departmentCatalog = [
    {
      code: 'INTERNAL_MEDICINE',
      name: 'Khoa Nội',
      description: 'Khám, chẩn đoán và điều trị nội khoa cho người lớn.',
      specialties: [
        ['Nội tổng quát', 'Khám, tư vấn sức khỏe chung và tầm soát bệnh lý mạn tính người lớn.'],
        ['Tim mạch', 'Khám và điều trị tăng huyết áp, xơ vữa động mạch, suy tim và rối loạn nhịp tim.'],
        ['Tiêu hóa – Gan mật', 'Viêm loét dạ dày - đại tràng, trào ngược, viêm gan B/C và sỏi mật.'],
        ['Hô hấp', 'Viêm phế quản, hen suyễn, viêm phổi và bệnh phổi tắc nghẽn mạn tính.'],
        ['Nội tiết – Đái tháo đường', 'Kiểm soát đường huyết, bệnh lý tuyến giáp và rối loạn chuyển hóa lipid.'],
        ['Thần kinh', 'Khám đau đầu mạn tính, mất ngủ, rối loạn tiền đình và suy giảm trí nhớ.'],
      ],
    },
    {
      code: 'SURGERY',
      name: 'Khoa Ngoại',
      description: 'Khám ngoại khoa, phẫu thuật, tiểu phẫu và xử lý chấn thương.',
      specialties: [
        ['Ngoại tổng quát', 'Bệnh lý hậu môn trực tràng, thoát vị bẹn và áp xe.'],
        ['Ngoại Chấn thương Chỉnh hình', 'Bệnh lý xương khớp, thoái hóa khớp, trật khớp, gãy xương và chấn thương thể thao.'],
        ['Ngoại Cột sống & Thần kinh', 'Thoát vị đĩa đệm, thoái hóa cột sống và đau dây thần kinh tọa.'],
        ['Ngoại Thận – Tiết niệu & Nam khoa', 'Sỏi thận, sỏi bàng quang, phì đại tuyến tiền liệt và rối loạn sinh lý nam.'],
        ['Tiểu phẫu & Xử lý chấn thương', 'Khâu/rửa vết thương, bóc u mỡ, u bã nhờn, u nang lành tính và cắt chỉ.'],
      ],
    },
    {
      code: 'PEDIATRICS',
      name: 'Khoa Nhi',
      description: 'Khám, điều trị và theo dõi sự phát triển toàn diện của trẻ em.',
      specialties: [
        ['Nội Nhi tổng quát', 'Khám và điều trị bệnh hô hấp, tiêu hóa và nhiễm trùng sốt ở trẻ em.'],
        ['Tư vấn Dinh dưỡng & Phát triển Nhi', 'Theo dõi biểu đồ tăng trưởng và tư vấn vi chất cho trẻ.'],
      ],
    },
    {
      code: 'OBGYN',
      name: 'Khoa Sản – Phụ khoa',
      description: 'Chăm sóc sức khỏe sinh sản, phụ khoa và theo dõi thai kỳ.',
      specialties: [
        ['Phụ khoa tổng quát', 'Tầm soát ung thư cổ tử cung, điều trị viêm nhiễm và rối loạn kinh nguyệt.'],
        ['Khám thai & Theo dõi thai kỳ', 'Siêu âm thai định kỳ, theo dõi sự phát triển thai nhi và đo tim thai.'],
      ],
    },
    {
      code: 'SPECIALIZED_CARE',
      name: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt',
      description: 'Khám và điều trị các bệnh lý mắt, tai mũi họng và răng hàm mặt.',
      specialties: [
        ['Mắt', 'Đo thị lực, khám tật khúc xạ, viêm kết mạc và đục thủy tinh thể.'],
        ['Tai Mũi Họng', 'Nội soi tai mũi họng, viêm xoang, viêm họng hạt, viêm VA và viêm tai giữa.'],
        ['Răng Hàm Mặt', 'Khám răng, nhổ răng, trám răng, điều trị tủy và lấy cao răng.'],
      ],
    },
    {
      code: 'DERMATOLOGY',
      name: 'Khoa Da liễu',
      description: 'Khám, điều trị bệnh da và chăm sóc thẩm mỹ da cơ bản.',
      specialties: [
        ['Da liễu tổng quát', 'Điều trị mụn trứng cá, viêm da cơ địa, vảy nến, nấm da và dị ứng.'],
        ['Chăm sóc & Thẩm mỹ da cơ bản', 'Liệu trình điều trị sẹo, thâm và laser da liễu cơ bản.'],
      ],
    },
  ];

  const departmentsByCode = new Map();
  const specialtiesByKey = new Map();
  for (const departmentSeed of departmentCatalog) {
    const department = await prisma.department.upsert({
      where: { name: departmentSeed.name },
      update: { description: departmentSeed.description },
      create: { name: departmentSeed.name, description: departmentSeed.description },
    });
    departmentsByCode.set(departmentSeed.code, department);
    for (const [name, description] of departmentSeed.specialties) {
      const specialty = await prisma.specialty.upsert({
        where: { departmentId_name: { departmentId: department.id, name } },
        update: { description },
        create: { departmentId: department.id, name, description },
      });
      specialtiesByKey.set(`${departmentSeed.code}:${name}`, specialty);
    }
  }

  const internalMedicine = departmentsByCode.get('INTERNAL_MEDICINE');
  const pediatrics = departmentsByCode.get('PEDIATRICS');
  const cardioSpecialty = specialtiesByKey.get('INTERNAL_MEDICINE:Tim mạch');
  const pediatricSpecialty = specialtiesByKey.get('PEDIATRICS:Nội Nhi tổng quát');

  const doctorInputs = [
    { email: 'doctor.cardio@vitacare.local', department: internalMedicine, specialty: cardioSpecialty, fee: 300000, room: rooms[0] },
    { email: 'doctor.pediatrics@vitacare.local', department: pediatrics, specialty: pediatricSpecialty, fee: 250000, room: rooms[1] },
  ];
  const doctors = new Map();
  for (const input of doctorInputs) {
    const user = users.get(input.email);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, isActive: true, isFeatured: true },
      create: { userId: user.id, fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, academicRank: 'Bác sĩ CKI', isFeatured: true },
    });
    doctors.set(input.email, doctor);
    await prisma.doctorSpecialty.upsert({ where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: input.specialty.id } }, update: { isPrimary: true }, create: { doctorId: doctor.id, specialtyId: input.specialty.id, isPrimary: true } });
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: user.id, branchId: branches[0].id } },
      update: { isPrimary: true },
      create: { userId: user.id, branchId: branches[0].id, isPrimary: true },
    });

    await prisma.doctorScheduleException.upsert({
      where: { doctorId_branchId_date: { doctorId: doctor.id, branchId: branches[0].id, date: dateOnly(31) } },
      update: { reason: 'Nghỉ đào tạo chuyên môn', isClosed: true },
      create: { doctorId: doctor.id, branchId: branches[0].id, date: dateOnly(31), reason: 'Nghỉ đào tạo chuyên môn', isClosed: true },
    });

    for (let day = 0; day <= 30; day += 1) {
      const workDate = dateOnly(day);
      // Luôn tạo ca cho ngày seed hiện tại để có thể test hàng đợi ngay;
      // các ngày Chủ nhật tương lai vẫn được nghỉ theo lịch phòng khám.
      if (workDate.getUTCDay() === 0 && day !== 0) continue;
      const schedule = await prisma.doctorSchedule.upsert({
        where: { doctorId_branchId_workDate_startTime: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8) } },
        update: { status: 'OPEN', roomId: input.room.id, slotDurationMin: 60 },
        create: { doctorId: doctor.id, branchId: branches[0].id, roomId: input.room.id, workDate, startTime: time(8), endTime: time(11, 30), slotDurationMin: 60, status: 'OPEN' },
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

  // Bảo đảm mỗi chuyên khoa có ít nhất một bác sĩ để có thể thử đầy đủ các flow đặt khám.
  const seededSpecialtyIds = new Set(doctorInputs.map((input) => input.specialty.id));
  const allSpecialties = [...specialtiesByKey.values()];
  for (const [index, specialty] of allSpecialties.entries()) {
    if (seededSpecialtyIds.has(specialty.id)) continue;
    const department = await prisma.department.findUniqueOrThrow({ where: { id: specialty.departmentId } });
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
      update: { fullName, departmentId: department.id, consultationFee: 250000, isActive: true },
      create: { userId: user.id, fullName, departmentId: department.id, consultationFee: 250000, academicRank: 'Bác sĩ CKI', isActive: true },
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
        update: { roomId: room.id, endTime: time(16, 30), status: 'OPEN' },
        create: { doctorId: doctor.id, branchId: branches[0].id, roomId: room.id, workDate, startTime: time(8), endTime: time(16, 30), status: 'OPEN' },
      });
      for (const slot of servicePackageSlots()) {
        await prisma.doctorScheduleSlot.upsert({ where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } }, update: { endTime: slot.endTime, capacity: 10, isActive: true }, create: { scheduleId: schedule.id, startTime: slot.startTime, endTime: slot.endTime, capacity: 10 } });
      }
      weekdaysCreated += 1;
    }
  }

  const patient = users.get('patient@vitacare.local');
  let mainProfile = await prisma.patientProfile.findFirst({ where: { accountId: patient.id, isMainProfile: true } });
  if (!mainProfile) mainProfile = await prisma.patientProfile.create({ data: { accountId: patient.id, fullName: patient.fullName, nationalId: '079200000001', dateOfBirth: new Date('2000-01-15T00:00:00.000Z'), gender: 'MALE', address: 'Quận 1, TP.HCM', relationshipToAccount: 'SELF', isMainProfile: true } });
  const childProfile = await prisma.patientProfile.upsert({
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
  await seedBookingTables({ users, doctors, branches, rooms });
  await seedTodayWaitingAppointments({ users, doctors, branches, rooms });
  console.log('Seed completed with 5 patients waiting today. Test password: VitaCare@123');
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
  const cashier = users.get('cashier@vitacare.local');
  if (!doctor || !receptionist || !cashier || !branches[0] || !rooms[0]) {
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
        cashierId: cashier.id,
        totalAmount: doctor.consultationFee,
        status: 'PAID',
        paidAt: checkedInAt,
      },
      create: {
        appointmentId: appointment.id,
        issuedBranchId: branches[0].id,
        cashierId: cashier.id,
        totalAmount: doctor.consultationFee,
        status: 'PAID',
        paidAt: checkedInAt,
        items: {
          create: {
            description: `Khám với ${doctor.fullName}`,
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

async function seedBookingTables({ users, doctors, branches, rooms }) {
  const cardioDoctor = doctors.get('doctor.cardio@vitacare.local');
  if (!cardioDoctor) throw new Error('Không tìm thấy bác sĩ Tim mạch để seed danh mục');
  if (!rooms[0] || rooms[0].branchId !== branches[0].id) throw new Error('Không tìm thấy phòng khám hợp lệ tại chi nhánh chính để seed gói khám');
  const configuredMethods = await prisma.branchBookingMethod.findMany({ where: { branchId: branches[0].id }, include: { bookingMethod: true } });
  const branchMethodByCode = new Map(configuredMethods.map((item) => [item.bookingMethod.code, item]));
  const pharmacist = users.get('pharmacist@vitacare.local');
  const patientUser = users.get('patient@vitacare.local');
  // Danh mục generic phục vụ demo kê/cấp thuốc. Hàm lượng và dạng bào chế dựa trên
  // WHO Model List of Essential Medicines; giá chỉ là dữ liệu mô phỏng, không phải giá kê khai.
  const medicineCatalog = [
    ['MED-PARA-500-TAB', 'Paracetamol 500 mg viên nén', 'Paracetamol', '500 mg', 'viên', 800, 1000],
    ['MED-IBU-400-TAB', 'Ibuprofen 400 mg viên nén', 'Ibuprofen', '400 mg', 'viên', 1200, 500],
    ['MED-AMOX-500-CAP', 'Amoxicillin 500 mg viên nang', 'Amoxicillin', '500 mg', 'viên', 2500, 500],
    ['MED-AMOXCLAV-625-TAB', 'Amoxicillin/Clavulanic acid 500 mg/125 mg viên nén', 'Amoxicillin + acid clavulanic', '500 mg/125 mg', 'viên', 8500, 300],
    ['MED-AZITH-500-TAB', 'Azithromycin 500 mg viên nén', 'Azithromycin', '500 mg', 'viên', 6500, 300],
    ['MED-CEPHALEXIN-500-CAP', 'Cefalexin 500 mg viên nang', 'Cefalexin', '500 mg', 'viên', 3500, 400],
    ['MED-METRO-500-TAB', 'Metronidazole 500 mg viên nén', 'Metronidazole', '500 mg', 'viên', 1000, 500],
    ['MED-OMEP-20-CAP', 'Omeprazole 20 mg viên nang kháng dịch vị', 'Omeprazole', '20 mg', 'viên', 1800, 500],
    ['MED-ORS-SACHET', 'Oresol gói pha 1 lít', 'Glucose + natri clorid + kali clorid + natri citrat', 'Gói pha 1 L', 'gói', 4500, 300],
    ['MED-CETI-10-TAB', 'Cetirizine 10 mg viên nén', 'Cetirizine', '10 mg', 'viên', 1000, 500],
    ['MED-SALB-100-INH', 'Salbutamol 100 microgam/liều bình hít', 'Salbutamol', '100 microgam/liều', 'bình', 85000, 80],
    ['MED-BUD-200-INH', 'Budesonide 200 microgam/liều bình hít', 'Budesonide', '200 microgam/liều', 'bình', 145000, 60],
    ['MED-AMLO-5', 'Amlodipine 5 mg viên nén', 'Amlodipine', '5 mg', 'viên', 1200, 500],
    ['MED-LOSAR-50-TAB', 'Losartan 50 mg viên nén', 'Losartan', '50 mg', 'viên', 2200, 500],
    ['MED-HCTZ-25-TAB', 'Hydrochlorothiazide 25 mg viên nén', 'Hydrochlorothiazide', '25 mg', 'viên', 900, 400],
    ['MED-METF-500-TAB', 'Metformin 500 mg viên nén', 'Metformin hydrochloride', '500 mg', 'viên', 1200, 600],
    ['MED-GLIC-80-TAB', 'Gliclazide 80 mg viên nén', 'Gliclazide', '80 mg', 'viên', 1700, 300],
    ['MED-ATOR-20-TAB', 'Atorvastatin 20 mg viên nén', 'Atorvastatin', '20 mg', 'viên', 2500, 500],
    ['MED-ASA-81-TAB', 'Acid acetylsalicylic 81 mg viên bao tan trong ruột', 'Acid acetylsalicylic', '81 mg', 'viên', 900, 400],
    ['MED-LEVOTH-50-TAB', 'Levothyroxine 50 microgam viên nén', 'Levothyroxine natri', '50 microgam', 'viên', 1800, 300],
    ['MED-FERRO-60-TAB', 'Sắt nguyên tố 60 mg + acid folic 400 microgam viên nén', 'Muối sắt + acid folic', '60 mg/400 microgam', 'viên', 1500, 500],
    ['MED-PRED-5-TAB', 'Prednisolone 5 mg viên nén', 'Prednisolone', '5 mg', 'viên', 1000, 300],
  ];
  const medicinesByCode = new Map();
  for (const [code, name, activeIngredient, strength, unit, unitPrice, stockQuantity] of medicineCatalog) {
    const medicine = await prisma.medicine.upsert({ where: { code }, update: { name, activeIngredient, strength, unit, unitPrice, stockQuantity, isActive: true }, create: { code, name, activeIngredient, strength, unit, unitPrice, stockQuantity } });
    medicinesByCode.set(code, medicine);
  }
  const amlodipine = medicinesByCode.get('MED-AMLO-5');
  const serviceDepartmentRows = await prisma.department.findMany({
    where: { name: { in: ['Khoa Nội', 'Khoa Ngoại', 'Khoa Da liễu', 'Khoa Sản – Phụ khoa', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'] } },
    select: { id: true, name: true },
  });
  const serviceDepartmentIds = new Map(serviceDepartmentRows.map((department) => [department.name, department.id]));
  // Danh mục ICD-10 WHO thông dụng dùng cho tra cứu lâm sàng; mã lưu ở mức bệnh/chẩn đoán,
  // mô tả tiếng Việt và khoa chỉ dùng để ưu tiên/lọc trên giao diện.
  const icd10Catalog = [
    ['A09', 'Viêm dạ dày-ruột và viêm đại tràng do nhiễm trùng, không xác định', 'Khoa Nội'],
    ['B35.9', 'Bệnh nấm da, không xác định', 'Khoa Da liễu'],
    ['E03.9', 'Suy giáp, không xác định', 'Khoa Nội'],
    ['E11.9', 'Đái tháo đường típ 2 không có biến chứng', 'Khoa Nội'],
    ['E78.5', 'Rối loạn lipid máu, không xác định', 'Khoa Nội'],
    ['G43.9', 'Đau nửa đầu, không xác định', 'Khoa Nội'],
    ['H10.9', 'Viêm kết mạc, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['H66.9', 'Viêm tai giữa, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['H81.1', 'Chóng mặt kịch phát lành tính', 'Khoa Nội'],
    ['I10', 'Tăng huyết áp vô căn (nguyên phát)', 'Khoa Nội'],
    ['I20.9', 'Cơn đau thắt ngực, không xác định', 'Khoa Nội'],
    ['I25.1', 'Bệnh tim do xơ vữa động mạch', 'Khoa Nội'],
    ['I50.9', 'Suy tim, không xác định', 'Khoa Nội'],
    ['J00', 'Viêm mũi họng cấp (cảm thường)', 'Khoa Nội'],
    ['J02.9', 'Viêm họng cấp, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['J03.9', 'Viêm amiđan cấp, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['J06.9', 'Nhiễm trùng đường hô hấp trên cấp, không xác định', 'Khoa Nội'],
    ['J18.9', 'Viêm phổi, không xác định tác nhân', 'Khoa Nội'],
    ['J20.9', 'Viêm phế quản cấp, không xác định', 'Khoa Nội'],
    ['J30.4', 'Viêm mũi dị ứng, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['J45.9', 'Hen phế quản, không xác định', 'Khoa Nội'],
    ['K02.9', 'Sâu răng, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['K04.0', 'Viêm tủy răng', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['K05.1', 'Viêm lợi mạn tính', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['K21.9', 'Bệnh trào ngược dạ dày-thực quản không viêm thực quản', 'Khoa Nội'],
    ['K29.7', 'Viêm dạ dày, không xác định', 'Khoa Nội'],
    ['K30', 'Khó tiêu chức năng', 'Khoa Nội'],
    ['K52.9', 'Viêm dạ dày-ruột và đại tràng không nhiễm trùng, không xác định', 'Khoa Nội'],
    ['L20.9', 'Viêm da cơ địa, không xác định', 'Khoa Da liễu'],
    ['L30.9', 'Viêm da, không xác định', 'Khoa Da liễu'],
    ['M17.9', 'Thoái hóa khớp gối, không xác định', 'Khoa Ngoại'],
    ['M54.5', 'Đau vùng thắt lưng', 'Khoa Ngoại'],
    ['N20.0', 'Sỏi thận', 'Khoa Ngoại'],
    ['N39.0', 'Nhiễm trùng đường tiết niệu, vị trí không xác định', 'Khoa Ngoại'],
    ['R05', 'Ho', 'Khoa Nội'],
    ['R10.4', 'Đau bụng khác và không xác định', 'Khoa Nội'],
    ['R11', 'Buồn nôn và nôn', 'Khoa Nội'],
    ['R42', 'Chóng mặt và choáng váng', 'Khoa Nội'],
    ['R50.9', 'Sốt, không xác định', 'Khoa Nội'],
    ['R51', 'Đau đầu', 'Khoa Nội'],
    ['A04.9', 'Nhiễm trùng đường ruột do vi khuẩn, không xác định', 'Khoa Nội'],
    ['B34.9', 'Nhiễm virus, không xác định', 'Khoa Nội'],
    ['D50.9', 'Thiếu máu thiếu sắt, không xác định', 'Khoa Nội'],
    ['E66.9', 'Béo phì, không xác định', 'Khoa Nội'],
    ['E79.0', 'Tăng acid uric máu không có biểu hiện viêm khớp và bệnh gút', 'Khoa Nội'],
    ['F41.1', 'Rối loạn lo âu lan tỏa', 'Khoa Nội'],
    ['G47.0', 'Rối loạn khởi phát và duy trì giấc ngủ', 'Khoa Nội'],
    ['H00.0', 'Lẹo và viêm sâu khác của mi mắt', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['I48', 'Rung nhĩ và cuồng nhĩ', 'Khoa Nội'],
    ['I83.9', 'Giãn tĩnh mạch chi dưới không loét hoặc viêm', 'Khoa Ngoại'],
    ['J01.9', 'Viêm xoang cấp, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['J32.9', 'Viêm xoang mạn, không xác định', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'],
    ['K59.0', 'Táo bón', 'Khoa Nội'],
    ['L50.9', 'Mày đay, không xác định', 'Khoa Da liễu'],
    ['M10.9', 'Bệnh gút, không xác định', 'Khoa Nội'],
    ['M25.5', 'Đau khớp', 'Khoa Ngoại'],
    ['N30.0', 'Viêm bàng quang cấp', 'Khoa Ngoại'],
    ['N40', 'Tăng sản tuyến tiền liệt', 'Khoa Ngoại'],
    ['R00.2', 'Đánh trống ngực', 'Khoa Nội'],
    ['R07.4', 'Đau ngực, không xác định', 'Khoa Nội'],
    ['R53', 'Khó chịu và mệt mỏi', 'Khoa Nội'],
    ['Z00.0', 'Khám sức khỏe tổng quát người không có than phiền hoặc chẩn đoán', 'Khoa Nội'],
  ];
  for (const [code, description, departmentName] of icd10Catalog) {
    const departmentId = serviceDepartmentIds.get(departmentName) || null;
    await prisma.icd10Code.upsert({
      where: { code },
      update: { description, departmentId, isActive: true },
      create: { code, description, departmentId, isActive: true },
    });
  }
  const medicalServiceCatalog = [
    // Xét nghiệm máu, sinh hóa, nước tiểu và vi sinh.
    { code: 'LAB_CBC', name: 'Công thức máu toàn bộ (CBC)', description: 'Công thức máu 18/24 thông số, tầm soát thiếu máu và nhiễm trùng.', category: 'LAB_TEST', department: 'Khoa Nội', price: 120000, durationMin: 20 },
    { code: 'LAB_GLUCOSE_HBA1C', name: 'Định lượng đường huyết (Glucose / HbA1c)', description: 'Tầm soát và theo dõi đái tháo đường.', category: 'LAB_TEST', department: 'Khoa Nội', price: 180000, durationMin: 30 },
    { code: 'LAB_LIPID_PROFILE', name: 'Bộ mỡ máu', description: 'Định lượng Cholesterol, Triglyceride, HDL-C và LDL-C.', category: 'LAB_TEST', department: 'Khoa Nội', price: 250000, durationMin: 30 },
    { code: 'LAB_LIVER_FUNCTION', name: 'Đánh giá chức năng gan', description: 'Định lượng AST, ALT, GGT để tầm soát tổn thương tế bào gan.', category: 'LAB_TEST', department: 'Khoa Nội', price: 220000, durationMin: 30 },
    { code: 'LAB_KIDNEY_FUNCTION', name: 'Đánh giá chức năng thận', description: 'Định lượng Urea và Creatinine để tầm soát suy thận.', category: 'LAB_TEST', department: 'Khoa Nội', price: 180000, durationMin: 30 },
    { code: 'LAB_HEPATITIS_B_C', name: 'Test nhanh Viêm gan B/C', description: 'Xét nghiệm HBsAg và Anti-HCV.', category: 'LAB_TEST', department: 'Khoa Nội', price: 240000, durationMin: 30 },
    { code: 'LAB_HP_RAPID', name: 'Test nhanh HP dạ dày', description: 'Tầm soát nhiễm Helicobacter pylori.', category: 'LAB_TEST', department: 'Khoa Nội', price: 150000, durationMin: 20 },
    { code: 'LAB_FLU_AB_RAPID', name: 'Test nhanh Cúm A/B', description: 'Phát hiện nhanh virus cúm A và B.', category: 'LAB_TEST', department: 'Khoa Nội', price: 180000, durationMin: 20 },
    { code: 'LAB_URINALYSIS_10', name: 'Tổng phân tích nước tiểu 10 thông số', description: 'Sàng lọc bệnh lý tiết niệu, thận và chuyển hóa.', category: 'LAB_TEST', department: 'Khoa Nội', price: 100000, durationMin: 20 },

    // Chẩn đoán hình ảnh.
    { code: 'IMG_ABDOMINAL_ULTRASOUND', name: 'Siêu âm màu ổ bụng tổng quát', description: 'Khảo sát gan, mật, tụy, lách, thận và bàng quang.', category: 'IMAGING', department: 'Khoa Nội', price: 300000, durationMin: 30 },
    { code: 'IMG_THYROID_ULTRASOUND', name: 'Siêu âm tuyến giáp', description: 'Khảo sát cấu trúc và bất thường tuyến giáp.', category: 'IMAGING', department: 'Khoa Nội', price: 250000, durationMin: 25 },
    { code: 'IMG_BREAST_ULTRASOUND', name: 'Siêu âm vú', description: 'Khảo sát mô tuyến vú và phát hiện bất thường.', category: 'IMAGING', department: 'Khoa Sản – Phụ khoa', price: 300000, durationMin: 30 },
    { code: 'IMG_PREGNANCY_2D', name: 'Siêu âm thai 2D', description: 'Theo dõi sự phát triển cơ bản của thai nhi.', category: 'IMAGING', department: 'Khoa Sản – Phụ khoa', price: 250000, durationMin: 25 },
    { code: 'IMG_PREGNANCY_4D', name: 'Siêu âm thai 4D', description: 'Khảo sát hình thái thai nhi bằng siêu âm 4D.', category: 'IMAGING', department: 'Khoa Sản – Phụ khoa', price: 500000, durationMin: 40 },
    { code: 'IMG_PREGNANCY_DOPPLER', name: 'Siêu âm thai Doppler màu', description: 'Đánh giá dòng máu thai nhi, dây rốn và nhau thai.', category: 'IMAGING', department: 'Khoa Sản – Phụ khoa', price: 450000, durationMin: 40 },
    { code: 'IMG_ECHOCARDIOGRAPHY', name: 'Siêu âm tim', description: 'Đánh giá cấu trúc và chức năng tim.', category: 'IMAGING', department: 'Khoa Nội', price: 500000, durationMin: 40 },
    { code: 'IMG_LOWER_LIMB_VASCULAR', name: 'Siêu âm mạch máu chi dưới', description: 'Đánh giá hệ thống động mạch và tĩnh mạch chi dưới.', category: 'IMAGING', department: 'Khoa Nội', price: 550000, durationMin: 45 },
    { code: 'IMG_XRAY_CHEST', name: 'X-quang kỹ thuật số ngực thẳng', description: 'Khảo sát phổi, tim và lồng ngực.', category: 'IMAGING', department: 'Khoa Nội', price: 200000, durationMin: 20 },
    { code: 'IMG_XRAY_LUMBAR', name: 'X-quang cột sống thắt lưng', description: 'Khảo sát tổn thương và thoái hóa cột sống thắt lưng.', category: 'IMAGING', department: 'Khoa Ngoại', price: 250000, durationMin: 20 },
    { code: 'IMG_XRAY_CERVICAL', name: 'X-quang cột sống cổ', description: 'Khảo sát tổn thương và thoái hóa cột sống cổ.', category: 'IMAGING', department: 'Khoa Ngoại', price: 250000, durationMin: 20 },
    { code: 'IMG_XRAY_LIMB_JOINT', name: 'X-quang xương khớp chi', description: 'Khảo sát gãy xương, trật khớp và tổn thương chi.', category: 'IMAGING', department: 'Khoa Ngoại', price: 220000, durationMin: 20 },

    // Thăm dò chức năng, thủ thuật và điều trị.
    { code: 'PROC_ECG', name: 'Đo điện tâm đồ (ECG)', description: 'Tầm soát thiếu máu cơ tim và rối loạn nhịp.', category: 'PROCEDURE', department: 'Khoa Nội', price: 150000, durationMin: 20 },
    { code: 'PROC_ENT_ENDOSCOPY', name: 'Nội soi Tai Mũi Họng ống mềm', description: 'Nội soi chẩn đoán tai, mũi và họng bằng ống mềm.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 250000, durationMin: 25 },
    { code: 'PROC_WOUND_SUTURE_SMALL', name: 'Khâu vết thương phần mềm dưới 5cm', description: 'Làm sạch và khâu vết thương phần mềm nhỏ.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 350000, durationMin: 30 },
    { code: 'PROC_WOUND_SUTURE_LARGE', name: 'Khâu vết thương phần mềm trên 5cm', description: 'Làm sạch và khâu vết thương phần mềm lớn.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 600000, durationMin: 45 },
    { code: 'PROC_COMPLEX_DRESSING', name: 'Thay băng, rửa vết thương phức tạp', description: 'Làm sạch và thay băng vết thương theo chỉ định.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 150000, durationMin: 25 },
    { code: 'PROC_SUTURE_REMOVAL', name: 'Cắt chỉ vết thương', description: 'Cắt chỉ và kiểm tra tiến triển lành vết thương.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 100000, durationMin: 15 },
    { code: 'PROC_ABSCESS_DRAINAGE', name: 'Trích áp xe', description: 'Rạch dẫn lưu và làm sạch ổ áp xe.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 500000, durationMin: 40 },
    { code: 'PROC_BENIGN_MASS_EXCISION', name: 'Bóc u mỡ, u bã nhờn, u nang lành tính', description: 'Tiểu phẫu loại bỏ khối u lành tính ngoài da.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 1500000, durationMin: 60 },
    { code: 'PROC_SPLINT', name: 'Nẹp cố định chấn thương nhẹ', description: 'Cố định tạm thời vùng chấn thương bằng nẹp.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 300000, durationMin: 30 },
    { code: 'PROC_CAST', name: 'Bó bột chấn thương nhẹ', description: 'Cố định xương khớp bằng bột theo chỉ định.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 600000, durationMin: 45 },
    { code: 'PROC_CIRCUMCISION', name: 'Cắt bao quy đầu', description: 'Tiểu phẫu Nam khoa theo chỉ định bác sĩ.', category: 'PROCEDURE', department: 'Khoa Ngoại', price: 2500000, durationMin: 60 },
    { code: 'PROC_DENTAL_SCALING', name: 'Lấy cao răng & đánh bóng hai hàm', description: 'Làm sạch cao răng và đánh bóng bề mặt răng.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 400000, durationMin: 45 },
    { code: 'PROC_TOOTH_EXTRACTION', name: 'Nhổ răng thường', description: 'Nhổ răng thường theo chỉ định nha khoa.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 400000, durationMin: 40 },
    { code: 'PROC_WISDOM_TOOTH_EXTRACTION', name: 'Nhổ răng khôn', description: 'Tiểu phẫu nhổ răng khôn.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 1500000, durationMin: 60 },
    { code: 'PROC_DENTAL_FILLING', name: 'Trám răng thẩm mỹ', description: 'Phục hồi mô răng bằng vật liệu trám thẩm mỹ.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 350000, durationMin: 45 },
    { code: 'PROC_ROOT_CANAL', name: 'Điều trị tủy răng', description: 'Làm sạch, tạo hình và trám bít hệ thống ống tủy.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 1200000, durationMin: 60 },
    { code: 'PROC_ENT_FOREIGN_BODY', name: 'Lấy dị vật Tai / Mũi / Họng', description: 'Lấy dị vật tai, mũi hoặc họng bằng dụng cụ chuyên khoa.', category: 'PROCEDURE', department: 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt', price: 300000, durationMin: 30 },
    { code: 'PROC_IV_INJECTION', name: 'Tiêm tĩnh mạch', description: 'Thực hiện tiêm tĩnh mạch theo chỉ định bác sĩ.', category: 'PROCEDURE', department: 'Khoa Nội', price: 100000, durationMin: 15 },
    { code: 'PROC_MEDICAL_INFUSION', name: 'Truyền dịch y khoa', description: 'Truyền dịch và theo dõi theo chỉ định bác sĩ.', category: 'PROCEDURE', department: 'Khoa Nội', price: 250000, durationMin: 60 },
  ];
  const medicalServicesByCode = new Map();
  await prisma.medicalService.updateMany({ where: { code: 'ECG-REST' }, data: { isActive: false } });
  for (const service of medicalServiceCatalog) {
    const departmentId = serviceDepartmentIds.get(service.department);
    if (!departmentId) throw new Error(`Không tìm thấy khoa cho dịch vụ ${service.code}: ${service.department}`);
    const { department: _departmentName, ...serviceData } = service;
    const row = await prisma.medicalService.upsert({
      where: { code: service.code },
      update: { ...serviceData, departmentId, isActive: true },
      create: { ...serviceData, departmentId },
    });
    medicalServicesByCode.set(row.code, row);
  }

  // Loại hình khám bắt buộc theo từng chuyên khoa tại chi nhánh.
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
  // Mỗi phòng có thể phục vụ nhiều chuyên khoa; không lặp lại branchId trong bảng nối.
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
      if (!branchBookingMethod) throw new Error(`Chi nhánh chưa cấu hình hình thức ${methodCode}`);
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

  // Gói sức khỏe độc lập chuyên khoa; thành phần được chọn từ medical_services.
  const healthPackageSeeds = [
    { code: 'PKG-GENERAL-BASIC', name: 'Gói khám sức khỏe tổng quát cơ bản', description: 'Tầm soát sức khỏe định kỳ với xét nghiệm và chẩn đoán hình ảnh cơ bản.', price: 1290000, itemCodes: ['LAB_CBC', 'LAB_GLUCOSE_HBA1C', 'LAB_LIVER_FUNCTION', 'LAB_KIDNEY_FUNCTION', 'LAB_URINALYSIS_10', 'IMG_XRAY_CHEST'] },
    { code: 'PKG-CARDIO-SCREENING', name: 'Gói tầm soát nguy cơ tim mạch', description: 'Đánh giá các yếu tố nguy cơ tim mạch bằng xét nghiệm và thăm dò chức năng.', price: 990000, itemCodes: ['LAB_GLUCOSE_HBA1C', 'LAB_LIPID_PROFILE', 'PROC_ECG', 'IMG_ECHOCARDIOGRAPHY'] },
    { code: 'PKG-WOMEN-WELLNESS', name: 'Gói kiểm tra sức khỏe nữ', description: 'Gói kiểm tra sức khỏe định kỳ dành cho nữ.', price: 1490000, itemCodes: ['LAB_CBC', 'LAB_GLUCOSE_HBA1C', 'IMG_BREAST_ULTRASOUND', 'IMG_ABDOMINAL_ULTRASOUND'] },
  ];
  for (const [packageIndex, seed] of healthPackageSeeds.entries()) {
    const { itemCodes, ...packageData } = seed;
    const healthPackageMethod = branchMethodByCode.get('HEALTH_PACKAGE');
    if (!healthPackageMethod) throw new Error('Chi nhánh chưa cấu hình hình thức HEALTH_PACKAGE');
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
        create: {
          servicePackageId: healthPackage.id,
          roomId,
          examDate,
        },
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
  const ecgService = medicalServicesByCode.get('PROC_ECG');
  await prisma.inventoryMovement.deleteMany({ where: { referenceId: 'SEED-INITIAL-STOCK-AMLO' } });
  for (const medicine of medicinesByCode.values()) {
    await prisma.inventoryStock.upsert({ where: { branchId_medicineId: { branchId: branches[0].id, medicineId: medicine.id } }, update: { quantity: medicine.stockQuantity }, create: { branchId: branches[0].id, medicineId: medicine.id, quantity: medicine.stockQuantity } });
    const referenceId = `SEED-STOCK:${medicine.code}`;
    await prisma.inventoryMovement.deleteMany({ where: { referenceId } });
    await prisma.inventoryMovement.create({ data: { branchId: branches[0].id, medicineId: medicine.id, type: 'IMPORT', quantity: medicine.stockQuantity, referenceId, note: 'Tồn kho khởi tạo cho dữ liệu demo', createdById: pharmacist.id } });
  }
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

main().finally(() => prisma.$disconnect());
