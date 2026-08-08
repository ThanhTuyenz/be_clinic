import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

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
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + daysFromNow);
  return value;
}

function time(hour, minute = 0) {
  return new Date(Date.UTC(1970, 0, 1, hour, minute, 0));
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

  for (const email of ['manager@vitacare.local', 'pharmacist@vitacare.local', 'cashier@vitacare.local', 'receptionist@vitacare.local']) {
    await prisma.userBranchAssignment.upsert({
      where: { userId_branchId: { userId: users.get(email).id, branchId: branches[0].id } },
      update: {}, create: { userId: users.get(email).id, branchId: branches[0].id, isPrimary: true },
    });
  }

  const cardio = await prisma.department.upsert({ where: { name: 'Tim mạch' }, update: {}, create: { name: 'Tim mạch', description: 'Khám và điều trị bệnh lý tim mạch' } });
  const pediatrics = await prisma.department.upsert({ where: { name: 'Nhi khoa' }, update: {}, create: { name: 'Nhi khoa', description: 'Khám và điều trị cho trẻ em' } });
  const cardioSpecialty = await prisma.specialty.upsert({ where: { departmentId_name: { departmentId: cardio.id, name: 'Tim mạch tổng quát' } }, update: {}, create: { departmentId: cardio.id, name: 'Tim mạch tổng quát' } });
  const pediatricSpecialty = await prisma.specialty.upsert({ where: { departmentId_name: { departmentId: pediatrics.id, name: 'Nhi tổng quát' } }, update: {}, create: { departmentId: pediatrics.id, name: 'Nhi tổng quát' } });

  const doctorInputs = [
    { email: 'doctor.cardio@vitacare.local', department: cardio, specialty: cardioSpecialty, fee: 300000 },
    { email: 'doctor.pediatrics@vitacare.local', department: pediatrics, specialty: pediatricSpecialty, fee: 250000 },
  ];
  for (const input of doctorInputs) {
    const user = users.get(input.email);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, isActive: true },
      create: { userId: user.id, fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, academicRank: 'Bác sĩ CKI' },
    });
    await prisma.doctorSpecialty.upsert({ where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: input.specialty.id } }, update: { isPrimary: true }, create: { doctorId: doctor.id, specialtyId: input.specialty.id, isPrimary: true } });
    await prisma.doctorBranchAssignment.upsert({ where: { doctorId_branchId: { doctorId: doctor.id, branchId: branches[0].id } }, update: {}, create: { doctorId: doctor.id, branchId: branches[0].id, isPrimary: true } });

    for (let day = 1; day <= 30; day += 1) {
      const workDate = dateOnly(day);
      if (workDate.getUTCDay() === 0) continue;
      const schedule = await prisma.doctorSchedule.upsert({
        where: { doctorId_branchId_workDate_startTime: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8) } },
        update: { status: 'OPEN' },
        create: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8), endTime: time(11, 30), status: 'OPEN' },
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

  const patient = users.get('patient@vitacare.local');
  const currentMain = await prisma.patientProfile.findFirst({ where: { accountId: patient.id, isMainProfile: true } });
  if (!currentMain) {
    await prisma.patientProfile.create({ data: { accountId: patient.id, fullName: patient.fullName, dateOfBirth: new Date('2000-01-15T00:00:00.000Z'), gender: 'MALE', relationshipToAccount: 'SELF', isMainProfile: true } });
  }
  console.log('Seed completed. Test password: VitaCare@123');
}

main().finally(() => prisma.$disconnect());
