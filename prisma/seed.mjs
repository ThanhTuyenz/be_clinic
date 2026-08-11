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

async function main() {
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

    const existingTemplate = await prisma.doctorScheduleTemplate.findFirst({
      where: { doctorId: doctor.id, branchId: branches[0].id, dayOfWeek: 1, isActive: true },
    });
    if (existingTemplate) {
      await prisma.doctorScheduleTemplate.update({ where: { id: existingTemplate.id }, data: { shiftStartTime: time(8), shiftEndTime: time(11, 30), slotDurationMin: 60, defaultCapacity: 5, validFrom: dateOnly(0) } });
    } else {
      await prisma.doctorScheduleTemplate.create({ data: { doctorId: doctor.id, branchId: branches[0].id, dayOfWeek: 1, shiftStartTime: time(8), shiftEndTime: time(11, 30), slotDurationMin: 60, defaultCapacity: 5, validFrom: dateOnly(0) } });
    }

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
        update: { status: 'OPEN', roomId: input.room.id },
        create: { doctorId: doctor.id, branchId: branches[0].id, roomId: input.room.id, workDate, startTime: time(8), endTime: time(11, 30), status: 'OPEN' },
      });
      for (const [startHour, endHour, endMinute, capacity] of [[8, 9, 0, 5], [9, 10, 0, 5], [10, 11, 0, 5], [11, 11, 30, 2]]) {
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
        await prisma.doctorScheduleSlot.upsert({ where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } }, update: { endTime: slot.endTime, capacity: 1, isActive: true }, create: { scheduleId: schedule.id, startTime: slot.startTime, endTime: slot.endTime, capacity: 1 } });
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

  await seedAuthTables(users, patient);
  await seedBookingTables({ users, doctors, branches, rooms });
  console.log('Seed completed without appointments. Every specialty has a doctor. Test password: VitaCare@123');
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

async function seedBookingTables({ users, doctors, branches, rooms }) {
  const cardioDoctor = doctors.get('doctor.cardio@vitacare.local');
  if (!cardioDoctor) throw new Error('Không tìm thấy bác sĩ Tim mạch để seed danh mục');
  if (!rooms[0] || rooms[0].branchId !== branches[0].id) throw new Error('Không tìm thấy phòng khám hợp lệ tại chi nhánh chính để seed gói khám');
  const configuredMethods = await prisma.branchBookingMethod.findMany({ where: { branchId: branches[0].id }, include: { bookingMethod: true } });
  const branchMethodByCode = new Map(configuredMethods.map((item) => [item.bookingMethod.code, item]));
  const pharmacist = users.get('pharmacist@vitacare.local');
  const patientUser = users.get('patient@vitacare.local');
  await prisma.icd10Code.upsert({
    where: { code: 'I10' },
    update: { description: 'Tăng huyết áp vô căn', isActive: true },
    create: { code: 'I10', description: 'Tăng huyết áp vô căn', isActive: true },
  });
  const amlodipine = await prisma.medicine.upsert({
    where: { code: 'MED-AMLO-5' },
    update: { name: 'Amlodipine', activeIngredient: 'Amlodipine', strength: '5 mg', unit: 'viên', unitPrice: 1200, stockQuantity: 500, isActive: true },
    create: { code: 'MED-AMLO-5', name: 'Amlodipine', activeIngredient: 'Amlodipine', strength: '5 mg', unit: 'viên', unitPrice: 1200, stockQuantity: 500 },
  });
  const serviceDepartmentRows = await prisma.department.findMany({
    where: { name: { in: ['Khoa Nội', 'Khoa Ngoại', 'Khoa Sản – Phụ khoa', 'Khoa Chuyên khoa Giác quan & Răng Hàm Mặt'] } },
    select: { id: true, name: true },
  });
  const serviceDepartmentIds = new Map(serviceDepartmentRows.map((department) => [department.name, department.id]));
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
  for (const specialty of bookingSpecialties) {
    const codeSuffix = String(specialty.id).padStart(3, '0');
    const specialtyServices = [
      { code: `CONSULT-${codeSuffix}-STANDARD`, name: 'Khám dịch vụ', price: 220000, durationMin: 30, description: 'Khám trong giờ hành chính theo lịch của chuyên khoa.' },
      { code: `CONSULT-${codeSuffix}-AFTER`, name: 'Khám dịch vụ ngoài giờ', price: 270000, durationMin: 30, description: 'Khám ngoài giờ hành chính theo lịch được công bố.' },
      { code: `CONSULT-${codeSuffix}-FOLLOWUP`, name: 'Tái khám', price: 180000, durationMin: 20, description: 'Tái khám theo chỉ định của bác sĩ.' },
      { code: `CONSULT-${codeSuffix}-ADVICE`, name: 'Tư vấn khám bệnh', price: 150000, durationMin: 20, description: 'Tư vấn ban đầu với bác sĩ chuyên khoa trước khi quyết định lịch khám phù hợp.' },
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
      let scheduleDays = 0;
      for (let day = 1; scheduleDays < 10; day += 1) {
        const examDate = dateOnly(day);
        if ([0, 6].includes(examDate.getUTCDay())) continue;
        const schedule = await prisma.servicePackageSchedule.upsert({
          where: { servicePackageId_examDate: { servicePackageId: servicePackage.id, examDate } },
          update: { isActive: true }, create: { servicePackageId: servicePackage.id, examDate },
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
  await prisma.inventoryStock.upsert({
    where: { branchId_medicineId: { branchId: branches[0].id, medicineId: amlodipine.id } },
    update: { quantity: 500 },
    create: { branchId: branches[0].id, medicineId: amlodipine.id, quantity: 500 },
  });
  await prisma.inventoryMovement.deleteMany({
    where: { referenceId: 'SEED-INITIAL-STOCK-AMLO' },
  });
  await prisma.inventoryMovement.create({
    data: {
      branchId: branches[0].id,
      medicineId: amlodipine.id,
      type: 'IMPORT',
      quantity: 500,
      referenceId: 'SEED-INITIAL-STOCK-AMLO',
      note: 'Nhập kho ban đầu từ seed data',
      createdById: pharmacist.id,
    },
  });
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
