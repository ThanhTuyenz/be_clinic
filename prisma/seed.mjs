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

  for (const [index, branch] of branches.entries()) {
    await prisma.clinicRoom.upsert({
      where: { branchId_code: { branchId: branch.id, code: `P${index + 1}01` } },
      update: { name: `Phòng khám ${index + 1}01`, isActive: true },
      create: { branchId: branch.id, code: `P${index + 1}01`, name: `Phòng khám ${index + 1}01` },
    });
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
  const doctors = new Map();
  const slotsByDoctor = new Map();
  for (const input of doctorInputs) {
    const user = users.get(input.email);
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: { fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, isActive: true },
      create: { userId: user.id, fullName: user.fullName, departmentId: input.department.id, consultationFee: input.fee, academicRank: 'Bác sĩ CKI' },
    });
    doctors.set(input.email, doctor);
    slotsByDoctor.set(input.email, []);
    await prisma.doctorSpecialty.upsert({ where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: input.specialty.id } }, update: { isPrimary: true }, create: { doctorId: doctor.id, specialtyId: input.specialty.id, isPrimary: true } });
    await prisma.doctorBranchAssignment.upsert({ where: { doctorId_branchId: { doctorId: doctor.id, branchId: branches[0].id } }, update: {}, create: { doctorId: doctor.id, branchId: branches[0].id, isPrimary: true } });

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
        update: { status: 'OPEN' },
        create: { doctorId: doctor.id, branchId: branches[0].id, workDate, startTime: time(8), endTime: time(11, 30), status: 'OPEN' },
      });
      for (const [startHour, endHour, endMinute, capacity] of [[8, 9, 0, 5], [9, 10, 0, 5], [10, 11, 0, 5], [11, 11, 30, 2]]) {
        const slot = await prisma.doctorScheduleSlot.upsert({
          where: { scheduleId_startTime: { scheduleId: schedule.id, startTime: time(startHour) } },
          update: { endTime: time(endHour, endMinute), capacity, isActive: true },
          create: { scheduleId: schedule.id, startTime: time(startHour), endTime: time(endHour, endMinute), capacity },
        });
        if (day <= 3) slotsByDoctor.get(input.email).push(slot);
      }
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
  await seedBookingTables({ users, doctors, slotsByDoctor, branches, mainProfile, childProfile });
  console.log('Seed completed with doctor waiting queue. Test password: VitaCare@123');
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

async function seedBookingTables({ users, doctors, slotsByDoctor, branches, mainProfile, childProfile }) {
  const cardioDoctor = doctors.get('doctor.cardio@vitacare.local');
  const slots = slotsByDoctor.get('doctor.cardio@vitacare.local');
  const pediatricDoctor = doctors.get('doctor.pediatrics@vitacare.local');
  const pediatricSlots = slotsByDoctor.get('doctor.pediatrics@vitacare.local');
  if (!cardioDoctor || slots.length < 3) throw new Error('Không đủ timeslot để seed booking');
  if (!pediatricDoctor || pediatricSlots.length < 2) throw new Error('Không đủ timeslot Nhi khoa để seed booking');
  const cashier = users.get('cashier@vitacare.local');
  const receptionist = users.get('receptionist@vitacare.local');
  const booked = await upsertAppointment({ code: 'VC-SEED-WAIT-01', profile: mainProfile, doctor: cardioDoctor, branch: branches[0], slot: slots[0], status: 'CHECKED_IN', symptoms: 'Đau ngực nhẹ khi vận động', queueNumber: 1, checkedInById: receptionist.id });
  const waitingChild = await upsertAppointment({ code: 'VC-SEED-WAIT-02', profile: childProfile, doctor: cardioDoctor, branch: branches[0], slot: slots[0], status: 'CHECKED_IN', symptoms: 'Ho và sốt nhẹ', queueNumber: 2, checkedInById: receptionist.id });
  const pediatricWaiting1 = await upsertAppointment({ code: 'VC-PED-WAIT-01', profile: childProfile, doctor: pediatricDoctor, branch: branches[0], slot: pediatricSlots[0], status: 'CHECKED_IN', symptoms: 'Ho, sốt nhẹ và sổ mũi', queueNumber: 1, checkedInById: receptionist.id });
  const pediatricWaiting2 = await upsertAppointment({ code: 'VC-PED-WAIT-02', profile: mainProfile, doctor: pediatricDoctor, branch: branches[0], slot: pediatricSlots[0], status: 'CHECKED_IN', symptoms: 'Tái khám theo lịch hẹn', queueNumber: 2, checkedInById: receptionist.id });
  const completed = await upsertAppointment({ code: 'VC-SEED-DONE', profile: mainProfile, doctor: cardioDoctor, branch: branches[0], slot: slots[1], status: 'COMPLETED', symptoms: 'Tái khám huyết áp', queueNumber: 1, checkedInById: receptionist.id });
  const pending = await upsertAppointment({ code: 'VC-SEED-PENDING', profile: childProfile, doctor: cardioDoctor, branch: branches[0], slot: slots[2], status: 'PENDING_PAYMENT', symptoms: 'Khám sức khỏe tổng quát', holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000) });

  await prisma.doctorScheduleSlot.update({ where: { id: slots[0].id }, data: { occupiedCount: 2, nextQueueNumber: 2 } });
  await prisma.doctorScheduleSlot.update({ where: { id: slots[1].id }, data: { occupiedCount: 1, nextQueueNumber: 1 } });
  await prisma.doctorScheduleSlot.update({ where: { id: slots[2].id }, data: { occupiedCount: 1 } });
  await prisma.doctorScheduleSlot.update({ where: { id: pediatricSlots[0].id }, data: { occupiedCount: 2, nextQueueNumber: 2 } });

  await seedPaidInvoice(booked, mainProfile, branches[0], cashier, 300000, 'seed-payment-booked');
  await seedPaidInvoice(waitingChild, childProfile, branches[0], cashier, 300000, 'seed-payment-waiting-child');
  await seedPaidInvoice(pediatricWaiting1, childProfile, branches[0], cashier, 250000, 'seed-payment-pediatric-1');
  await seedPaidInvoice(pediatricWaiting2, mainProfile, branches[0], cashier, 250000, 'seed-payment-pediatric-2');
  await seedPaidInvoice(completed, mainProfile, branches[0], cashier, 300000, 'seed-payment-completed');
  const pendingInvoice = await prisma.invoice.upsert({
    where: { appointmentId: pending.id },
    update: { status: 'UNPAID', totalAmount: 300000, cashierId: null, paidAt: null },
    create: { appointmentId: pending.id, patientProfileId: childProfile.id, branchId: branches[0].id, totalAmount: 300000 },
  });
  await replaceInvoiceItem(pendingInvoice.id, 300000);
  await prisma.paymentTransaction.upsert({
    where: { idempotencyKey: 'seed-payment-pending' },
    update: { invoiceId: pendingInvoice.id, status: 'PENDING', amount: 300000 },
    create: { invoiceId: pendingInvoice.id, provider: 'VIETQR_SANDBOX', idempotencyKey: 'seed-payment-pending', method: 'VIETQR', amount: 300000, status: 'PENDING' },
  });

  for (const appointment of [booked, completed]) {
    const tokenHash = createHash('sha256').update(`seed-qr-${appointment.id}`).digest('hex');
    await prisma.appointmentQrToken.upsert({ where: { appointmentId: appointment.id }, update: { tokenHash, expiresAt: dateOnly(7), usedAt: appointment.status === 'COMPLETED' ? new Date() : null }, create: { appointmentId: appointment.id, tokenHash, expiresAt: dateOnly(7), usedAt: appointment.status === 'COMPLETED' ? new Date() : null } });
  }

  const outboxId = '10000000-0000-4000-8000-000000000010';
  await prisma.outboxEvent.upsert({ where: { id: outboxId }, update: { status: 'PUBLISHED', publishedAt: new Date() }, create: { id: outboxId, aggregateType: 'Appointment', aggregateId: booked.id, eventType: 'appointment.booked', payload: { appointmentId: booked.id, seed: true }, status: 'PUBLISHED', publishedAt: new Date(), attempts: 1 } });
  await prisma.processedEvent.upsert({ where: { eventId: outboxId }, update: { consumer: 'seed-consumer' }, create: { eventId: outboxId, consumer: 'seed-consumer' } });
  await prisma.auditLog.deleteMany({ where: { targetType: 'seed' } });
  await prisma.auditLog.createMany({ data: [
    { actorId: users.get('admin@vitacare.local').id, action: 'SEED_CREATED', targetType: 'seed', targetId: clinicSafeId(branches[0].id), metadata: { entity: 'infrastructure' } },
    { actorId: receptionist.id, action: 'APPOINTMENT_CHECKED_IN', targetType: 'seed', targetId: completed.id, metadata: { queueNumber: 1 } },
  ] });
}

async function upsertAppointment({ code, profile, doctor, branch, slot, status, symptoms, queueNumber, checkedInById, holdExpiresAt }) {
  const appointment = await prisma.appointment.upsert({
    where: { bookingCode: code },
    update: { patientProfileId: profile.id, doctorId: doctor.id, branchId: branch.id, scheduleSlotId: slot.id, status, symptomsDescription: symptoms, queueNumber, checkedInById, checkedInAt: checkedInById ? new Date() : null, holdExpiresAt: holdExpiresAt ?? null },
    create: { bookingCode: code, patientProfileId: profile.id, doctorId: doctor.id, branchId: branch.id, scheduleSlotId: slot.id, status, symptomsDescription: symptoms, queueNumber, checkedInById, checkedInAt: checkedInById ? new Date() : null, holdExpiresAt: holdExpiresAt ?? null },
  });
  await prisma.appointmentStatusHistory.deleteMany({ where: { appointmentId: appointment.id } });
  await prisma.appointmentStatusHistory.create({ data: { appointmentId: appointment.id, toStatus: status, actorId: checkedInById, reason: 'SEED_DATA' } });
  return appointment;
}

async function seedPaidInvoice(appointment, profile, branch, cashier, amount, idempotencyKey) {
  const invoice = await prisma.invoice.upsert({ where: { appointmentId: appointment.id }, update: { patientProfileId: profile.id, branchId: branch.id, cashierId: cashier.id, totalAmount: amount, status: 'PAID', paidAt: new Date() }, create: { appointmentId: appointment.id, patientProfileId: profile.id, branchId: branch.id, cashierId: cashier.id, totalAmount: amount, status: 'PAID', paidAt: new Date() } });
  await replaceInvoiceItem(invoice.id, amount);
  await prisma.paymentTransaction.upsert({ where: { idempotencyKey }, update: { invoiceId: invoice.id, status: 'SUCCESS', paidAt: new Date(), amount }, create: { invoiceId: invoice.id, provider: 'VIETQR_SANDBOX', providerTransactionId: `provider-${idempotencyKey}`, idempotencyKey, method: 'VIETQR', amount, status: 'SUCCESS', paidAt: new Date(), rawPayload: { seed: true } } });
}

async function replaceInvoiceItem(invoiceId, amount) {
  await prisma.invoiceItem.deleteMany({ where: { invoiceId } });
  await prisma.invoiceItem.create({ data: { invoiceId, description: 'Phí khám', quantity: 1, unitPrice: amount, amount } });
}

function clinicSafeId(value) { return `branch:${value}`; }

main().finally(() => prisma.$disconnect());
