import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

const SEED_NOW = new Date();

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
const DEFAULT_DOCTOR_AVATAR = 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&q=80&w=400';

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
    startTime: time(7, 30),
    endTime: time(11, 30),
    slots: createShiftSlots(7, 30, 11, 30, 30, 10),
  },
  {
    name: 'Chiều',
    startTime: time(13, 30),
    endTime: time(17, 0),
    slots: createShiftSlots(13, 30, 17, 0, 30, 10),
  },
];

// Các trường này trước đây được backfill bằng migration. Database mới lấy từ seed.
function packageMetadata(data) {
  const text = `${data.name ?? ''} ${data.description ?? ''}`.toLowerCase();
  const targetGender = data.targetGender ?? (
    /(phụ khoa|thai sản|cổ tử cung|buồng trứng|mang thai|khám thai|sinh sản nữ|nữ giới)/.test(text)
      ? 'FEMALE'
      : /(nam khoa|tuyến tiền liệt|sinh sản nam|sức khỏe nam giới|nam giới)/.test(text) ? 'MALE' : 'ALL'
  );
  const isFollowUp = data.isFollowUp ?? (
    String(data.code ?? '').toUpperCase().includes('-FOLLOWUP') || text.includes('tái khám')
  );
  return {
    targetGender,
    minAge: data.minAge ?? null,
    maxAge: data.maxAge ?? null,
    isPediatric: data.isPediatric ?? /(nhi khoa|sơ sinh|trẻ em|tiêm chủng trẻ em)/.test(text),
    isFollowUp,
    followUpAfterDays: data.followUpAfterDays ?? (isFollowUp ? 180 : null),
    isFeatured: data.isFeatured ?? false,
  };
}

async function resetApplicationData() {
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  if (!tables.length) {
    throw new Error('Database chưa có bảng. Chạy npm run prisma:deploy trước khi seed.');
  }

  // Không xóa dữ liệu khi chạy seed thông thường; --reset chỉ dành cho dữ liệu demo.
  if (!process.argv.includes('--reset')) {
    for (const { tablename } of tables) {
      const identifier = `"${String(tablename).replaceAll('"', '""')}"`;
      const rows = await prisma.$queryRawUnsafe(`SELECT 1 FROM "public".${identifier} LIMIT 1`);
      if (rows.length) {
        throw new Error('Database đã có dữ liệu. Chỉ dùng npm run prisma:seed -- --reset nếu muốn XÓA và nạp lại toàn bộ dữ liệu demo.');
      }
    }
    return;
  }

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
      create: { email: staff.email, fullName: staff.fullName, role: staff.role, status: 'ACTIVE', password: defaultPassword },
    });
    usersMap.set(staff.email, user);
  }

  // 2. Khởi tạo Chi nhánh (từ branches.json)
  console.log('2. Nạp dữ liệu Chi nhánh phòng khám...');
  const branchesMap = new Map();
  for (const b of branchesData) {
    const branch = await prisma.branch.upsert({
      where: { code: b.code },
      update: { ...b, isActive: true },
      create: { ...b, isActive: true },
    });
    branchesMap.set(b.code, branch);
  }

  // Gán cơ sở làm việc cho Quản lý & Lễ tân
  const centralBranch = branchesMap.get('VC-CENTRAL');
  for (const email of ['manager@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.user.update({
      where: { id: usersMap.get(email).id },
      data: { branchId: centralBranch.id },
    });
  }

  // 3. Khởi tạo Phương thức đặt khám
  console.log('3. Cấu hình các phương thức đặt khám...');
  const bookingMethodSeeds = [
    ['SPECIALTY_EXAM', 'Khám Trong Giờ', 'Đặt lịch khám trong giờ hoạt động của phòng khám theo chuyên khoa phù hợp', 1],
    ['CONSULTATION', 'Khám Cùng Bác Sĩ', 'Chủ động chọn bác sĩ CKI - CKII theo học hàm và kinh nghiệm', 2],
    ['ONLINE_CONSULTATION', 'Tư Vấn Online', 'Gọi video 1:1 cùng bác sĩ, đọc kết quả xét nghiệm từ xa', 3],
    ['FOLLOWUP_EXAM', 'Tái Khám', 'Đặt lịch tái khám với bác sĩ đã điều trị để theo dõi sức khỏe định kỳ', 4],
    ['FAMILY_BOOKING', 'Khám Gia Đình', 'Chăm sóc ông bà, cha mẹ và con nhỏ trên cùng một tài khoản', 5],
    ['AFTER_HOURS', 'Khám Ngoài Giờ', 'Khám vào thứ Bảy và Chủ nhật theo lịch tiếp nhận của cơ sở', 6],
    ['HEALTH_PACKAGE', 'Gói Khám Sức Khỏe', 'Đăng ký gói khám sức khỏe tổng quát và chuyên sâu.', 7],
  ];

  const bookingMethodsMap = new Map();
  for (const [code, name, description] of bookingMethodSeeds) {
    const method = await prisma.bookingMethod.upsert({
      where: { code },
      update: { name, description, isActive: true },
      create: { code, name, description, isActive: true },
    });
    bookingMethodsMap.set(code, method);
  }

  for (const branch of branchesMap.values()) {
    for (const [code, , , sortOrder] of bookingMethodSeeds) {
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
        password: defaultPassword,
      },
    });
    usersMap.set(docData.email, user);

    const doctorData = {
      academicRank: docData.academicRank,
      licenseNumber: docData.licenseNumber || null,
      experienceYears: docData.experienceYears || 0,
      biography: docData.biography || null,
      consultationFee: docData.consultationFee,
      onlineConsultationFee: docData.onlineConsultationFee ?? Math.round((docData.consultationFee || 0) * 0.8 / 10000) * 10000,
      isOnlineConsultationEnabled: docData.isOnlineConsultationEnabled ?? true,
      avatarUrl: docData.avatarUrl || DEFAULT_DOCTOR_AVATAR,
      isFeatured: docData.isFeatured ?? false,
      isActive: true,
    };
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: doctorData,
      create: { userId: user.id, ...doctorData },
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

    const targetBranch = branchesMap.get(docData.branchCode);
    if (!targetBranch) throw new Error('Chi nhánh bác sĩ không hợp lệ: ' + docData.email);
    const targetRoom = roomsByBranchAndCode.get(`${targetBranch.code}:${docData.roomCode}`);
    if (!targetRoom) throw new Error('Phòng khám bác sĩ không thuộc chi nhánh: ' + docData.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { branchId: targetBranch.id },
    });

    // Lịch cố định tại một chi nhánh, đủ 30 ngày đặt trước và cả cuối tuần.
    for (let dayOffset = -7; dayOffset <= 30; dayOffset += 1) {
      const workDate = dateOnly(dayOffset);
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

        await prisma.doctorScheduleSlot.createMany({
          data: shift.slots.map(slot => ({ scheduleId: schedule.id, ...slot })),
          skipDuplicates: true,
        });
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
        symptoms: ['Mệt mỏi suy nhược', 'Sụt cân không rõ nguyên nhân', 'Sốt kéo dài', 'Kiểm tra sức khỏe định kỳ'],
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
      const codeSuffix = String(spec.id).padStart(3, '0');
      const specMeta = SPECIALTY_EXTRA_METADATA[spec.slug] || {
        symptoms: spec.symptoms || [],
        standardDesc: spec.description || `Khám chuyên khoa ${spec.name}.`,
        followupDesc: `Theo dõi sau lần khám trước tại chuyên khoa ${spec.name}. ${spec.description || ''}`.trim(),
        notes: 'Mang theo hồ sơ và kết quả khám trước đây (nếu có).',
      };

      const specialtyServices = [
        {
          code: `CONSULT-${codeSuffix}-STANDARD`,
          name: `Khám ${spec.name} trong giờ`,
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
          name: `Khám ${spec.name} ngoài giờ`,
          price: 270000,
          durationMin: 30,
          description: specMeta.standardDesc || `Khám chẩn đoán bệnh lý ${spec.name} ngoài giờ hành chính.`,
          notes: specMeta.notes,
          symptoms: specMeta.symptoms,
          imageUrl: specMeta.afterImg || spec.iconUrl || null,
          methodCode: 'AFTER_HOURS',
        },
        {
          code: `CONSULT-${codeSuffix}-BASIC`,
          ...basicSpecialtyPackage(spec.name),
          price: 180000,
          durationMin: 20,
          symptoms: specMeta.symptoms,
          imageUrl: specMeta.followupImg || spec.iconUrl || null,
          methodCode: 'SPECIALTY_EXAM',
        },
      ];

      for (const service of specialtyServices) {
        const branchBookingMethod = methodByCode.get(service.methodCode);
        if (!branchBookingMethod) continue;
        const slug = toSlug(service.name);
        await upsertSharedSeedPackage(prisma, {
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
            ...packageMetadata(service),
            isActive: true,
          },
          create: {
            branchBookingMethods: { create: { branchBookingMethodId: branchBookingMethod.id } },
            receptionSchedules: { create: (service.methodCode === 'AFTER_HOURS' ? [6, 0] : [0, 1, 2, 3, 4, 5, 6]).map((dayOfWeek) => ({ branchId: branch.id, dayOfWeek, sessions: ['MORNING', 'AFTERNOON'] })) },
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
            ...packageMetadata(service),
            isActive: true,
          },
        });
      }
    }

    // Gói khám sức khỏe (từ services.json)
    const healthPackageMethod = methodByCode.get('HEALTH_PACKAGE');
    if (healthPackageMethod) {
      for (const pkg of healthPackagesData) {
        const fullCode = `PKG-${pkg.codeSuffix}`;
        const fullName = pkg.name;
        const slug = toSlug(fullName);

        await upsertSharedSeedPackage(prisma, {
          where: { code: fullCode },
          update: {
            name: fullName,
            slug,
            description: pkg.description,
            notes: pkg.notes || 'Nhịn ăn sáng ít nhất 6-8 tiếng để thực hiện xét nghiệm máu và siêu âm ổ bụng tổng quát. Uống nhiều nước lọc và nhịn tiểu trước khi siêu âm. Xuất trình CCCD/BHYT tại quầy tiếp đón.',
            symptoms: Array.isArray(pkg.symptoms) ? pkg.symptoms : ['Kiểm tra sức khỏe định kỳ', 'Tầm soát ung thư sớm'],
            imageUrl: pkg.imageUrl || null,
            durationMin: pkg.durationMin || 45,
            price: pkg.price,
            branchBookingMethodId: healthPackageMethod.id,
            ...packageMetadata(pkg),
            isActive: true,
          },
          create: {
            branchBookingMethods: { create: { branchBookingMethodId: healthPackageMethod.id } },
            receptionSchedules: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ branchId: branch.id, dayOfWeek, sessions: ['MORNING', 'AFTERNOON'] })) },
            code: fullCode,
            name: fullName,
            slug,
            description: pkg.description,
            notes: pkg.notes || 'Nhịn ăn sáng ít nhất 6-8 tiếng để thực hiện xét nghiệm máu và siêu âm ổ bụng tổng quát. Uống nhiều nước lọc và nhịn tiểu trước khi siêu âm. Xuất trình CCCD/BHYT tại quầy tiếp đón.',
            symptoms: Array.isArray(pkg.symptoms) ? pkg.symptoms : ['Kiểm tra sức khỏe định kỳ', 'Tầm soát ung thư sớm'],
            imageUrl: pkg.imageUrl || null,
            durationMin: pkg.durationMin || 45,
            price: pkg.price,
            branchBookingMethodId: healthPackageMethod.id,
            ...packageMetadata(pkg),
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
      create: { email: patientData.email, fullName: patientData.fullName, phoneNumber: patientData.phoneNumber, role: 'PATIENT', status: 'ACTIVE', password: defaultPassword },
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
        wardCode: p.wardCode ?? null,
        wardName: p.wardName ?? null,
        streetAddress: p.streetAddress ?? p.address ?? null,
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

  // 11. Tài khoản OAuth mẫu
  console.log('11. Nạp tài khoản OAuth mẫu...');

  const mainPatient = usersMap.get('patient@vitacare.local');
  if (mainPatient) {
    await prisma.oAuthAccount.upsert({
      where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: 'seed-google-account' } },
      update: { userId: mainPatient.id },
      create: { userId: mainPatient.id, provider: 'GOOGLE', providerAccountId: 'seed-google-account' },
    });
  }

  // 12. Trợ lý chỉ minh họa tra cứu dịch vụ và đặt lịch.
  console.log('12. Nạp hội thoại trợ lý đặt lịch mẫu...');
  if (mainPatient) {
    await prisma.aIConversation.create({ data: {
      userId: mainPatient.id, conversationType: 'BOOKING_ASSISTANCE',
      title: 'Tìm dịch vụ khám Mắt', isClosed: true,
      messages: { create: [
        { sender: 'USER', content: 'Cho tôi xem các dịch vụ khám Mắt tại VitaCare.' },
        { sender: 'ASSISTANT', content: 'Bạn có thể tìm dịch vụ khám Mắt, chọn cơ sở và xem khung giờ trống để đặt lịch.' },
      ] },
    } });
  }

  await clearSeedCaches();
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

async function clearSeedCaches() {
  if (process.env.REDIS_ENABLED !== 'true') return;
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    db: Number(process.env.REDIS_DB || 0), lazyConnect: true, maxRetriesPerRequest: 1,
    retryStrategy: () => null, connectTimeout: 5000,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    const prefix = process.env.REDIS_KEY_PREFIX ?? 'vitacare:';
    let removed = 0;
    for (const pattern of ['cache:public:*', 'rec:cache:*', 'rec:v2:*', 'rec:v3:*', 'rec:v4:*', 'rec:v5:*', 'pkg_vss:*', 'vector:pkg:*', 'user:status:*']) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', prefix + pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) removed += await redis.del(...keys);
      } while (cursor !== '0');
    }
    console.log(`✓ Đã dọn ${removed} cache và chỉ mục dữ liệu cũ trong Redis.`);
  } catch {
    console.warn('Không kết nối được Redis để dọn cache sau seed.');
  } finally {
    redis.disconnect();
  }
}

/** Shared by the demo seed and the non-destructive catalog conversion. */
function basicSpecialtyPackage(specialtyName, branchName) {
  return {
    name: `Gói khám ${specialtyName} cơ bản${branchName ? ` (${branchName})` : ''}`,
    description: `Gói khám chuyên khoa ${specialtyName} cơ bản: tiếp nhận thông tin sức khỏe, thăm khám theo nhu cầu và tư vấn các bước chăm sóc tiếp theo.`,
    notes: 'Mang theo hồ sơ sức khỏe và kết quả khám đã có (nếu có). Các chỉ định bổ sung được bác sĩ tư vấn sau khi thăm khám.',
    isFollowUp: false,
    followUpAfterDays: null,
  };
}

/** Seed one catalog item, then attach each offering branch without duplicating it. */
async function upsertSharedSeedPackage(prisma, { where, update, create }) {
  const { branchBookingMethods, receptionSchedules, ...fields } = create;
  const { branchBookingMethodId: _legacyMethod, ...updatedFields } = update;
  return prisma.$transaction(async tx => {
    const pkg = await tx.servicePackage.upsert({ where, create: fields, update: updatedFields });
    const branchBookingMethodId = branchBookingMethods.create.branchBookingMethodId;
    await tx.packageBranchMethod.upsert({
      where: { servicePackageId_branchBookingMethodId: { servicePackageId: pkg.id, branchBookingMethodId } },
      create: { servicePackageId: pkg.id, branchBookingMethodId }, update: {},
    });
    for (const schedule of receptionSchedules.create) {
      await tx.packageReceptionTime.upsert({
        where: { servicePackageId_branchId_dayOfWeek: {
          servicePackageId: pkg.id, branchId: schedule.branchId, dayOfWeek: schedule.dayOfWeek,
        } }, create: { servicePackageId: pkg.id, ...schedule }, update: { sessions: schedule.sessions },
      });
    }
    return pkg;
  });
}

const DAY = 86_400_000;
const uid = (key) => {
  const hex = createHash('sha256').update('vitacare-demo-v2:' + key).digest('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
};
function demoDate(offset = 0, now = SEED_NOW) {
  const vnDate = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(vnDate + 'T00:00:00Z').getTime() + offset * DAY);
}
const hour = (h, m = 0) => new Date(Date.UTC(1970, 0, 1, h, m));

const demoStaff = [
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
async function seedDashboardData(prisma, { passwordHash }) {
  const now = SEED_NOW;
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
      isBlocked,
      isDeleted: false, lastLoginAt: new Date(now.getTime() - (isBlocked ? DAY * 2 : (index + 1) * 180_000)) };
    const user = await prisma.user.upsert({
      where: { email }, update: fields,
      create: { email, ...fields, password: passwordHash },
    });
    accounts.set(email, user);
    if (branchCode) {
      const branchId = branchMap.get(branchCode).id;
      await prisma.user.update({ where: { id: user.id }, data: { branchId } });
    }
    if (role === 'RECEPTIONIST') {
      const data = { employeeCode: 'LT-DEMO-' + String(index).padStart(3, '0'), deskNumber: index % 2 ? 'Quầy 2' : 'Quầy 1', isActive: !isBlocked && state !== 'INACTIVE' };
      await prisma.receptionist.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
    }
    if (role === 'DOCTOR') {
      const data = { academicRank: 'Bác sĩ CKI', licenseNumber: 'DEMO-CCHN-LOCKED', experienceYears: 10,
        biography: 'Hồ sơ minh họa bác sĩ tạm khóa tài khoản, không phân công lịch trực.',
        avatarUrl: DEFAULT_DOCTOR_AVATAR,
        consultationFee: 250000, onlineConsultationFee: 200000,
        isOnlineConsultationEnabled: false, isFeatured: false, isActive: false };
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
      provinceCode: '79', provinceName: 'Thành phố Hồ Chí Minh',
      wardCode: '26734', wardName: 'Phường Bến Thành', streetAddress: (20 + i) + ' Lê Lợi, Quận 1',
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
    wardCode: '26734', wardName: 'Phường Bến Thành',
    streetAddress: '88 Lê Lợi, Quận 1',
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

  const appointmentCount = await seedAppointmentScenarios(prisma, { accounts, branchMap });

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
    const existingOutbox = await prisma.outboxEvent.findFirst({
      where: { eventType: fields.eventType, aggregateId: fields.aggregateId },
      select: { id: true },
    });
    if (existingOutbox) {
      await prisma.outboxEvent.update({ where: { id: existingOutbox.id }, data: fields });
    } else {
      await prisma.outboxEvent.create({ data: fields });
    }
  }
  for (const [i, user] of allUsers.entries()) {
    const fields = { userId: user.id, title: '[DEMO] Chào mừng đến VitaCare',
      content: 'Dữ liệu minh họa đã sẵn sàng. Kiểm tra lịch làm việc và lịch hẹn tại chi nhánh của bạn.',
      type: 'SYSTEM', data: { demo: true }, isRead: i % 3 === 0, createdAt: now };
    const existingNotification = await prisma.notification.findFirst({
      where: { userId: user.id, title: fields.title },
      select: { id: true },
    });
    if (existingNotification) {
      await prisma.notification.update({ where: { id: existingNotification.id }, data: fields });
    } else {
      await prisma.notification.create({ data: fields });
    }
  }
  console.log('✓ Dashboard demo: ' + appointmentCount + ' lịch hẹn, đủ 7 trạng thái; ngày khám tính theo thời điểm seed tại Việt Nam.');
  console.log('✓ 2 quản lý cơ sở hoạt động, 4 lễ tân hoạt động, 4 tài khoản khóa, 1 tài khoản ngừng hoạt động.');
  console.log('✓ Thanh toán CASH / ONLINE; nhật ký, thông báo và Outbox đều gắn nhãn DEMO.');
  return { appointmentCount };
}

// Ten appointment scenarios share the main patient account for easy inspection.
// All dates are relative to one frozen seed time in Vietnam, never fixed dates.
async function seedPackageReceptionSlots(prisma) {
  const packages = await prisma.servicePackage.findMany({
    where: { branchBookingMethods: { some: { branchBookingMethod: { bookingMethod: { code: 'HEALTH_PACKAGE' } } } } },
    select: { id: true, receptionSchedules: true },
  });
  for (const pkg of packages) {
    const rows = [];
    for (let offset = -7; offset <= 30; offset++) {
      const date = demoDate(offset);
      for (const reception of pkg.receptionSchedules.filter(day => day.dayOfWeek === date.getUTCDay())) {
        for (const [index, shift] of SHIFT_DEFINITIONS.entries()) {
          if (!reception.sessions.includes(index === 0 ? 'MORNING' : 'AFTERNOON')) continue;
          rows.push(...shift.slots.map(slot => ({
            branchId: reception.branchId, servicePackageId: pkg.id, date,
            startTime: slot.startTime, endTime: slot.endTime, capacity: 5,
          })));
        }
      }
    }
    for (let index = 0; index < rows.length; index += 500) {
      await prisma.packageReceptionSlot.createMany({ data: rows.slice(index, index + 500), skipDuplicates: true });
    }
  }
}

async function seedAppointmentScenarios(prisma, { accounts, branchMap }) {
  const profile = await prisma.patientProfile.findFirstOrThrow({
    where: { account: { email: 'patient@vitacare.local' }, isMainProfile: true },
    select: { id: true, accountId: true },
  });
  const methods = new Map((await prisma.bookingMethod.findMany({ select: { id: true, code: true } })).map(method => [method.code, method.id]));
  await seedPackageReceptionSlots(prisma);
  const local = new Date(SEED_NOW.getTime() + 7 * 3_600_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const checkedInOffset = minutes < 450 ? -1 : 0;
  const checkedInMinute = minutes < 450 || minutes >= 1020 ? 990
    : minutes >= 690 && minutes < 810 ? 660 : Math.floor(minutes / 30) * 30;
  const scenarios = [
    { code: 'VC-DEMO-01', status: 'HOLD', offset: 2, kind: 'doctor', minute: 540 },
    { code: 'VC-DEMO-02', status: 'CONFIRMED', offset: 3, kind: 'eye', minute: 540 },
    { code: 'VC-DEMO-03', status: 'CONFIRMED', offset: 4, kind: 'health', minute: 480 },
    { code: 'VC-DEMO-04', status: 'CONFIRMED', offset: 2, kind: 'online', minute: 600 },
    { code: 'VC-DEMO-05', status: 'CHECKED_IN', offset: checkedInOffset, kind: 'doctor', minute: checkedInMinute },
    { code: 'VC-DEMO-06', status: 'COMPLETED', offset: -1, kind: 'health', minute: 480 },
    { code: 'VC-DEMO-07', status: 'CANCELLED', offset: -2, kind: 'eye', minute: 540, cancelHours: 24, refundRate: 95 },
    { code: 'VC-DEMO-08', status: 'CANCELLED', offset: -3, kind: 'eye', minute: 540, cancelHours: 3, refundRate: 80, branchCode: 'VC-EAST' },
    { code: 'VC-DEMO-09', status: 'EXPIRED', offset: -4, kind: 'doctor', minute: 540 },
    { code: 'VC-DEMO-10', status: 'NO_SHOW', offset: -2, kind: 'online', minute: 600 },
  ];
  const summary = [];
  for (const scenario of scenarios) {
    const branch = branchMap.get(scenario.branchCode || 'VC-CENTRAL');
    const receptionist = accounts.get(branch.code === 'VC-EAST' ? 'receptionist.east@vitacare.local' : 'receptionist@vitacare.local');
    const date = demoDate(scenario.offset);
    const startTime = hour(Math.floor(scenario.minute / 60), scenario.minute % 60);
    const startsAt = new Date(`${date.toISOString().slice(0, 10)}T${startTime.toISOString().slice(11, 19)}+07:00`);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    if (scenario.status === 'CONFIRMED' && startsAt <= SEED_NOW) throw new Error('Lịch xác nhận phải nằm trong tương lai: ' + scenario.code);
    if (['COMPLETED', 'NO_SHOW'].includes(scenario.status) && endsAt >= SEED_NOW) throw new Error('Lịch kết thúc phải nằm trong quá khứ: ' + scenario.code);
    let doctor = null, slot = null, receptionSlot = null, pkg = null;
    const methodCode = scenario.kind === 'health' ? 'HEALTH_PACKAGE' : scenario.kind === 'eye' ? 'SPECIALTY_EXAM'
      : scenario.kind === 'online' ? 'ONLINE_CONSULTATION' : 'CONSULTATION';
    if (scenario.kind === 'health' || scenario.kind === 'eye') {
      pkg = await prisma.servicePackage.findFirstOrThrow({
        where: {
          ...(scenario.kind === 'eye' ? { specialty: { slug: 'mat' } } : { code: 'PKG-GENERAL-BASIC' }),
          branchBookingMethods: { some: { branchBookingMethod: { branchId: branch.id, bookingMethod: { code: methodCode } } } },
        }, orderBy: { code: 'asc' }, select: { id: true, name: true, price: true },
      });
    }
    if (scenario.kind === 'health') {
      receptionSlot = await prisma.packageReceptionSlot.findUniqueOrThrow({
        where: { branchId_servicePackageId_date_startTime: { branchId: branch.id, servicePackageId: pkg.id, date, startTime } },
        select: { id: true },
      });
    } else {
      const fixture = scenario.kind === 'eye'
        ? doctorsData.find(item => item.specialtySlug === 'mat' && item.branchCode === branch.code)
        : doctorsData.find(item => item.email === 'doctor.cardio@vitacare.local');
      if (!fixture) throw new Error('Thiếu bác sĩ cho ' + scenario.code);
      doctor = await prisma.doctor.findFirstOrThrow({ where: { user: { email: fixture.email } },
        select: { id: true, userId: true, consultationFee: true, onlineConsultationFee: true } });
      slot = await prisma.doctorScheduleSlot.findFirstOrThrow({
        where: { startTime, schedule: { doctorId: doctor.id, branchId: branch.id, workDate: date } },
        select: { id: true },
      });
    }
    const price = Number(pkg?.price ?? (scenario.kind === 'online' ? doctor.onlineConsultationFee : doctor.consultationFee));
    const paid = !['HOLD', 'EXPIRED'].includes(scenario.status);
    const counter = scenario.status === 'CHECKED_IN' || scenario.status === 'HOLD';
    const fee = counter ? 0 : 10_000;
    const total = price + fee;
    const createdAt = scenario.status === 'HOLD' ? new Date(SEED_NOW.getTime() - 5 * 60_000)
      : new Date(Math.min(SEED_NOW.getTime() - 3_600_000, startsAt.getTime() - 2 * DAY));
    const paidAt = paid ? new Date(createdAt.getTime() + 60_000) : null;
    const checkedIn = ['CHECKED_IN', 'COMPLETED'].includes(scenario.status);
    const checkedInAt = checkedIn ? new Date(startsAt.getTime() - 5 * 60_000) : null;
    const cancelledAt = scenario.cancelHours ? new Date(startsAt.getTime() - scenario.cancelHours * 3_600_000) : null;
    const holdExpiresAt = ['HOLD', 'EXPIRED'].includes(scenario.status) ? new Date(createdAt.getTime() + 15 * 60_000) : null;
    const appointmentId = uid(scenario.code), paymentId = uid('payment-' + scenario.code);
    await prisma.$transaction(async tx => {
      const order = await tx.bookingOrder.create({ data: {
        accountId: profile.accountId, orderCode: 'ORD-' + scenario.code, groupType: 'SINGLE',
        status: ['CANCELLED', 'EXPIRED'].includes(scenario.status) ? 'CANCELLED' : paid ? 'PAID' : 'UNPAID',
        totalAmount: total, note: '[DEMO] ' + scenario.status, createdAt,
      } });
      await tx.appointment.create({ data: {
        id: appointmentId, bookingCode: scenario.code, bookingOrderId: order.id,
        patientProfileId: profile.id, branchId: branch.id, bookingMethodId: methods.get(methodCode),
        scheduleSlotId: slot?.id ?? null, receptionSlotId: receptionSlot?.id ?? null,
        servicePackageId: pkg?.id ?? null, servicePrice: price, status: scenario.status,
        queueNumber: slot && paid && scenario.status !== 'CANCELLED' ? 1 : null,
        checkedInAt, checkedInById: checkedIn ? receptionist.id : null, holdExpiresAt, createdAt,
        symptomsDescription: '[DEMO] Dữ liệu lịch hẹn minh họa',
      } });
      const invoice = await tx.invoice.create({ data: {
        bookingOrderId: order.id, issuedBranchId: branch.id,
        subtotal: price, serviceFee: fee, totalAmount: total, createdAt, paidAt,
        status: scenario.status === 'EXPIRED' ? 'CANCELLED' : paid ? 'PAID' : 'UNPAID',
      } });
      const rawPayload = { demo: true, channel: counter ? 'COUNTER' : 'WEB', collectedBy: counter ? receptionist.id : null };
      if (cancelledAt) {
        const refundAmount = Math.floor(total * scenario.refundRate / 100);
        const refundBank = { bankCode: 'VBA', bankBin: '970405', bankName: 'Agribank', accountNumber: '7102205531612', accountName: 'NGUYEN VAN AN DEMO' };
        const policyVersion = 'cancellation-95-80-0-v2';
        rawPayload.refundBank = refundBank;
        rawPayload.refundRequestedAt = cancelledAt.toISOString();
        rawPayload.appointmentRefunds = { [appointmentId]: {
          isPaid: true, paidAmount: total, refundRate: scenario.refundRate, refundAmount,
          retainedAmount: total - refundAmount, requiresManualReview: false, policyVersion,
          quoteKey: JSON.stringify([appointmentId, paymentId, policyVersion, total, scenario.refundRate, refundAmount]),
          requestedAt: cancelledAt.toISOString(), approvedAt: cancelledAt.toISOString(), approvedBy: 'SYSTEM',
          approvalStatus: 'APPROVED', reason: 'Thay đổi kế hoạch cá nhân', refundBank,
        } };
      }
      await tx.paymentTransaction.create({ data: {
        id: paymentId, invoiceId: invoice.id, provider: counter ? 'DEMO_COUNTER' : 'DEMO_PAYOS',
        providerTransactionId: 'TXN-' + scenario.code, idempotencyKey: 'IDEM-' + scenario.code,
        method: counter ? 'CASH' : 'ONLINE', amount: total, createdAt, paidAt, rawPayload,
        status: scenario.status === 'EXPIRED' ? 'EXPIRED' : !paid ? 'PENDING' : cancelledAt ? 'REFUND_REQUIRED' : 'SUCCESS',
      } });
      const histories = [{ appointmentId, fromStatus: null, toStatus: 'HOLD', actorId: profile.accountId, createdAt, reason: '[DEMO] Tạo lịch hẹn' }];
      if (paid) histories.push({ appointmentId, fromStatus: 'HOLD', toStatus: 'CONFIRMED', actorId: profile.accountId,
        createdAt: paidAt, reason: '[DEMO] Thanh toán và xác nhận lịch hẹn' });
      if (checkedIn) histories.push({ appointmentId, fromStatus: 'CONFIRMED', toStatus: 'CHECKED_IN', actorId: receptionist.id,
        createdAt: checkedInAt, reason: '[DEMO] Tiếp nhận bệnh nhân' });
      if (scenario.status === 'COMPLETED') histories.push({ appointmentId, fromStatus: 'CHECKED_IN', toStatus: 'COMPLETED',
        actorId: doctor?.userId ?? receptionist.id, createdAt: endsAt, reason: '[DEMO] Hoàn tất gói khám' });
      if (cancelledAt) histories.push({ appointmentId, fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', actorId: profile.accountId,
        createdAt: cancelledAt, reason: 'Bệnh nhân hủy: Thay đổi kế hoạch cá nhân' });
      if (scenario.status === 'EXPIRED') histories.push({ appointmentId, fromStatus: 'HOLD', toStatus: 'EXPIRED', actorId: null,
        createdAt: holdExpiresAt, reason: '[DEMO] Hết hạn giữ chỗ, chưa thanh toán' });
      if (scenario.status === 'NO_SHOW') histories.push({ appointmentId, fromStatus: 'CONFIRMED', toStatus: 'NO_SHOW', actorId: null,
        createdAt: new Date(`${date.toISOString().slice(0, 10)}T23:59:00+07:00`), reason: 'AUTO_NO_SHOW: Hết ngày khám, bệnh nhân chưa check-in.' });
      await tx.appointmentStatusHistory.createMany({ data: histories });
      await tx.appointmentQrToken.create({ data: { appointmentId,
        tokenHash: createHash('sha256').update('demo-ticket:' + scenario.code).digest('hex'),
        expiresAt: endsAt, usedAt: checkedInAt,
      } });
      if (!['CANCELLED', 'EXPIRED'].includes(scenario.status)) {
        if (receptionSlot) await tx.packageReceptionSlot.update({ where: { id: receptionSlot.id }, data: { occupiedCount: { increment: 1 } } });
        if (slot) await tx.doctorScheduleSlot.update({ where: { id: slot.id }, data: { occupiedCount: { increment: 1 } } });
      }
    });
    summary.push({ code: scenario.code, status: scenario.status, date: date.toISOString().slice(0, 10),
      time: startTime.toISOString().slice(11, 16), type: methodCode, refund: scenario.refundRate ? `${scenario.refundRate}%` : '—' });
  }
  console.table(summary);
  return scenarios.length;
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
