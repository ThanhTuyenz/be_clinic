import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { demoDate, demoStaff } from '../prisma/seed-dashboard-data.mjs';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: process.env.ENV_FILE || '.env.development', override: true, quiet: true });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
try {
  const users = await prisma.user.findMany({ select: { id: true, fullName: true, email: true, phoneNumber: true,
    lastLoginAt: true, role: true, status: true, isBlocked: true, blockedAt: true,
    branchAssignments: { select: { branchId: true } } } });
  assert(users.every(u => u.fullName && u.email && /^0\d{9}$/.test(u.phoneNumber) && u.lastLoginAt), 'Every account needs name, email, valid phone and last login');
  assert.equal(new Set(users.map(u => u.phoneNumber)).size, users.length, 'Phones must be unique');
  assert.equal(users.filter(u => u.isBlocked).length, 4);
  assert(users.filter(u => u.isBlocked).every(u => u.blockedAt));
  const managers = users.filter(u => u.role === 'BRANCH_MANAGER' && !u.isBlocked && u.status === 'ACTIVE');
  assert.equal(managers.length, 2);
  assert(managers.every(u => u.branchAssignments.length === 1));
  assert.equal(new Set(managers.map(u => u.branchAssignments[0].branchId)).size, 2);
  const doctors = await prisma.doctor.findMany({ select: { id: true, user: { select: { branchAssignments: { select: { branchId: true, isPrimary: true } } } } } });
  assert(doctors.every(d => d.user.branchAssignments.length === 1 && d.user.branchAssignments[0].isPrimary), 'Each doctor must work at exactly one primary branch');
  const doctorBranch = new Map(doctors.map(d => [d.id, d.user.branchAssignments[0].branchId]));
  const schedules = await prisma.doctorSchedule.findMany({ select: { doctorId: true, branchId: true } });
  assert(schedules.every(s => doctorBranch.get(s.doctorId) === s.branchId), 'Every shift must belong to the doctor assigned branch');
  const afterHours = await prisma.servicePackage.findMany({ where: { branchBookingMethod: { bookingMethod: { code: 'AFTER_HOURS' } } }, select: { receptionSchedules: { select: { dayOfWeek: true } } } });
  assert(afterHours.length > 0 && afterHours.every(p => p.receptionSchedules.length === 2 && p.receptionSchedules.every(day => [0, 6].includes(day.dayOfWeek))), 'After-hours packages only accept Saturday and Sunday');
  for (const [email] of demoStaff) assert(users.some(u => u.email === email));
  const profiles = await prisma.patientProfile.findMany({ select: { fullName: true, phoneNumber: true, dateOfBirth: true,
    gender: true, nationalId: true, healthInsuranceNumber: true, address: true, guardianName: true, guardianPhone: true,
    occupation: true, bloodGroup: true, allergies: true, medicalHistory: true, height: true, weight: true } });
  assert(profiles.every(p => Object.values(p).every(v => v != null && v !== '')), 'Patient demographic, contact and health fields must be complete');
  const appointments = await prisma.appointment.findMany({ where: { bookingCode: { startsWith: 'DEMO-' } }, select: {
    id: true, status: true, branchId: true, queueNumber: true, servicePrice: true, createdAt: true,
    scheduleSlot: { select: { id: true, schedule: { select: { branchId: true, roomId: true, workDate: true } } } },
    invoice: { select: { status: true, totalAmount: true, paidAt: true,
      items: { select: { amount: true } }, payments: { select: { method: true, status: true, amount: true } } } },
  } });
  assert(appointments.length > 400, 'Need enough history for revenue charts');
  assert(appointments.every(a => a.scheduleSlot && a.branchId === a.scheduleSlot.schedule.branchId && a.invoice), 'Appointments must match scheduled branch and invoice');
  const queueKeys = new Set();
  for (const a of appointments) {
    if (a.status !== 'HOLD') {
      assert(Number.isSafeInteger(a.queueNumber) && a.queueNumber > 0, 'Booked appointments need a queue number before check-in');
      const schedule = a.scheduleSlot.schedule;
      const key = [a.branchId, schedule.roomId, schedule.workDate.toISOString(), a.queueNumber].join(':');
      assert(!queueKeys.has(key), 'Duplicate queue number in the same room and date');
      queueKeys.add(key);
    }
    assert.equal(Number(a.invoice.totalAmount), Number(a.servicePrice));
    assert.equal(a.invoice.items.reduce((n, i) => n + Number(i.amount), 0), Number(a.invoice.totalAmount));
    const paid = a.invoice.payments.filter(p => p.status === 'SUCCESS').reduce((n, p) => n + Number(p.amount), 0);
    assert.equal(paid, a.invoice.status === 'PAID' ? Number(a.invoice.totalAmount) : 0);
    if (a.scheduleSlot.schedule.workDate > demoDate()) assert(!['COMPLETED', 'CHECKED_IN', 'NO_SHOW'].includes(a.status), 'Future visits must not be completed or checked in');
    assert(a.createdAt <= new Date(), 'No future creation timestamp');
  }
  const branchResults = [];
  for (const branch of await prisma.branch.findMany({ select: { id: true, code: true } })) {
    const today = appointments.filter(a => a.branchId === branch.id && a.scheduleSlot.schedule.workDate.getTime() === demoDate().getTime());
    for (const status of ['HOLD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) assert(today.some(a => a.status === status), branch.code + ' missing ' + status);
    const invoices = await prisma.invoice.findMany({ where: { issuedBranchId: branch.id, status: 'PAID', paidAt: { gte: demoDate(), lt: demoDate(1) } },
      select: { totalAmount: true, payments: { select: { method: true } } } });
    for (const method of ['CASH', 'VIETQR', 'POS_CARD', 'ONLINE']) assert(invoices.some(i => i.payments.some(p => p.method === method)), branch.code + ' missing revenue ' + method);
    branchResults.push({ branch: branch.code, todayAppointments: today.length,
      todayRevenue: invoices.reduce((n, i) => n + Number(i.totalAmount), 0),
      todayPaymentMethods: [...new Set(invoices.flatMap(i => i.payments.map(p => p.method)))] });
  }
  const slots = await prisma.doctorScheduleSlot.findMany({ where: { appointments: { some: { bookingCode: { startsWith: 'DEMO-' } } } },
    select: { occupiedCount: true, capacity: true, appointments: { select: { status: true } } } });
  for (const s of slots) {
    assert(s.occupiedCount <= s.capacity, 'No overbooked seed slot');
    assert.equal(s.occupiedCount, s.appointments.filter(a => !['CANCELLED', 'EXPIRED', 'REFUND_REQUIRED', 'MANUAL_REVIEW'].includes(a.status)).length);
  }
  const pendingDemo = await prisma.outboxEvent.findMany({ where: { aggregateType: 'DEMO', status: 'PENDING' }, select: { availableAt: true } });
  assert.equal(pendingDemo.length, 2);
  assert(pendingDemo.every(e => e.availableAt > new Date()), 'Demo pending events must not be sent by live workers');
  assert.equal(await prisma.outboxEvent.count({ where: { aggregateType: 'DEMO', status: 'FAILED' } }), 2);
  assert(await prisma.auditLog.count() >= 13);
  assert.equal(await prisma.notification.count(), users.length);
  console.log(JSON.stringify({ verified: true, accounts: users.length, profiles: profiles.length,
    demoAppointments: appointments.length, lockedAccounts: 4, branches: branchResults }, null, 2));
} finally { await prisma.$disconnect(); }
