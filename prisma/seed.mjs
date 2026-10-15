import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcrypt';
import { seedDashboardData, demoDate } from './seed-dashboard-data.mjs';

// 1. Cấu hình biến môi trường & kết nối database
const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Hàm đọc dữ liệu chuẩn JSON
function loadData(fileName) {
  const filePath = new URL(`./data/${fileName}`, import.meta.url);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

const branchesData = loadData('branches.json');
const roomsData = loadData('rooms.json');
const specialtiesData = loadData('specialties.json');
const doctorsData = loadData('doctors.json');
const patientsData = loadData('patients.json');
const healthPackagesData = loadData('services.json');
const vouchersData = loadData('vouchers.json');

// Tiện ích hỗ trợ ngày giờ
function dateOnly(daysFromNow) {
  return demoDate(daysFromNow);
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

function createShiftSlots(startHour, startMinute, endHour, endMinute, slotMin = 30, capacity = 10) {
  const slots = [];
  let cursor = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  while (cursor < end) {
    slots.push({
      startTime: time(Math.floor(cursor / 60), cursor % 60),
      endTime: time(Math.floor((cursor + slotMin) / 60), (cursor + slotMin) % 60),
      capacity,
    });
    cursor += slotMin;
  }
  return slots;
}

const SHIFT_DEFINITIONS = [
  {
    name: 'Sáng',
    startTime: time(8, 0),
    endTime: time(12, 0),
    slots: createShiftSlots(8, 0, 12, 0, 30, 10),
  },
  {
    name: 'Chiều',
    startTime: time(13, 30),
    endTime: time(17, 30),
    slots: createShiftSlots(13, 30, 17, 30, 30, 10),
  },
];

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
  console.log(`✓ Đã làm sạch toàn bộ ${tables.length} bảng dữ liệu.`);
}

async function main() {
  console.log('=== BẮT ĐẦU NẠP BỘ DỮ LIỆU CHUẨN VITACARE CLINIC ===');
  await resetApplicationData();

  const defaultPassword = await bcrypt.hash('VitaCare@123', 10);

  // 1. Khởi tạo tài khoản quản trị & nhân viên quầy
  console.log('1. Khởi tạo tài khoản quản trị & nhân viên tiếp đón...');
  const baseStaffAccounts = [
    { email: 'admin@vitacare.local', fullName: 'Quản trị hệ thống', role: 'ADMIN' },
    { email: 'chain-manager@vitacare.local', fullName: 'Quản lý toàn chuỗi', role: 'CHAIN_MANAGER' },
    { email: 'manager@vitacare.local', fullName: 'Quản lý cơ sở', role: 'BRANCH_MANAGER' },
    { email: 'receptionist@vitacare.local', fullName: 'Tiếp nhận Đỗ Lan', role: 'RECEPTIONIST' },
  ];

  const usersMap = new Map();
  for (const staff of baseStaffAccounts) {
    const user = await prisma.user.upsert({
      where: { email: staff.email },
      update: { fullName: staff.fullName, role: staff.role, status: 'ACTIVE', isBlocked: false, isDeleted: false },
      create: { email: staff.email, fullName: staff.fullName, role: staff.role, status: 'ACTIVE', provider: 'EMAIL', password: defaultPassword },
    });
    usersMap.set(staff.email, user);
  }

  // 2. Khởi tạo Phòng khám & Chi nhánh (từ branches.json)
  console.log('2. Nạp dữ liệu Chi nhánh phòng khám...');
  const clinic = await prisma.clinic.upsert({
    where: { slug: 'vitacare-clinic' },
    update: { name: 'Phòng khám Đa khoa VitaCare', isActive: true },
    create: { name: 'Phòng khám Đa khoa VitaCare', slug: 'vitacare-clinic' },
  });

  const branchesMap = new Map();
  for (const b of branchesData) {
    const branch = await prisma.branch.upsert({
      where: { code: b.code },
      update: { ...b, clinicId: clinic.id, isActive: true },
      create: { ...b, clinicId: clinic.id, isActive: true },
    });
    branchesMap.set(b.code, branch);
  }

  // Gán cơ sở làm việc chính cho Quản lý & Lễ tân
  const centralBranch = branchesMap.get('VC-CENTRAL');
  for (const email of ['manager@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: usersMap.get(email).id, branchId: centralBranch.id } },
      update: { isPrimary: true },
      create: { userId: usersMap.get(email).id, branchId: centralBranch.id, isPrimary: true },
    });
  }

  // 3. Khởi tạo Phương thức đặt khám
  console.log('3. Cấu hình các phương thức đặt khám...');
  const bookingMethodSeeds = [
    ['SPECIALTY_EXAM', 'Khám Chuyên Khoa', 'Hơn 12 chuyên khoa mũi nhọn (Tim mạch, Mắt, Nhi, Da liễu...)', '/dat-lich?type=specialty', 1],
    ['CONSULTATION', 'Khám Cùng Bác Sĩ', 'Chủ động chọn bác sĩ CKI - CKII theo học hàm và kinh nghiệm', '/dat-lich?type=doctor', 2],
    ['ONLINE_CONSULTATION', 'Tư Vấn Online', 'Gọi video 1:1 cùng bác sĩ, đọc kết quả xét nghiệm từ xa', '/dat-lich?type=online-consultation', 3],
    ['FOLLOWUP_EXAM', 'Tái Khám', 'Đặt lịch tái khám với bác sĩ đã điều trị để theo dõi sức khỏe định kỳ', '/dat-lich?flow=followup', 4],
    ['FAMILY_BOOKING', 'Khám Gia Đình', 'Chăm sóc ông bà, cha mẹ và con nhỏ trên cùng một tài khoản', '/dat-lich?type=family', 5],
    ['AFTER_HOURS', 'Khám Ngoài Giờ', '17:30 - 20:30 tiện lợi cho người bận rộn, không lo chờ đợi', '/dat-lich?type=after-hours', 6],
    ['HEALTH_PACKAGE', 'Gói Khám Sức Khỏe', 'Đăng ký gói khám sức khỏe tổng quát và chuyên sâu.', '/dich-vu?view=health-packages', 7],
  ];

  const bookingMethodsMap = new Map();
  for (const [code, name, description, route] of bookingMethodSeeds) {
    const method = await prisma.bookingMethod.upsert({
      where: { code },
      update: { name, description, route, isActive: true },
      create: { code, name, description, route, isActive: true },
    });
    bookingMethodsMap.set(code, method);
  }

  for (const branch of branchesMap.values()) {
    for (const [code, , , , sortOrder] of bookingMethodSeeds) {
      const method = bookingMethodsMap.get(code);
      await prisma.branchBookingMethod.upsert({
        where: { branchId_bookingMethodId: { branchId: branch.id, bookingMethodId: method.id } },
        update: { sortOrder, isEnabled: true },
        create: { branchId: branch.id, bookingMethodId: method.id, sortOrder, isEnabled: true },
      });
    }
  }

  // 4. Khởi tạo Chuyên khoa (từ specialties.json)
  console.log('4. Nạp 14 chuyên khoa chuẩn y tế...');
  const specialtiesBySlug = new Map();
  for (const s of specialtiesData) {
    const row = await prisma.specialty.upsert({
      where: { slug: s.slug },
      update: {
        name: s.name,
        description: s.description,
        symptoms: Array.isArray(s.symptoms) ? s.symptoms : [],
        iconUrl: s.iconUrl || null,
        sortOrder: s.sortOrder,
        isActive: true,
      },
      create: {
        name: s.name,
        slug: s.slug,
        description: s.description,
        symptoms: Array.isArray(s.symptoms) ? s.symptoms : [],
        iconUrl: s.iconUrl || null,
        sortOrder: s.sortOrder,
        isActive: true,
      },
    });
    specialtiesBySlug.set(s.slug, row);
  }

  // Gán tất cả chuyên khoa cho cả 2 cơ sở
  for (const branch of branchesMap.values()) {
    for (const spec of specialtiesBySlug.values()) {
      await prisma.branchSpecialty.upsert({
        where: { branchId_specialtyId: { branchId: branch.id, specialtyId: spec.id } },
        update: { isActive: true },
        create: { branchId: branch.id, specialtyId: spec.id, isActive: true },
      });
    }
  }

  // 5. Khởi tạo Phòng khám (từ rooms.json) & Gán chuyên khoa tương ứng
  console.log('5. Nạp danh mục phòng khám chuẩn theo từng chi nhánh...');
  const roomsByBranchAndCode = new Map();
  for (const group of roomsData) {
    const branch = branchesMap.get(group.branchCode);
    if (!branch) continue;

    for (const roomItem of group.rooms) {
      const room = await prisma.clinicRoom.upsert({
        where: { branchId_code: { branchId: branch.id, code: roomItem.code } },
        update: { name: roomItem.name, isActive: true },
        create: { branchId: branch.id, code: roomItem.code, name: roomItem.name, isActive: true },
      });
      roomsByBranchAndCode.set(`${group.branchCode}:${roomItem.code}`, room);

      // Gán chuyên khoa phục vụ cho phòng
      for (const [priority, specSlug] of roomItem.specialtySlugs.entries()) {
        const spec = specialtiesBySlug.get(specSlug);
        if (spec) {
          await prisma.clinicRoomSpecialty.upsert({
            where: { roomId_specialtyId: { roomId: room.id, specialtyId: spec.id } },
            update: { isActive: true, priority: 10 - priority },
            create: { roomId: room.id, specialtyId: spec.id, priority: 10 - priority, isActive: true },
          });
        }
      }
    }
  }

  // 6. Khởi tạo Bác sĩ & Lịch làm việc chuẩn (từ doctors.json)
  console.log('6. Nạp danh sách bác sĩ chuẩn & phân bổ lịch trực chuẩn xác...');
  const doctorsMap = new Map();
  const centralRooms = roomsData.find((r) => r.branchCode === 'VC-CENTRAL')?.rooms || [];
  const eastRooms = roomsData.find((r) => r.branchCode === 'VC-EAST')?.rooms || [];

  for (const docData of doctorsData) {
    const user = await prisma.user.upsert({
      where: { email: docData.email },
      update: {
        fullName: docData.fullName,
        phoneNumber: docData.phoneNumber || null,
        avatarUrl: docData.avatarUrl || null,
        role: 'DOCTOR',
        status: 'ACTIVE',
        isBlocked: false,
        isDeleted: false,
      },
      create: {
        email: docData.email,
        fullName: docData.fullName,
        phoneNumber: docData.phoneNumber || null,
        avatarUrl: docData.avatarUrl || null,
        role: 'DOCTOR',
        status: 'ACTIVE',
        provider: 'EMAIL',
        password: defaultPassword,
      },
    });
    usersMap.set(docData.email, user);

    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: {
        academicRank: docData.academicRank,
        licenseNumber: docData.licenseNumber || null,
        experienceYears: docData.experienceYears || 0,
        biography: docData.biography || null,
        consultationFee: docData.consultationFee,
        onlineConsultationFee: docData.onlineConsultationFee ?? Math.round((docData.consultationFee || 0) * 0.8 / 10000) * 10000,
        avatarUrl: docData.avatarUrl,
        ratingAverage: docData.ratingAverage || 4.9,
        ratingCount: docData.ratingCount || 100,
        isFeatured: docData.isFeatured,
        isActive: true,
      },
      create: {
        userId: user.id,
        academicRank: docData.academicRank,
        licenseNumber: docData.licenseNumber || null,
        experienceYears: docData.experienceYears || 0,
        biography: docData.biography || null,
        consultationFee: docData.consultationFee,
        onlineConsultationFee: docData.onlineConsultationFee ?? Math.round((docData.consultationFee || 0) * 0.8 / 10000) * 10000,
        avatarUrl: docData.avatarUrl,
        ratingAverage: docData.ratingAverage || 4.9,
        ratingCount: docData.ratingCount || 100,
        isFeatured: docData.isFeatured,
        isActive: true,
      },
    });
    doctorsMap.set(docData.email, doctor);

    // Gán chuyên khoa chính
    const primarySpec = specialtiesBySlug.get(docData.specialtySlug);
    if (primarySpec) {
      await prisma.doctorSpecialty.upsert({
        where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: primarySpec.id } },
        update: { isPrimary: true },
        create: { doctorId: doctor.id, specialtyId: primarySpec.id, isPrimary: true },
      });
    }

    // Gán bác sĩ vào cả 2 chi nhánh để hỗ trợ lịch luân phiên
    for (const [idx, branch] of [...branchesMap.values()].entries()) {
      await prisma.userBranchAssignment.upsert({
        where: { userId_branchId: { userId: user.id, branchId: branch.id } },
        update: { isPrimary: idx === 0 },
        create: { userId: user.id, branchId: branch.id, isPrimary: idx === 0 },
      });
    }

    // Tạo lịch làm việc từ -7 ngày trước đến +21 ngày tới
    // Mỗi ngày bác sĩ CHỈ trực DUY NHẤT tại 1 chi nhánh, đúng phòng khám đã chỉ định
    for (let dayOffset = -7; dayOffset <= 21; dayOffset += 1) {
      const workDate = dateOnly(dayOffset);
      const dayOfWeek = workDate.getUTCDay(); // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7
      if (dayOfWeek === 0) continue; // Nghỉ Chủ nhật

      // Phân bổ luân phiên theo rotationPattern:
      // EVEN: T2, T4, T6 tại Trung tâm (P1xx) | T3, T5, T7 tại Cơ sở Đông (P2xx)
      // ODD:  T2, T4, T6 tại Cơ sở Đông (P2xx) | T3, T5, T7 tại Trung tâm (P1xx)
      const isMonWedFri = [1, 3, 5].includes(dayOfWeek);
      const isCentral = docData.rotationPattern === 'EVEN' ? isMonWedFri : !isMonWedFri;
      const targetBranch = isCentral ? branchesMap.get('VC-CENTRAL') : branchesMap.get('VC-EAST');
      const targetRoomCode = isCentral ? docData.centralRoomCode : docData.eastRoomCode;
      const roomKey = `${targetBranch.code}:${targetRoomCode}`;
      const targetRoom = roomsByBranchAndCode.get(roomKey);

      for (const shift of SHIFT_DEFINITIONS) {
        const schedule = await prisma.doctorSchedule.upsert({
          where: {
            doctorId_branchId_workDate_startTime: {
              doctorId: doctor.id,
              branchId: targetBranch.id,
              workDate,
              startTime: shift.startTime,
            },
          },
          update: {
            roomId: targetRoom?.id ?? null,
            endTime: shift.endTime,
            status: 'OPEN',
            capacityPerSlot: 10,
            slotDurationMin: 30,
          },
          create: {
            doctorId: doctor.id,
            branchId: targetBranch.id,
            roomId: targetRoom?.id ?? null,
            workDate,
            startTime: shift.startTime,
            endTime: shift.endTime,
            slotDurationMin: 30,
            capacityPerSlot: 10,
            status: 'OPEN',
          },
        });

        for (const slot of shift.slots) {
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
      }
    }
  }

  // 7. Khởi tạo Dịch vụ chuyên khoa & Gói khám sức khỏe
  console.log('7. Nạp danh mục dịch vụ khám & gói tầm soát sức khỏe...');
  for (const branch of branchesMap.values()) {
    const branchMethods = await prisma.branchBookingMethod.findMany({
      where: { branchId: branch.id },
      include: { bookingMethod: true },
    });
    const methodByCode = new Map(branchMethods.map((m) => [m.bookingMethod.code, m]));

    // Dịch vụ chuyên khoa với hình ảnh y tế chuyên sâu theo từng loại hình dịch vụ
    const SPECIALTY_EXTRA_METADATA = {
      'tim-mach': {
        symptoms: ['Tức ngực', 'Hồi hộp đánh trống ngực', 'Khó thở khi gắng sức', 'Huyết áp cao', 'Chóng mặt'],
        notes: 'Mang theo toa thuốc và kết quả điện tim/siêu âm tim cũ (nếu có). Tránh dùng cà phê, thuốc lá, trà đậm hoặc chất kích thích trong vòng 12h trước khám.',
        standardDesc: 'Khám lâm sàng chuyên sâu, nghe tim phổi, đo huyết áp và tầm soát các bệnh lý mạch vành, rối loạn nhịp tim, tăng huyết áp.',
        followupDesc: 'Theo dõi diễn tiến bệnh lý tim mạch, kiểm tra chỉ số huyết áp, đánh giá phản ứng thuốc và điều chỉnh phác đồ điều trị tối ưu.',
        adviceDesc: 'Tư vấn định hướng chẩn đoán các triệu chứng tim mạch, tư vấn lối sống và chế độ dinh dưỡng bảo vệ hệ tim mạch.',
        standardImg: 'https://images.unsplash.com/photo-1628348068343-c6a848d2b6dd?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
      },
      'tieu-hoa-gan-mat': {
        symptoms: ['Đau thượng vị', 'Đầy hơi khó tiêu', 'Ợ chua trào ngược', 'Rối loạn tiêu hóa', 'Buồn nôn'],
        notes: 'Nên nhịn ăn ít nhất 6 tiếng trước giờ khám nếu có chỉ định siêu âm ổ bụng hoặc nội soi tiêu hóa. Uống nhiều nước lọc.',
        standardDesc: 'Thăm khám và chẩn đoán các bệnh lý dạ dày, đại tràng, gan mật tụy, viêm loét đường tiêu hóa và trào ngược dạ dày thực quản.',
        followupDesc: 'Đánh giá mức độ hồi phục niêm mạc dạ dày/đại tràng, kiểm tra hiệu quả phác đồ diệt khuẩn HP và điều chỉnh thuốc.',
        adviceDesc: 'Tư vấn chế độ ăn uống khoa học, hướng dẫn xử trí trào ngược và tầm soát sớm ung thư đường tiêu hóa.',
        standardImg: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
      },
      'da-lieu': {
        symptoms: ['Mụn viêm mụn ẩn', 'Dị ứng mẩn ngứa', 'Nổi mề đay', 'Viêm da cơ địa', 'Rụng tóc', 'Nấm da'],
        notes: 'Không trang điểm, không bôi kem đặc trị hoặc thuốc mỡ lên vùng da cần khám trong vòng 12h để bác sĩ soi da và chẩn đoán chính xác.',
        standardDesc: 'Khám soi da vi thể, chẩn đoán và điều trị mụn trứng cá, viêm da cơ địa, dị ứng, vảy nến và các bệnh lý ngoài da.',
        followupDesc: 'Theo dõi diễn tiến điều trị da liễu, đánh giá mức độ đáp ứng thuốc bôi/thuốc uống và kiểm tra đơn thuốc.',
        adviceDesc: 'Tư vấn quy trình chăm sóc da khoa học, lựa chọn dược mỹ phẩm phù hợp và phòng ngừa tái phát bệnh lý da liễu.',
        standardImg: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1629909615184-74f495363b67?w=800&auto=format&fit=crop&q=80',
      },
      'ho-hap': {
        symptoms: ['Ho kéo dài', 'Khò khè tức ngực', 'Ho có đờm hoặc lẫn máu', 'Hụt hơi khó thở'],
        notes: 'Giữ ấm cơ thể, đeo khẩu trang y tế và mang theo phim chụp X-quang/CT phổi gần nhất nếu có.',
        standardDesc: 'Khám chẩn đoán các bệnh lý phế quản, hen suyễn, phổi tắc nghẽn mạn tính COPD và nhiễm trùng đường hô hấp.',
        followupDesc: 'Kiểm tra chức năng hô hấp, đánh giá đáp ứng khí dung/thuốc xịt và điều chỉnh phác đồ điều trị hen/COPD.',
        adviceDesc: 'Tư vấn phương pháp phòng ngừa viêm đường hô hấp mùa lạnh, tập thở phục hồi chức năng và cai thuốc lá.',
        standardImg: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
      },
      'mat': {
        symptoms: ['Mắt nhìn mờ', 'Đỏ mắt cộm rát', 'Chảy nước mắt sống', 'Khám đo kính cận loạn'],
        notes: 'Tháo kính áp tròng ít nhất 24h trước khi đo khúc xạ. Mang theo kính mắt đang sử dụng để Bác sĩ đối chiếu.',
        standardDesc: 'Đo thị lực điện tử, soi đáy mắt, đo nhãn áp và chẩn đoán tật khúc xạ cận/viễn/loạn thị, viêm kết mạc.',
        followupDesc: 'Kiểm tra tiến trình hồi phục sau can thiệp mắt, đo lại nhãn áp và điều chỉnh kính mắt phù hợp.',
        adviceDesc: 'Tư vấn bảo vệ mắt khi làm việc với máy tính, chế độ nghỉ ngơi và phòng ngừa khô mắt, hội chứng thị giác màn hình.',
        standardImg: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
      },
      'tai-mui-hong': {
        symptoms: ['Đau rát họng nuốt vướng', 'Nghẹt mũi chảy nước mũi', 'Ù tai chảy dịch tai', 'Khàn tiếng kéo dài'],
        notes: 'Nhịn ăn uống ít nhất 2 giờ trước khi nội soi để tránh phản xạ nôn khi đưa ống soi mềm vào vòm họng.',
        standardDesc: 'Nội soi dải tần hẹp tai mũi họng, chẩn đoán viêm xoang, viêm họng hạt, viêm amidan, viêm tai giữa và polyp.',
        followupDesc: 'Kiểm tra mức độ lành niêm mạc xoang, hút rửa mũi xoang/tai và đánh giá hiệu quả kháng sinh.',
        adviceDesc: 'Tư vấn vệ sinh mũi họng hằng ngày bằng nước muối sinh lý, phòng tránh viêm xoang tái phát do thời tiết.',
        standardImg: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&auto=format&fit=crop&q=80',
      },
      'rang-ham-mat': {
        symptoms: ['Đau buốt răng sâu', 'Chảy máu chân răng nướu', 'Răng khôn mọc lệch', 'Cần lấy cao răng làm sạch'],
        notes: 'Ăn nhẹ trước khi đến khám nha khoa. Vệ sinh răng miệng sạch sẽ trước giờ khám.',
        standardDesc: 'Khám kiểm tra tổng quát răng miệng, chụp X-quang răng, cạo vôi răng, trám răng sâu và điều trị tủy răng.',
        followupDesc: 'Kiểm tra vết thương sau nhổ răng/tiểu phẫu, kiểm tra khớp cắn và theo dõi răng sứ/niềng răng.',
        adviceDesc: 'Tư vấn phương pháp chải răng đúng cách, chỉ nha khoa, nước súc miệng và lịch chăm sóc răng định kỳ 6 tháng.',
        standardImg: 'https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?w=800&auto=format&fit=crop&q=80',
      },
      'san-phu-khoa': {
        symptoms: ['Rối loạn kinh nguyệt', 'Khám thai định kỳ', 'Đau bụng dưới bất thường', 'Viêm nhiễm phụ khoa'],
        notes: 'Khám phụ khoa nên thực hiện sau khi sạch kinh 3-5 ngày. Không thụt rửa âm đạo hoặc quan hệ trong 24h trước khám.',
        standardDesc: 'Khám phụ khoa định kỳ, siêu âm tử cung phần phụ, siêu âm thai 4D, tầm soát ung thư cổ tử cung Thinprep.',
        followupDesc: 'Kiểm tra kết quả phết tế bào cổ tử cung, theo dõi sự phát triển của thai nhi và điều chỉnh thuốc phụ khoa.',
        adviceDesc: 'Tư vấn sức khỏe tiền hôn nhân, kế hoạch hóa gia đình, tiêm phòng thai kỳ và dinh dưỡng cho mẹ bầu.',
        standardImg: 'https://images.unsplash.com/photo-1581594693702-fbdc51b2763b?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1629909615184-74f495363b67?w=800&auto=format&fit=crop&q=80',
      },
      'nhi-khoa': {
        symptoms: ['Sốt co giật ở trẻ', 'Biếng ăn chậm tăng cân', 'Ho sốt cảm cúm', 'Phát ban mẩn ngứa trẻ nhỏ'],
        notes: 'Mang theo sổ tiêm chủng và ghi chép lịch sử sốt/dị ứng thuốc của bé. Giữ ấm cho trẻ khi di chuyển.',
        standardDesc: 'Khám tổng quát thể trạng trẻ em, chẩn đoán bệnh lý hô hấp, tiêu hóa, dinh dưỡng và tư vấn phát triển toàn diện.',
        followupDesc: 'Đánh giá tiến trình hồi phục của trẻ sau đợt điều trị, kiểm tra cân nặng và điều chỉnh liều lượng thuốc an toàn.',
        adviceDesc: 'Tư vấn dinh dưỡng theo từng giai đoạn phát triển, lịch tiêm ngừa vắc xin và cách chăm sóc trẻ tại nhà.',
        standardImg: 'https://images.unsplash.com/photo-1631815589968-fdb09a223b1e?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&auto=format&fit=crop&q=80',
      },
      'ngoai-chan-thuong-chinh-hinh': {
        symptoms: ['Đau nhức khớp gối', 'Thoái hóa cột sống', 'Đau mỏi vai gáy', 'Căng cơ chấn thương vận động'],
        notes: 'Mặc trang phục rộng rãi, thoải mái thuận tiện cho việc vận động thăm khám khớp. Mang theo phim chụp X-Quang/MRI cũ.',
        standardDesc: 'Khám đánh giá tầm vận động khớp, chẩn đoán thoái hóa khớp, thoát vị đĩa đệm, viêm khớp dạng thấp và loãng xương.',
        followupDesc: 'Đánh giá mức độ thuyên giảm đau nhức, kiểm tra tiến trình phục hồi sụn khớp và điều chỉnh bài tập vận động.',
        adviceDesc: 'Tư vấn bài tập vật lý trị liệu, tư thế lao động đúng cách và dinh dưỡng bổ sung canxi, glucosamine cho khớp.',
        standardImg: 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
      },
      'noi-tong-quat': {
        symptoms: ['Kiểm tra sức khỏe định kỳ', 'Mệt mỏi suy nhược', 'Sụt cân không rõ nguyên nhân', 'Đau đầu mất ngủ'],
        notes: 'Nhịn ăn sáng ít nhất 6-8 tiếng để lấy máu xét nghiệm đường huyết, mỡ máu và men gan. Không uống nước ngọt, sữa hay cà phê.',
        standardDesc: 'Khám lâm sàng toàn diện các cơ quan nội khoa, đánh giá chỉ số sinh hiệu và tầm soát sớm các bệnh lý lối sống.',
        followupDesc: 'Đánh giá lại các chỉ số xét nghiệm bất thường, theo dõi tiến triển sức khỏe định kỳ và tư vấn cải thiện.',
        adviceDesc: 'Tư vấn kế hoạch chăm sóc sức khỏe chủ động, định hướng lối sống lành mạnh và lịch tầm soát định kỳ.',
        standardImg: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&auto=format&fit=crop&q=80',
        afterImg: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
        followupImg: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=800&auto=format&fit=crop&q=80',
        adviceImg: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?w=800&auto=format&fit=crop&q=80',
      },
    };

    // Chuẩn hóa alias slug
    SPECIALTY_EXTRA_METADATA.tim_mach = SPECIALTY_EXTRA_METADATA['tim-mach'];
    SPECIALTY_EXTRA_METADATA.tieu_hoa = SPECIALTY_EXTRA_METADATA['tieu-hoa-gan-mat'];
    SPECIALTY_EXTRA_METADATA.da_lieu = SPECIALTY_EXTRA_METADATA['da-lieu'];
    SPECIALTY_EXTRA_METADATA.ho_hap = SPECIALTY_EXTRA_METADATA['ho-hap'];
    SPECIALTY_EXTRA_METADATA.co_xuong_khop = SPECIALTY_EXTRA_METADATA['ngoai-chan-thuong-chinh-hinh'];
    SPECIALTY_EXTRA_METADATA.nhi_khoa = SPECIALTY_EXTRA_METADATA['nhi-khoa'];
    SPECIALTY_EXTRA_METADATA.san_phu_khoa = SPECIALTY_EXTRA_METADATA['san-phu-khoa'];
    SPECIALTY_EXTRA_METADATA.rang_ham_mat = SPECIALTY_EXTRA_METADATA['rang-ham-mat'];
    SPECIALTY_EXTRA_METADATA.tong_quat = SPECIALTY_EXTRA_METADATA['noi-tong-quat'];

    for (const spec of specialtiesBySlug.values()) {
      const codeSuffix = `${branch.code.replace('VC-', '')}-${String(spec.id).padStart(3, '0')}`;
      const specMeta = SPECIALTY_EXTRA_METADATA[spec.slug] || SPECIALTY_EXTRA_METADATA.tong_quat;

      const specialtyServices = [
        {
          code: `CONSULT-${codeSuffix}-STANDARD`,
          name: `Khám ${spec.name} trong giờ (${branch.name})`,
          price: 220000,
          durationMin: 30,
          description: specMeta.standardDesc || `Khám chẩn đoán bệnh lý ${spec.name} trong giờ hành chính.`,
          notes: specMeta.notes,
          symptoms: specMeta.symptoms,
          imageUrl: specMeta.standardImg || spec.iconUrl || null,
          methodCode: 'SPECIALTY_EXAM',
        },
        {
          code: `CONSULT-${codeSuffix}-AFTER`,
          name: `Khám ${spec.name} ngoài giờ (${branch.name})`,
          price: 270000,
          durationMin: 30,
          description: specMeta.standardDesc || `Khám chẩn đoán bệnh lý ${spec.name} ngoài giờ hành chính.`,
          notes: specMeta.notes,
          symptoms: specMeta.symptoms,
          imageUrl: specMeta.afterImg || spec.iconUrl || null,
          methodCode: 'AFTER_HOURS',
        },
        {
          code: `CONSULT-${codeSuffix}-FOLLOWUP`,
          name: `Tái khám ${spec.name} (${branch.name})`,
          price: 180000,
          durationMin: 20,
          description: specMeta.followupDesc || `Theo dõi diễn tiến điều trị và kiểm tra đơn thuốc ${spec.name}.`,
          notes: `Bắt buộc mang theo đơn thuốc và kết quả xét nghiệm của lần khám trước để Bác sĩ đối chiếu hiệu quả điều trị. ${specMeta.notes}`,
          symptoms: specMeta.symptoms,
          imageUrl: specMeta.followupImg || spec.iconUrl || null,
          methodCode: 'SPECIALTY_EXAM',
        },
      ];

      for (const service of specialtyServices) {
        const branchBookingMethod = methodByCode.get(service.methodCode);
        if (!branchBookingMethod) continue;
        const slug = toSlug(service.name);
        await prisma.servicePackage.upsert({
          where: { code: service.code },
          update: {
            code: service.code,
            name: service.name,
            slug,
            price: service.price,
            durationMin: service.durationMin,
            description: service.description,
            notes: service.notes,
            symptoms: service.symptoms,
            imageUrl: service.imageUrl,
            branchBookingMethodId: branchBookingMethod.id,
            specialtyId: spec.id,
            isActive: true,
          },
          create: {
            code: service.code,
            name: service.name,
            slug,
            price: service.price,
            durationMin: service.durationMin,
            description: service.description,
            notes: service.notes,
            symptoms: service.symptoms,
            imageUrl: service.imageUrl,
            branchBookingMethodId: branchBookingMethod.id,
            specialtyId: spec.id,
            isActive: true,
          },
        });
      }
    }

    // Gói khám sức khỏe (từ services.json)
    const healthPackageMethod = methodByCode.get('HEALTH_PACKAGE');
    if (healthPackageMethod) {
      for (const pkg of healthPackagesData) {
        const fullCode = `PKG-${pkg.codeSuffix}-${branch.code}`;
        const fullName = `${pkg.name} (${branch.name})`;
        const slug = toSlug(fullName);

        await prisma.servicePackage.upsert({
          where: { code: fullCode },
          update: {
            name: fullName,
            slug,
            description: pkg.description,
            notes: pkg.notes || 'Nhịn ăn sáng ít nhất 6-8 tiếng để thực hiện xét nghiệm máu và siêu âm ổ bụng tổng quát. Uống nhiều nước lọc và nhịn tiểu trước khi siêu âm. Xuất trình CCCD/BHYT tại quầy tiếp đón.',
            symptoms: Array.isArray(pkg.symptoms) ? pkg.symptoms : ['Kiểm tra sức khỏe định kỳ', 'Tầm soát ung thư sớm'],
            imageUrl: pkg.imageUrl || null,
            durationMin: pkg.durationMin || 45,
            sessionType: pkg.sessionType || 'ALL_DAY',
            price: pkg.price,
            branchBookingMethodId: healthPackageMethod.id,
            isActive: true,
          },
          create: {
            code: fullCode,
            name: fullName,
            slug,
            description: pkg.description,
            notes: pkg.notes || 'Nhịn ăn sáng ít nhất 6-8 tiếng để thực hiện xét nghiệm máu và siêu âm ổ bụng tổng quát. Uống nhiều nước lọc và nhịn tiểu trước khi siêu âm. Xuất trình CCCD/BHYT tại quầy tiếp đón.',
            symptoms: Array.isArray(pkg.symptoms) ? pkg.symptoms : ['Kiểm tra sức khỏe định kỳ', 'Tầm soát ung thư sớm'],
            imageUrl: pkg.imageUrl || null,
            durationMin: pkg.durationMin || 45,
            sessionType: pkg.sessionType || 'ALL_DAY',
            price: pkg.price,
            branchBookingMethodId: healthPackageMethod.id,
            isActive: true,
          },
        });
      }
    }
  }

  // 8. Khởi tạo Bệnh nhân & Hồ sơ sức khỏe (từ patients.json)
  console.log('8. Nạp hồ sơ bệnh nhân chuẩn hóa tiếng Việt...');
  const patientProfilesMap = new Map();
  for (const patientData of patientsData) {
    const user = await prisma.user.upsert({
      where: { email: patientData.email },
      update: { fullName: patientData.fullName, phoneNumber: patientData.phoneNumber, role: 'PATIENT', status: 'ACTIVE', isBlocked: false, isDeleted: false },
      create: { email: patientData.email, fullName: patientData.fullName, phoneNumber: patientData.phoneNumber, role: 'PATIENT', status: 'ACTIVE', provider: 'EMAIL', password: defaultPassword },
    });
    usersMap.set(patientData.email, user);

    for (const p of patientData.profiles) {
      const profileData = {
        fullName: p.fullName,
        phoneNumber: p.phoneNumber,
        patientCode: p.patientCode,
        nationalId: p.nationalId,
        healthInsuranceNumber: p.healthInsuranceNumber ?? null,
        dateOfBirth: new Date(`${p.dateOfBirth}T00:00:00.000Z`),
        gender: p.gender,
        provinceCode: p.provinceCode ?? null,
        provinceName: p.provinceName ?? null,
        districtCode: p.districtCode ?? null,
        districtName: p.districtName ?? null,
        wardCode: p.wardCode ?? null,
        wardName: p.wardName ?? null,
        streetAddress: p.streetAddress ?? null,
        address: p.address,
        ethnicity: p.ethnicity ?? 'Kinh',
        nationality: p.nationality ?? 'Việt Nam',
        occupation: p.occupation ?? null,
        guardianName: p.guardianName ?? null,
        guardianPhone: p.guardianPhone ?? null,
        guardianRelationship: p.guardianRelationship ?? null,
        bloodGroup: p.bloodGroup,
        allergies: p.allergies,
        height: p.height,
        weight: p.weight,
        medicalHistory: p.medicalHistory,
        relationshipToAccount: p.relationshipToAccount,
        isMainProfile: p.isMainProfile,
      };

      const profile = await prisma.patientProfile.upsert({
        where: { accountId_nationalId: { accountId: user.id, nationalId: p.nationalId } },
        update: profileData,
        create: {
          accountId: user.id,
          ...profileData,
        },
      });
      patientProfilesMap.set(p.patientCode, profile);
    }
  }

  // 9. Dữ liệu vận hành đồng bộ cho tất cả vai trò, theo ngày seed tại Việt Nam.
  console.log('9. Nạp lịch hẹn, doanh thu, tài khoản và nhật ký dashboard...');
  await seedDashboardData(prisma, { passwordHash: defaultPassword });

  // 10. Khởi tạo Danh sách Voucher ưu đãi (từ vouchers.json)
  console.log('10. Nạp danh sách voucher ưu đãi chuẩn...');
  const now = new Date();
  const nextTwoYears = new Date();
  nextTwoYears.setFullYear(now.getFullYear() + 2);

  for (const v of vouchersData) {
    await prisma.voucher.upsert({
      where: { code: v.code },
      update: { ...v, startDate: now, endDate: nextTwoYears, isActive: true },
      create: { ...v, startDate: now, endDate: nextTwoYears, isActive: true },
    });
  }

  // 11. Bổ trợ đánh giá & OAuth mẫu
  console.log('11. Cập nhật thông số bác sĩ & tài khoản OAuth mẫu...');
  const cardioDoc = doctorsMap.get('doctor.cardio@vitacare.local');
  if (cardioDoc) {
    await prisma.doctor.update({
      where: { id: cardioDoc.id },
      data: { ratingAverage: 4.9, ratingCount: 28 },
    });
  }

  const mainPatient = usersMap.get('patient@vitacare.local');
  if (mainPatient) {
    await prisma.oAuthAccount.upsert({
      where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'seed-google-account' } },
      update: { userId: mainPatient.id },
      create: { userId: mainPatient.id, provider: 'GOOGLE', providerAccountId: 'seed-google-account' },
    });
  }

  // 12. Khởi tạo Hội thoại Tư vấn AI Sàng lọc triệu chứng mẫu
  console.log('12. Nạp hội thoại AI Assistant & Kết quả phân tích triệu chứng mẫu...');
  if (mainPatient && cardioDoc) {
    const cardioSpec = specialtiesBySlug.get('tim-mach');
    const centralBranch = branchesMap.get('VC-CENTRAL');

    const conversation = await prisma.aIConversation.create({
      data: {
        userId: mainPatient.id,
        conversationType: 'TRIAGE_CONSULTATION',
        title: 'Tư vấn triệu chứng đau tức ngực & hồi hộp',
        isClosed: true,
      },
    });

    await prisma.aIMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          sender: 'USER',
          content: 'Chào trợ lý AI, gần đây tôi thường bị đau tức ngực bên trái khi leo cầu thang, đôi khi có cảm giác hồi hộp, tim đập nhanh. Tôi nên đi khám ở đâu?',
          tokensUsed: 42,
        },
        {
          conversationId: conversation.id,
          sender: 'ASSISTANT',
          content: 'Chào bạn Nguyễn Văn An, qua mô tả triệu chứng tức ngực trái khi gắng sức kèm cảm giác hồi hộp, tim đập nhanh, đây là dấu hiệu cảnh báo liên quan đến hệ tim mạch (có thể do thiếu máu cơ tim hoặc rối loạn nhịp tim). VitaCare AI khuyến nghị bạn nên đặt lịch thăm khám sớm tại Chuyên khoa Tim mạch với BS. CKI Nguyễn Minh Tâm tại VitaCare Trung tâm để được đo điện tim ECG và siêu âm tim chuyên sâu.',
          tokensUsed: 128,
        },
      ],
    });

    if (cardioSpec && centralBranch) {
      await prisma.aITriageInsight.create({
        data: {
          conversationId: conversation.id,
          extractedSymptoms: 'Đau tức ngực trái khi gắng sức, hồi hộp, tim đập nhanh',
          preliminaryDiagnosis: 'Theo dõi thiếu máu cơ tim / Rối loạn nhịp tim khi gắng sức',
          confidenceScore: 0.94,
          suggestedSpecialtyId: cardioSpec.id,
          suggestedDoctorId: cardioDoc.id,
          suggestedBranchId: centralBranch.id,
        },
      });
    }
  }

  console.log('\n====================================================');
  console.log('✓ TOÀN BỘ DATA CHUẨN ĐÃ ĐƯỢC NẠP THÀNH CÔNG 100%!');
  console.log('✓ Tài khoản kiểm thử (Mật khẩu chung: VitaCare@123):');
  console.log('  - Quản trị viên: admin@vitacare.local');
  console.log('  - Quản lý toàn chuỗi: chain-manager@vitacare.local');
  console.log('  - Quản lý Trung tâm: manager@vitacare.local');
  console.log('  - Quản lý Cơ sở Đông: manager.east@vitacare.local');
  console.log('  - Lễ tân Cơ sở Đông: receptionist.east@vitacare.local');
  console.log('  - Tài khoản khóa: manager.locked / receptionist.locked / doctor.locked / patient.locked @vitacare.local');
  console.log('  - Tiếp tân quầy: receptionist@vitacare.local');
  console.log('  - Bác sĩ Tim mạch: doctor.cardio@vitacare.local (BS. CKI Nguyễn Minh Tâm)');
  console.log('  - Bác sĩ Nhi: doctor.pediatrics@vitacare.local (ThS. BS Trần Thu Hà)');
  console.log('  - Bệnh nhân chính: patient@vitacare.local (Nguyễn Văn An - CCCD 079200000001)');
  console.log('  - Bệnh nhân phụ: patient01 -> patient05@vitacare.local');
  console.log('  - Voucher: CHAOBANMOI, MEDPRO10, TRIAN2026, KHAMONLINE');
  console.log('====================================================\n');
}

main()
  .catch((e) => {
    console.error('Lỗi khi nạp data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
