import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
  {
    email: 'patient01@vitacare.local',
    phoneNumber: '0901234001',
    patientCode: 'BN2600003',
    nationalId: '079198000101',
    dateOfBirth: '1988-03-12',
    gender: 'FEMALE',
    address: '12 Đường Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM',
    bloodGroup: 'O+',
    allergies: 'Không',
    height: 162,
    weight: 54,
    medicalHistory: 'Không có tiền sử bệnh lý mạn tính',
  },
  {
    email: 'patient02@vitacare.local',
    phoneNumber: '0901234002',
    patientCode: 'BN2600004',
    nationalId: '079199000102',
    dateOfBirth: '1992-07-25',
    gender: 'MALE',
    address: '45 Điện Biên Phủ, Phường 15, Quận Bình Thạnh, TP.HCM',
    bloodGroup: 'A+',
    allergies: 'Dị ứng phấn hoa',
    height: 175,
    weight: 70,
    medicalHistory: 'Viêm mũi dị ứng thời tiết',
  },
  {
    email: 'patient03@vitacare.local',
    phoneNumber: '0901234003',
    patientCode: 'BN2600005',
    nationalId: '079200000103',
    dateOfBirth: '1995-11-08',
    gender: 'FEMALE',
    address: '78 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM',
    bloodGroup: 'B+',
    allergies: 'Hải sản',
    height: 158,
    weight: 50,
    medicalHistory: 'Đau dạ dày nhẹ do thói quen ăn uống',
  },
  {
    email: 'patient04@vitacare.local',
    phoneNumber: '0901234004',
    patientCode: 'BN2600006',
    nationalId: '079201000104',
    dateOfBirth: '1985-01-30',
    gender: 'MALE',
    address: '101 Nguyễn Thị Thập, Phường Tân Phú, Quận 7, TP.HCM',
    bloodGroup: 'AB+',
    allergies: 'Kháng sinh Penicillin',
    height: 170,
    weight: 68,
    medicalHistory: 'Tiền sử tăng huyết áp nhẹ có kiểm soát',
  },
  {
    email: 'patient05@vitacare.local',
    phoneNumber: '0901234005',
    patientCode: 'BN2600007',
    nationalId: '079202000105',
    dateOfBirth: '1998-09-16',
    gender: 'FEMALE',
    address: '23 Quang Trung, Phường 10, Quận Gò Vấp, TP.HCM',
    bloodGroup: 'O+',
    allergies: 'Không',
    height: 165,
    weight: 55,
    medicalHistory: 'Sức khỏe bình thường',
  },
];

function dateOnly(daysFromNow) {
  const localNow = new Date();
  return new Date(Date.UTC(localNow.getFullYear(), localNow.getMonth(), localNow.getDate() + daysFromNow));
}

function time(hour, minute = 0) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
}

function toSlug(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function doctorSlots() {
  const slots = [];
  for (const [startHour, startMinute, endHour, endMinute] of [
    [8, 0, 11, 30],
    [13, 30, 16, 30],
  ]) {
    let cursor = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    while (cursor < end) {
      slots.push({
        startTime: time(Math.floor(cursor / 60), cursor % 60),
        endTime: time(Math.floor((cursor + 30) / 60), (cursor + 30) % 60),
        capacity: 10,
      });
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

  console.log('1. Khởi tạo tài khoản hệ thống...');
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

  console.log('2. Khởi tạo phòng khám & chi nhánh (VC-CENTRAL, VC-EAST)...');
  const clinic = await prisma.clinic.upsert({
    where: { slug: 'vitacare-clinic' },
    update: { name: 'VitaCare Clinic', isActive: true },
    create: { name: 'VitaCare Clinic', slug: 'vitacare-clinic' },
  });

  const branchInputs = [
    {
      code: 'VC-CENTRAL',
      name: 'VitaCare Trung tâm',
      slug: 'vitacare-trung-tam',
      address: '201 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, TP.HCM',
      phoneNumber: '02839123456',
      latitude: 10.7769,
      longitude: 106.7009,
    },
    {
      code: 'VC-EAST',
      name: 'VitaCare Cơ sở Đông',
      slug: 'vitacare-co-so-dong',
      address: '15 Võ Văn Ngân, Phường Linh Chiểu, TP. Thủ Đức, TP.HCM',
      phoneNumber: '02839654321',
      latitude: 10.8499,
      longitude: 106.7719,
    },
  ];
  const branches = [];
  for (const item of branchInputs) {
    branches.push(
      await prisma.branch.upsert({
        where: { code: item.code },
        update: { ...item, clinicId: clinic.id, isActive: true },
        create: { ...item, clinicId: clinic.id, isActive: true },
      })
    );
  }

  console.log('3. Khởi tạo phương thức đặt khám...');
  const bookingMethodSeeds = [
    ['SPECIALTY_EXAM', 'Đặt khám theo chuyên khoa', 'Chọn chuyên khoa, dịch vụ, bác sĩ và thời gian khám.', '/dat-lich?type=specialty', 1],
    ['HEALTH_PACKAGE', 'Gói khám sức khỏe', 'Đăng ký gói khám sức khỏe theo lịch của cơ sở.', '/dich-vu?view=health-packages', 2],
    ['CONSULTATION', 'Tư vấn khám bệnh', 'Tư vấn ban đầu với bác sĩ trước khi đặt lịch khám.', '/dat-lich?type=consultation', 3],
    ['AFTER_HOURS', 'Đặt khám ngoài giờ', 'Đặt lịch khám ngoài khung giờ hành chính.', '/dat-lich?type=after-hours', 4],
  ];
  const bookingMethods = new Map();
  for (const [code, name, description, route] of bookingMethodSeeds) {
    bookingMethods.set(
      code,
      await prisma.bookingMethod.upsert({
        where: { code },
        update: { name, description, route, isActive: true },
        create: { code, name, description, route, isActive: true },
      })
    );
  }
  for (const branch of branches) {
    for (const [code, , , , sortOrder] of bookingMethodSeeds) {
      const bookingMethod = bookingMethods.get(code);
      await prisma.branchBookingMethod.upsert({
        where: { branchId_bookingMethodId: { branchId: branch.id, bookingMethodId: bookingMethod.id } },
        update: { sortOrder, isEnabled: true },
        create: { branchId: branch.id, bookingMethodId: bookingMethod.id, sortOrder, isEnabled: true },
      });
    }
  }

  console.log('4. Khởi tạo các phòng khám (Rooms)...');
  const centralRooms = [];
  for (const [code, name] of [
    ['P100', 'Phòng tiếp nhận & Khám ban đầu'],
    ['P101', 'Phòng khám Nội 101'],
    ['P102', 'Phòng khám Nhi 102'],
    ['P103', 'Phòng khám Tim mạch 103'],
    ['P104', 'Phòng khám Tiêu hóa 104'],
    ['P105', 'Phòng khám Hô hấp 105'],
    ['P106', 'Phòng khám Tai Mũi Họng 106'],
    ['P107', 'Phòng khám Mắt 107'],
    ['P108', 'Phòng khám Da liễu 108'],
    ['LAB01', 'Phòng xét nghiệm'],
    ['XRAY01', 'Phòng X-quang'],
    ['US01', 'Phòng siêu âm'],
  ]) {
    centralRooms.push(
      await prisma.clinicRoom.upsert({
        where: { branchId_code: { branchId: branches[0].id, code } },
        update: { name, isActive: true },
        create: { branchId: branches[0].id, code, name, isActive: true },
      })
    );
  }

  const eastRooms = [];
  for (const [code, name] of [
    ['P200', 'Phòng tiếp nhận Cơ sở Đông'],
    ['P201', 'Phòng khám Đa khoa 201'],
    ['P202', 'Phòng khám Chuyên khoa 202'],
    ['P203', 'Phòng khám Tim mạch 203'],
    ['P204', 'Phòng khám Nhi 204'],
    ['P205', 'Phòng khám Mắt & TMH 205'],
    ['LAB02', 'Phòng xét nghiệm Cơ sở Đông'],
    ['XRAY02', 'Phòng X-quang Cơ sở Đông'],
    ['US02', 'Phòng siêu âm Cơ sở Đông'],
  ]) {
    eastRooms.push(
      await prisma.clinicRoom.upsert({
        where: { branchId_code: { branchId: branches[1].id, code } },
        update: { name, isActive: true },
        create: { branchId: branches[1].id, code, name, isActive: true },
      })
    );
  }

  // Gán cơ sở chính cho Manager & Lễ tân
  for (const email of ['manager@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: users.get(email).id, branchId: branches[0].id } },
      update: { isPrimary: true },
      create: { userId: users.get(email).id, branchId: branches[0].id, isPrimary: true },
    });
  }

  console.log('5. Khởi tạo danh mục 14 chuyên khoa...');
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

  // Gán tất cả chuyên khoa cho cả 2 cơ sở
  const allSpecialties = [...specialtiesByName.values()];
  for (const branch of branches) {
    for (const spec of allSpecialties) {
      await prisma.branchSpecialty.upsert({
        where: { branchId_specialtyId: { branchId: branch.id, specialtyId: spec.id } },
        update: { isActive: true },
        create: { branchId: branch.id, specialtyId: spec.id, isActive: true },
      });
    }
  }

  // Gán chuyên khoa cho phòng khám
  const allRooms = [...centralRooms, ...eastRooms];
  for (const room of allRooms) {
    for (const [priority, spec] of allSpecialties.entries()) {
      await prisma.clinicRoomSpecialty.upsert({
        where: { roomId_specialtyId: { roomId: room.id, specialtyId: spec.id } },
        update: { isActive: true, priority: allSpecialties.length - priority },
        create: { roomId: room.id, specialtyId: spec.id, priority: allSpecialties.length - priority, isActive: true },
      });
    }
  }

  console.log('6. Khởi tạo bác sĩ & lịch làm việc cho cả 2 cơ sở...');
  const cardioSpecialty = specialtiesByName.get('Tim mạch');
  const pediatricsSpecialty = specialtiesByName.get('Nhi khoa');

  const doctorInputs = [
    { email: 'doctor.cardio@vitacare.local', specialty: cardioSpecialty, fee: 300000, roomCentral: centralRooms[3], roomEast: eastRooms[3], avatarUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=400' },
    { email: 'doctor.pediatrics@vitacare.local', specialty: pediatricsSpecialty, fee: 250000, roomCentral: centralRooms[2], roomEast: eastRooms[4], avatarUrl: 'https://images.unsplash.com/photo-1594824813580-c116d44524c5?auto=format&fit=crop&q=80&w=400' },
  ];
  const doctors = new Map();

  for (const input of doctorInputs) {
    const user = users.get(input.email);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { consultationFee: input.fee, isActive: true, isFeatured: true, avatarUrl: input.avatarUrl },
      create: { userId: user.id, consultationFee: input.fee, academicRank: 'Bác sĩ CKI', isFeatured: true, avatarUrl: input.avatarUrl },
    });
    doctors.set(input.email, doctor);

    await prisma.doctorSpecialty.upsert({
      where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: input.specialty.id } },
      update: { isPrimary: true },
      create: { doctorId: doctor.id, specialtyId: input.specialty.id, isPrimary: true },
    });

    for (const [idx, branch] of branches.entries()) {
      await prisma.userBranchAssignment.upsert({
        where: { userId_branchId: { userId: user.id, branchId: branch.id } },
        update: { isPrimary: idx === 0 },
        create: { userId: user.id, branchId: branch.id, isPrimary: idx === 0 },
      });

      const assignedRoom = idx === 0 ? input.roomCentral : input.roomEast;
      for (let day = 0; day <= 28; day += 1) {
        const workDate = dateOnly(day);
        if (workDate.getUTCDay() === 0 && day !== 0) continue;
        const schedule = await prisma.doctorSchedule.upsert({
          where: {
            doctorId_branchId_workDate_startTime: {
              doctorId: doctor.id,
              branchId: branch.id,
              workDate,
              startTime: time(8),
            },
          },
          update: { status: 'OPEN', roomId: assignedRoom.id, slotDurationMin: 60, capacityPerSlot: 10 },
          create: {
            doctorId: doctor.id,
            branchId: branch.id,
            roomId: assignedRoom.id,
            workDate,
            startTime: time(8),
            endTime: time(11, 30),
            slotDurationMin: 60,
            capacityPerSlot: 10,
            status: 'OPEN',
          },
        });
        for (const [startHour, endHour, endMinute, capacity] of [
          [8, 9, 0, 10],
          [9, 10, 0, 10],
          [10, 11, 0, 10],
          [11, 11, 30, 10],
        ]) {
          await prisma.doctorScheduleSlot.upsert({
            where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: time(startHour) } },
            update: { endTime: time(endHour, endMinute), capacity, isActive: true },
            create: {
              scheduleId: schedule.id,
              startTime: time(startHour),
              endTime: time(endHour, endMinute),
              capacity,
            },
          });
        }
      }
    }
  }

  // Khởi tạo bác sĩ cho các chuyên khoa còn lại
  const defaultDoctorAvatars = [
    'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1582750433449-648ed127bb54?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1622902046580-2b47f47f5471?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&q=80&w=400',
    'https://images.unsplash.com/photo-1623854767648-e7bb8009f0db?auto=format&fit=crop&q=80&w=400',
  ];

  for (const [index, specialty] of allSpecialties.entries()) {
    if ([cardioSpecialty.id, pediatricsSpecialty.id].includes(specialty.id)) continue;
    const email = `doctor.specialty.${specialty.id}@vitacare.local`;
    const fullName = `BS. ${specialty.name}`;
    const avatarUrl = defaultDoctorAvatars[index % defaultDoctorAvatars.length];
    const user = await prisma.user.upsert({
      where: { email },
      update: { fullName, role: 'DOCTOR', status: 'ACTIVE', isBlocked: false, isDeleted: false },
      create: { email, fullName, role: 'DOCTOR', status: 'ACTIVE', provider: 'EMAIL', password },
    });
    users.set(email, user);

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { consultationFee: 250000, isActive: true, avatarUrl },
      create: { userId: user.id, consultationFee: 250000, academicRank: 'Bác sĩ CKI', isActive: true, avatarUrl },
    });
    doctors.set(email, doctor);

    await prisma.doctorSpecialty.upsert({
      where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: specialty.id } },
      update: { isPrimary: true },
      create: { doctorId: doctor.id, specialtyId: specialty.id, isPrimary: true },
    });

    for (const [branchIdx, branch] of branches.entries()) {
      await prisma.userBranchAssignment.upsert({
        where: { userId_branchId: { userId: user.id, branchId: branch.id } },
        update: { isPrimary: branchIdx === 0 },
        create: { userId: user.id, branchId: branch.id, isPrimary: branchIdx === 0 },
      });

      const branchRooms = branchIdx === 0 ? centralRooms : eastRooms;
      const room = branchRooms[(index + 1) % branchRooms.length];

      let weekdaysCreated = 0;
      for (let day = 1; weekdaysCreated < 14; day += 1) {
        const workDate = dateOnly(day);
        if ([0, 6].includes(workDate.getUTCDay())) continue;

        const schedule = await prisma.doctorSchedule.upsert({
          where: {
            doctorId_branchId_workDate_startTime: {
              doctorId: doctor.id,
              branchId: branch.id,
              workDate,
              startTime: time(8),
            },
          },
          update: { roomId: room.id, endTime: time(16, 30), status: 'OPEN', capacityPerSlot: 10 },
          create: {
            doctorId: doctor.id,
            branchId: branch.id,
            roomId: room.id,
            workDate,
            startTime: time(8),
            endTime: time(16, 30),
            capacityPerSlot: 10,
            status: 'OPEN',
          },
        });
        for (const slot of doctorSlots()) {
          await prisma.doctorScheduleSlot.upsert({
            where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: slot.startTime } },
            update: { endTime: slot.endTime, capacity: 10, isActive: true },
            create: {
              scheduleId: schedule.id,
              startTime: slot.startTime,
              endTime: slot.endTime,
              capacity: 10,
            },
          });
        }
        weekdaysCreated += 1;
      }
    }
  }

  console.log('7. Khởi tạo dịch vụ chuyên khoa & gói khám sức khỏe...');
  for (const branch of branches) {
    const configuredMethods = await prisma.branchBookingMethod.findMany({
      where: { branchId: branch.id },
      include: { bookingMethod: true },
    });
    const branchMethodByCode = new Map(configuredMethods.map((item) => [item.bookingMethod.code, item]));

    for (const specialty of allSpecialties) {
      const codeSuffix = `${branch.code.replace('VC-', '')}-${String(specialty.id).padStart(3, '0')}`;
      const specialtyName = String(specialty.name || 'chuyên khoa').trim().replace(/^Khám\s+/i, '');

      const specialtyServices = [
        {
          code: `CONSULT-${codeSuffix}-STANDARD`,
          name: `Khám ${specialtyName} trong giờ (${branch.name})`,
          price: 220000,
          durationMin: 30,
          description: `Khám ban đầu các triệu chứng và bệnh lý thuộc ${specialtyName}, thực hiện trong giờ hành chính.`,
        },
        {
          code: `CONSULT-${codeSuffix}-AFTER`,
          name: `Khám ${specialtyName} ngoài giờ (${branch.name})`,
          price: 270000,
          durationMin: 30,
          description: `Khám các triệu chứng và bệnh lý thuộc ${specialtyName} ngoài giờ hành chính theo lịch được công bố.`,
        },
        {
          code: `CONSULT-${codeSuffix}-FOLLOWUP`,
          name: `Tái khám ${specialtyName} (${branch.name})`,
          price: 180000,
          durationMin: 20,
          description: `Theo dõi đáp ứng điều trị, xem lại kết quả và điều chỉnh kế hoạch điều trị thuộc ${specialtyName}.`,
        },
        {
          code: `CONSULT-${codeSuffix}-ADVICE`,
          name: `Tư vấn ${specialtyName} (${branch.name})`,
          price: 150000,
          durationMin: 20,
          description: `Tư vấn ban đầu về triệu chứng, nguy cơ và hướng thăm khám phù hợp thuộc ${specialtyName}.`,
        },
      ];

      for (const service of specialtyServices) {
        const methodCode = service.code.endsWith('-AFTER')
          ? 'AFTER_HOURS'
          : service.code.endsWith('-ADVICE')
          ? 'CONSULTATION'
          : 'SPECIALTY_EXAM';
        const branchBookingMethod = branchMethodByCode.get(methodCode);
        if (!branchBookingMethod) continue;
        const slug = toSlug(service.name);
        await prisma.servicePackage.upsert({
          where: { code: service.code },
          update: {
            ...service,
            slug,
            branchBookingMethodId: branchBookingMethod.id,
            specialtyId: specialty.id,
            isActive: true,
          },
          create: {
            ...service,
            slug,
            branchBookingMethodId: branchBookingMethod.id,
            specialtyId: specialty.id,
            isActive: true,
          },
        });
      }
    }

    const healthPackageSeeds = [
      {
        code: `PKG-GENERAL-BASIC-${branch.code}`,
        name: `Gói khám sức khỏe tổng quát cơ bản (${branch.name})`,
        description: 'Tầm soát sức khỏe định kỳ với xét nghiệm và chẩn đoán hình ảnh cơ bản.',
        price: 1290000,
      },
      {
        code: `PKG-CARDIO-SCREENING-${branch.code}`,
        name: `Gói tầm soát nguy cơ tim mạch (${branch.name})`,
        description: 'Đánh giá các yếu tố nguy cơ tim mạch bằng xét nghiệm và thăm dò chức năng.',
        price: 990000,
      },
      {
        code: `PKG-WOMEN-WELLNESS-${branch.code}`,
        name: `Gói kiểm tra sức khỏe nữ (${branch.name})`,
        description: 'Gói kiểm tra sức khỏe định kỳ dành cho nữ.',
        price: 1490000,
      },
      {
        code: `PKG-EYE-COMPREHENSIVE-${branch.code}`,
        name: `Gói khám Mắt toàn diện & Đo thị lực khúc xạ (${branch.name})`,
        description: 'Kiểm tra thị lực, soi đáy mắt, đo nhãn áp và tầm soát các tật khúc xạ mắt.',
        price: 350000,
      },
      {
        code: `PKG-EYE-CATARACT-${branch.code}`,
        name: `Gói tầm soát cườm nước & Bệnh lý võng mạc (${branch.name})`,
        description: 'Chụp hình màu đáy mắt, đo nhãn áp không tiếp xúc và tư vấn phòng ngừa mù lòa.',
        price: 650000,
      },
    ];

    const healthPackageMethod = branchMethodByCode.get('HEALTH_PACKAGE');
    if (healthPackageMethod) {
      for (const seed of healthPackageSeeds) {
        const slug = toSlug(seed.name);
        await prisma.servicePackage.upsert({
          where: { code: seed.code },
          update: {
            ...seed,
            slug,
            branchBookingMethodId: healthPackageMethod.id,
            isActive: true,
          },
          create: {
            ...seed,
            slug,
            branchBookingMethodId: healthPackageMethod.id,
            isActive: true,
          },
        });
      }
    }
  }

  console.log('8. Khởi tạo hồ sơ bệnh nhân mẫu & thông tin y tế...');
  const patient = users.get('patient@vitacare.local');
  await prisma.user.update({
    where: { id: patient.id },
    data: { phoneNumber: '0909123456' },
  });

  await prisma.patientProfile.upsert({
    where: { accountId_nationalId: { accountId: patient.id, nationalId: '079200000001' } },
    update: {
      accountId: patient.id,
      fullName: patient.fullName,
      phoneNumber: '0909123456',
      patientCode: 'BN2600001',
      address: '123 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, TP.HCM',
      bloodGroup: 'O+',
      allergies: 'Không',
      height: 172,
      weight: 65,
      medicalHistory: 'Không có bệnh mạn tính',
      isMainProfile: true,
    },
    create: {
      accountId: patient.id,
      fullName: patient.fullName,
      phoneNumber: '0909123456',
      patientCode: 'BN2600001',
      nationalId: '079200000001',
      dateOfBirth: new Date('2000-01-15T00:00:00.000Z'),
      gender: 'MALE',
      address: '123 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, TP.HCM',
      bloodGroup: 'O+',
      allergies: 'Không',
      height: 172,
      weight: 65,
      medicalHistory: 'Không có bệnh mạn tính',
      relationshipToAccount: 'SELF',
      isMainProfile: true,
    },
  });

  await prisma.patientProfile.upsert({
    where: { accountId_nationalId: { accountId: patient.id, nationalId: '079201000002' } },
    update: {
      accountId: patient.id,
      fullName: 'Nguyễn Minh An',
      phoneNumber: '0909123456',
      patientCode: 'BN2600002',
      address: '123 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, TP.HCM',
      bloodGroup: 'O+',
      allergies: 'Không',
      height: 120,
      weight: 23,
      medicalHistory: 'Trẻ phát triển bình thường',
      relationshipToAccount: 'CHILD',
      isMainProfile: false,
    },
    create: {
      accountId: patient.id,
      fullName: 'Nguyễn Minh An',
      phoneNumber: '0909123456',
      patientCode: 'BN2600002',
      nationalId: '079201000002',
      dateOfBirth: new Date('2018-05-20T00:00:00.000Z'),
      gender: 'MALE',
      address: '123 Nguyễn Thị Minh Khai, Phường Bến Thành, Quận 1, TP.HCM',
      bloodGroup: 'O+',
      allergies: 'Không',
      height: 120,
      weight: 23,
      medicalHistory: 'Trẻ phát triển bình thường',
      relationshipToAccount: 'CHILD',
      isMainProfile: false,
    },
  });

  for (const patientSeed of additionalPatientSeeds) {
    const account = users.get(patientSeed.email);
    if (patientSeed.phoneNumber) {
      await prisma.user.update({
        where: { id: account.id },
        data: { phoneNumber: patientSeed.phoneNumber },
      });
    }
    await prisma.patientProfile.upsert({
      where: { accountId_nationalId: { accountId: account.id, nationalId: patientSeed.nationalId } },
      update: {
        accountId: account.id,
        fullName: account.fullName,
        phoneNumber: patientSeed.phoneNumber,
        patientCode: patientSeed.patientCode,
        dateOfBirth: new Date(`${patientSeed.dateOfBirth}T00:00:00.000Z`),
        gender: patientSeed.gender,
        address: patientSeed.address,
        bloodGroup: patientSeed.bloodGroup,
        allergies: patientSeed.allergies,
        height: patientSeed.height,
        weight: patientSeed.weight,
        medicalHistory: patientSeed.medicalHistory,
        relationshipToAccount: 'SELF',
        isMainProfile: true,
      },
      create: {
        accountId: account.id,
        fullName: account.fullName,
        phoneNumber: patientSeed.phoneNumber,
        patientCode: patientSeed.patientCode,
        nationalId: patientSeed.nationalId,
        dateOfBirth: new Date(`${patientSeed.dateOfBirth}T00:00:00.000Z`),
        gender: patientSeed.gender,
        address: patientSeed.address,
        bloodGroup: patientSeed.bloodGroup,
        allergies: patientSeed.allergies,
        height: patientSeed.height,
        weight: patientSeed.weight,
        medicalHistory: patientSeed.medicalHistory,
        relationshipToAccount: 'SELF',
        isMainProfile: true,
      },
    });
  }

  // ============================================================
  // 8b. Seed Appointments mẫu cho patient@vitacare.local
  // ============================================================
  console.log('8b. Khởi tạo lịch khám mẫu cho patient@vitacare.local...');
  {
    const mainPatient = users.get('patient@vitacare.local');
    const cardioDoc = doctors.get('doctor.cardio@vitacare.local');
    const pedDoc = doctors.get('doctor.pediatrics@vitacare.local');
    const branch = branches[0];

    const mainProfile = await prisma.patientProfile.findFirst({
      where: { accountId: mainPatient.id, isMainProfile: true },
    });

    if (mainProfile && cardioDoc && pedDoc) {
      const cardioSlot = await prisma.doctorScheduleSlot.findFirst({
        where: { schedule: { doctorId: cardioDoc.id, branchId: branch.id } },
        include: { schedule: true },
        orderBy: { createdAt: 'asc' },
      });
      const pedSlot = await prisma.doctorScheduleSlot.findFirst({
        where: { schedule: { doctorId: pedDoc.id, branchId: branch.id } },
        include: { schedule: true },
        orderBy: { createdAt: 'asc' },
      });
      const cardioSlotFuture = await prisma.doctorScheduleSlot.findFirst({
        where: { schedule: { doctorId: cardioDoc.id, branchId: branch.id } },
        include: { schedule: true },
        orderBy: { createdAt: 'desc' },
      });

      const cardioFollowupService = await prisma.servicePackage.findFirst({
        where: { specialtyId: cardioSpecialty.id, code: { contains: 'FOLLOWUP' }, branchBookingMethod: { branchId: branch.id } },
      });

      const cardioScreeningPackage = await prisma.servicePackage.findFirst({
        where: { code: `PKG-CARDIO-SCREENING-${branch.code}` },
      });

      const pedStandardService = await prisma.servicePackage.findFirst({
        where: { specialtyId: pediatricsSpecialty.id, code: { contains: 'STANDARD' }, branchBookingMethod: { branchId: branch.id } },
      });

      // Chỉ dùng fields có trong bảng appointments, giá đúng theo gói khám và bác sĩ đã import
      const appointmentSeeds = [
        // 1. COMPLETED - Tim mạch (30 ngày trước) → Gói tầm soát nguy cơ tim mạch
        {
          id: 'a0000000-0000-4000-8000-000000000001',
          bookingCode: 'BK-SEED-001',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: cardioSlot?.id ?? null,
          servicePackageId: cardioScreeningPackage?.id ?? null,
          servicePrice: Number(cardioScreeningPackage?.price ?? 990000),
          status: 'COMPLETED',
          queueNumber: 3,
          checkedInAt: dateOnly(-30),
          rescheduleCount: 0,
        },
        // 2. COMPLETED - Nhi khoa (60 ngày trước) → Khám Nhi khoa trong giờ
        {
          id: 'a0000000-0000-4000-8000-000000000002',
          bookingCode: 'BK-SEED-002',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: pedSlot?.id ?? null,
          servicePackageId: pedStandardService?.id ?? null,
          servicePrice: Number(pedStandardService?.price ?? 220000),
          status: 'COMPLETED',
          queueNumber: 5,
          checkedInAt: dateOnly(-60),
          rescheduleCount: 0,
        },
        // 3. CANCELLED - Tim mạch (Khám chuyên khoa với BS. Tâm)
        {
          id: 'a0000000-0000-4000-8000-000000000003',
          bookingCode: 'BK-SEED-003',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: cardioSlot?.id ?? null,
          servicePackageId: null,
          servicePrice: Number(cardioDoc.consultationFee ?? 300000),
          status: 'CANCELLED',
          queueNumber: null,
          checkedInAt: null,
          rescheduleCount: 0,
          symptomsDescription: 'Đau ngực, khó thở khi gắng sức',
        },
        // 4. CANCELLED - Nhi khoa (Khám chuyên khoa với BS. Hà)
        {
          id: 'a0000000-0000-4000-8000-000000000004',
          bookingCode: 'BK-SEED-004',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: pedSlot?.id ?? null,
          servicePackageId: null,
          servicePrice: Number(pedDoc.consultationFee ?? 250000),
          status: 'CANCELLED',
          queueNumber: null,
          checkedInAt: null,
          rescheduleCount: 1,
          symptomsDescription: 'Kiểm tra sức khỏe định kỳ',
        },
        // 5. BOOKED - Lịch sắp tới → Tái khám Tim mạch
        {
          id: 'a0000000-0000-4000-8000-000000000005',
          bookingCode: 'BK-SEED-005',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: cardioSlotFuture?.id ?? null,
          servicePackageId: cardioFollowupService?.id ?? null,
          servicePrice: Number(cardioFollowupService?.price ?? 180000),
          status: 'BOOKED',
          queueNumber: null,
          checkedInAt: null,
          rescheduleCount: 0,
        },
        // 6. CHECKED_IN - Đang chờ khám → Khám chuyên khoa với BS. Tâm
        {
          id: 'a0000000-0000-4000-8000-000000000006',
          bookingCode: 'BK-SEED-006',
          patientProfileId: mainProfile.id,
          branchId: branch.id,
          scheduleSlotId: cardioSlot?.id ?? null,
          servicePackageId: null,
          servicePrice: Number(cardioDoc.consultationFee ?? 300000),
          status: 'CHECKED_IN',
          queueNumber: 2,
          checkedInAt: new Date(),
          rescheduleCount: 0,
        },
      ];

      for (const appt of appointmentSeeds) {
        const { id, checkedInAt, ...rest } = appt;
        await prisma.appointment.upsert({
          where: { id },
          update: { ...rest, ...(checkedInAt ? { checkedInAt } : {}) },
          create: { id, ...rest, ...(checkedInAt ? { checkedInAt } : {}) },
        });

        // Tạo hóa đơn chuẩn theo đúng giá gói/bác sĩ
        try {
          const invoiceStatus = rest.status === 'CANCELLED' ? 'CANCELLED' : 'PAID';
          const paidAt = rest.status !== 'CANCELLED' ? new Date() : null;
          const amount = rest.servicePrice;
          await prisma.invoice.upsert({
            where: { appointmentId: id },
            update: { totalAmount: amount, subtotal: amount, status: invoiceStatus, paidAt, issuedBranchId: branch.id },
            create: { appointmentId: id, totalAmount: amount, subtotal: amount, status: invoiceStatus, paidAt, issuedBranchId: branch.id },
          });
        } catch (err) {
          console.warn('Lỗi tạo hóa đơn cho lịch:', id, err.message);
        }
      }

      console.log(`  ✓ Đã tạo ${appointmentSeeds.length} lịch khám mẫu cho patient@vitacare.local`);
      console.log('    - 2 COMPLETED (trigger AI gợi ý tái khám)');
      console.log('    - 2 CANCELLED (test nút Đặt lại lịch)');
      console.log('    - 1 BOOKED  (test Đổi / Hủy lịch)');
      console.log('    - 1 CHECKED_IN (test quy trình lễ tân)');
    }
  }

  console.log('9. Khởi tạo danh sách Voucher ưu đãi & khuyến mãi...');
  const now = new Date();
  const nextTwoYears = new Date();
  nextTwoYears.setFullYear(now.getFullYear() + 2);

  const sampleVouchers = [
    {
      code: 'CHAOBANMOI',
      name: 'Ưu đãi chào bạn mới',
      description: 'Giảm ngay 20.000đ cho lượt đặt lịch khám đầu tiên',
      discountType: 'FIXED_AMOUNT',
      discountValue: 20000,
      minOrderValue: 0,
      maxDiscount: null,
      usageLimit: 1000,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextTwoYears,
      isActive: true,
    },
    {
      code: 'MEDPRO10',
      name: 'Ưu đãi Medpro 10%',
      description: 'Giảm 10% tổng chi phí khám (tối đa 50.000đ)',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minOrderValue: 100000,
      maxDiscount: 50000,
      usageLimit: 500,
      userUsageLimit: 2,
      startDate: now,
      endDate: nextTwoYears,
      isActive: true,
    },
    {
      code: 'TRIAN2025',
      name: 'Tri ân người bệnh',
      description: 'Giảm 30.000đ cho đơn khám từ 200.000đ',
      discountType: 'FIXED_AMOUNT',
      discountValue: 30000,
      minOrderValue: 200000,
      maxDiscount: null,
      usageLimit: 300,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextTwoYears,
      isActive: true,
    },
    {
      code: 'KHAMONLINE',
      name: 'Khuyến mãi đặt khám trực tuyến',
      description: 'Giảm 50.000đ cho các gói khám và chuyên khoa từ 300.000đ',
      discountType: 'FIXED_AMOUNT',
      discountValue: 50000,
      minOrderValue: 300000,
      maxDiscount: null,
      usageLimit: 200,
      userUsageLimit: 1,
      startDate: now,
      endDate: nextTwoYears,
      isActive: true,
    },
  ];

  for (const v of sampleVouchers) {
    await prisma.voucher.upsert({
      where: { code: v.code },
      update: {
        name: v.name,
        description: v.description,
        discountType: v.discountType,
        discountValue: v.discountValue,
        minOrderValue: v.minOrderValue,
        maxDiscount: v.maxDiscount,
        usageLimit: v.usageLimit,
        userUsageLimit: v.userUsageLimit,
        startDate: v.startDate,
        endDate: v.endDate,
        isActive: v.isActive,
      },
      create: v,
    });
  }

  console.log('10. Khởi tạo đánh giá mẫu cho Bác sĩ & phiên đăng nhập...');
  const cardioDoctor = doctors.get('doctor.cardio@vitacare.local');
  if (cardioDoctor) {
    await prisma.review.upsert({
      where: { doctorId_reviewerId: { doctorId: cardioDoctor.id, reviewerId: patient.id } },
      update: { rating: 5, comment: 'Bác sĩ tư vấn tận tình, quy trình khám rõ ràng.', isActive: true },
      create: {
        doctorId: cardioDoctor.id,
        reviewerId: patient.id,
        rating: 5,
        comment: 'Bác sĩ tư vấn tận tình, quy trình khám rõ ràng.',
        isActive: true,
      },
    });
    await prisma.doctor.update({
      where: { id: cardioDoctor.id },
      data: { ratingAverage: 5, ratingCount: 1 },
    });
  }

  // Khởi tạo session / token test
  await prisma.session.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    update: { deletedAt: null, expiresAt: dateOnly(7) },
    create: {
      id: '10000000-0000-4000-8000-000000000001',
      userId: patient.id,
      refreshTokenHash: createHash('sha256').update('seed-refresh-token').digest('hex'),
      userAgent: 'VitaCare Seed Client',
      ipAddress: '127.0.0.1',
      expiresAt: dateOnly(7),
    },
  });

  await prisma.oAuthAccount.upsert({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'seed-google-account' } },
    update: { userId: patient.id },
    create: { userId: patient.id, provider: 'GOOGLE', providerAccountId: 'seed-google-account' },
  });

  await prisma.authVerificationToken.upsert({
    where: { id: '10000000-0000-4000-8000-000000000002' },
    update: { consumedAt: new Date(), expiresAt: dateOnly(-1) },
    create: {
      id: '10000000-0000-4000-8000-000000000002',
      userId: patient.id,
      tokenHash: createHash('sha256').update('seed-used-otp').digest('hex'),
      expiresAt: dateOnly(-1),
      consumedAt: new Date(),
    },
  });

  await prisma.passwordResetToken.upsert({
    where: { tokenHash: createHash('sha256').update('seed-used-reset').digest('hex') },
    update: { consumedAt: new Date(), expiresAt: dateOnly(-1) },
    create: {
      id: '10000000-0000-4000-8000-000000000003',
      userId: patient.id,
      tokenHash: createHash('sha256').update('seed-used-reset').digest('hex'),
      expiresAt: dateOnly(-1),
      consumedAt: new Date(),
    },
  });

  console.log('----------------------------------------------------');
  console.log('✓ Dữ liệu Seed đã được khởi tạo hoàn chỉnh 100%!');
  console.log('✓ Mật khẩu tài khoản demo: VitaCare@123');
  console.log('  - Admin: admin@vitacare.local');
  console.log('  - Quản lý: manager@vitacare.local');
  console.log('  - Lễ tân: receptionist@vitacare.local');
  console.log('  - Bác sĩ Tim mạch: doctor.cardio@vitacare.local');
  console.log('  - Bác sĩ Nhi: doctor.pediatrics@vitacare.local');
  console.log('  - Bệnh nhân: patient@vitacare.local, patient01@vitacare.local -> patient05');
  console.log('  - Voucher: CHAOBANMOI, MEDPRO10, TRIAN2025, KHAMONLINE');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Lỗi khi chạy seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
