// Real database regression checks. All fixtures and service writes roll back.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const dotenv = require('dotenv');
const { PrismaClient, Prisma } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, process.env.ENV_FILE || '.env.development'), override: true });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
const cache = new Map();
function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  cache.set(filename, mod.exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true },
  }).outputText;
  const localRequire = request => {
    if (!request.startsWith('.') && !request.startsWith('src/')) return require(request);
    const target = request.startsWith('src/') ? path.join(root, request + '.ts')
      : path.resolve(path.dirname(filename), request.replace(/\.js$/, '.ts'));
    // Constructors get test doubles for network adapters; business functions run unchanged.
    if (target.includes(path.sep + 'infrastructure' + path.sep)
        || /(?:recommendation|notification)\.service\.ts$/.test(target)) {
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : class {} });
    }
    return load(target);
  };
  new Function('require', 'module', 'exports', source)(localRequire, mod, mod.exports);
  cache.set(filename, mod.exports);
  return mod.exports;
}

async function main() {
  const { AppointmentsService } = load('src/modules/appointments/appointments.service.ts');
  const { ReceptionSummaryService } = load('src/modules/admin-dashboard/reception-summary.service.ts');
  const { AdminDashboardService } = load('src/modules/admin-dashboard/admin-dashboard.service.ts');
  const { SystemCatalogService } = load('src/modules/catalog/system-catalog.service.ts');
  const { PackageReceptionSlotsService } = load('src/modules/bookings/package-reception-slots.service.ts');
  const { BookingFlowService } = load('src/modules/bookings/booking-flow.service.ts');
  const { BookingService } = load('src/modules/bookings/booking.service.ts');
  const { ReceptionBookingService } = load('src/modules/bookings/reception-booking.service.ts');
  const { VouchersService } = load('src/modules/vouchers/vouchers.service.ts');
  const { PatientDirectoryService } = load('src/modules/patients/patient-directory.service.ts');
  const { PatientAppointmentsService } = load('src/modules/appointments/patient-appointments.service.ts');
  const { AppointmentConfirmationService } = load('src/modules/appointments/appointment-confirmation.service.ts');
  const { PaymentSettlementService } = load('src/modules/payments/payment-settlement.service.ts');
  const { CounterPaymentsService } = load('src/modules/payments/counter-payments.service.ts');
  const { PaymentService } = load('src/modules/payments/payment.service.ts');
  const { getAppointmentRefundQuote } = load('src/modules/payments/appointment-refund.ts');
  const { allocateAppointmentPayment } = load('src/modules/payments/order-payment-allocation.ts');
  const rollback = new Error('ROLLBACK_REGRESSION_FIXTURES');
  let passed = 0;
  const verify = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
  await db.$transaction(async tx => {
    let savepoint = 0;
    const client = new Proxy(tx, { get(target, key) {
      if (key === '$transaction') return async callback => {
        const name = 'booking_regression_' + (++savepoint);
        await tx.$executeRawUnsafe('SAVEPOINT ' + name);
        try {
          const result = await callback(tx);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name);
          return result;
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ' + name);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name);
          throw error;
        }
      };
      return Reflect.get(target, key);
    } });
    const tag = randomUUID().slice(0, 16);
    const branch = await tx.branch.create({ data: {
      code: 'TEST-' + tag, slug: 'test-' + tag, name: 'Regression fixture',
      address: 'Test', province: 'Test', district: 'Test', ward: 'Test', phoneNumber: '0900000000',
      imageUrl: 'https://example.test/branch.png', openTime: '07:00', closeTime: '17:00',
    } });
    const account = await tx.user.create({ data: { email: tag + '@example.test', fullName: 'Regression fixture' } });
    const staff = await tx.user.create({ data: { role: 'RECEPTIONIST', branchId: branch.id } });
    const doctorUser = await tx.user.create({ data: { role: 'DOCTOR', branchId: branch.id } });
    const specialty = await tx.specialty.create({ data: {
      name: 'Test ' + tag, slug: 'test-' + tag, description: 'Regression fixture', iconUrl: 'https://example.test/icon.png',
    } });
    await tx.branchSpecialty.create({ data: { branchId: branch.id, specialtyId: specialty.id } });
    const doctor = await tx.doctor.create({ data: {
      userId: doctorUser.id, licenseNumber: 'TEST-' + tag, academicRank: 'BS', biography: 'Regression fixture',
      avatarUrl: 'https://example.test/doctor.png', consultationFee: 150000,
      specialties: { create: { specialtyId: specialty.id, isPrimary: true } },
    } });
    const methods = {};
    for (const code of ['CONSULTATION', 'SPECIALTY_EXAM', 'HEALTH_PACKAGE']) {
      const method = await tx.bookingMethod.upsert({ where: { code }, update: { isActive: true }, create: { code, name: code, description: 'Regression fixture' } });
      methods[code] = await tx.branchBookingMethod.create({ data: { branchId: branch.id, bookingMethodId: method.id } });
    }
    const date = new Date(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 2);
    const time = value => new Date('1970-01-01T' + value + ':00.000Z');
    const schedule = await tx.doctorSchedule.create({ data: { doctorId: doctor.id, branchId: branch.id, workDate: date, startTime: time('08:00'), endTime: time('10:00'), capacityPerSlot: 100 } });
    const slots = [];
    for (const [start, end] of [['08:00', '08:30'], ['08:30', '09:00'], ['09:00', '09:30']]) {
      slots.push(await tx.doctorScheduleSlot.create({ data: { scheduleId: schedule.id, startTime: time(start), endTime: time(end), capacity: 100 } }));
    }
    const createPackage = (code, specialtyId, price) => tx.servicePackage.create({ data: {
      code: code + '-' + tag, slug: code.toLowerCase() + '-' + tag, name: 'Regression fixture',
      description: 'Regression fixture', imageUrl: 'https://example.test/package.png', specialtyId, price,
      bookingMethodId: methods[code].bookingMethodId,
      branches: { create: { branchId: branch.id } },
      receptionSchedules: { create: { branchId: branch.id, dayOfWeek: date.getUTCDay(), sessions: ['MORNING'] } },
    } });
    const specialtyPackage = await createPackage('SPECIALTY_EXAM', specialty.id, 200000);
    const healthPackage = await createPackage('HEALTH_PACKAGE', null, 300000);
    const sourceSchedule = await tx.packageReceptionTime.findUniqueOrThrow({ where: { servicePackageId_branchId_dayOfWeek: { servicePackageId: healthPackage.id, branchId: branch.id, dayOfWeek: date.getUTCDay() } } });
    const receptionSlot = await tx.packageReceptionSlot.create({ data: { receptionScheduleId: sourceSchedule.id, date, startTime: time('08:00'), endTime: time('08:30'), capacity: 100 } });
    const profile = name => tx.patientProfile.create({ data: { accountId: account.id, fullName: name, phoneNumber: '0900000000', dateOfBirth: new Date('2000-01-01'), gender: 'MALE' } });
    const config = { get: key => key === 'auth.secret' ? 'regression-only-secret' : key === 'PAYOS_TEST_AMOUNT' ? '0' : undefined, getOrThrow: () => ({ holdTtlMs: 600000 }) };
    const booking = new BookingService(client, config, new VouchersService(client), { attribution: async () => ({}) }, { recordAbandonedBooking: async () => undefined });
    const confirmation = new AppointmentConfirmationService(config, { emitAppointmentBooked() {} }, { createNotification: async () => undefined }, client);
    let notifications = 0;
    confirmation.notifyConfirmedAppointment = async () => { notifications++; };
    const settlement = new PaymentSettlementService(client, confirmation);
    const counter = new CounterPaymentsService(client, confirmation);
    const patient = new PatientAppointmentsService(client, new Proxy({}, { get: () => async () => undefined }));
    const reception = new ReceptionBookingService(client, { emitAppointmentBooked() {} }, new PatientDirectoryService(client));
    const payments = new PaymentService(config, client, booking, settlement);
    let gatewayCalls = 0;
    payments.payOS = { paymentRequests: { create: async data => { gatewayCalls++; return { ...data, paymentLinkId: 'test-link', checkoutUrl: 'https://example.test/pay', qrCode: 'test-qr' }; } } };
    const single = async (name, slot = slots[0]) => {
      const person = await profile(name);
      return booking.checkout(account.id, { patientProfileId: person.id, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: specialtyPackage.id, scheduleSlotId: slot.id });
    };
    const family = async name => {
      const people = [await profile(name + ' A'), await profile(name + ' B')];
      return booking.batchCheckout(account.id, { groupType: 'FAMILY', items: people.map((person, index) => ({ patientProfileId: person.id, bookingMethodCode: 'SPECIALTY_EXAM', servicePackageId: specialtyPackage.id, scheduleSlotId: slots[index].id })) });
    };
    const pay = result => settlement.handlePaymentWebhook('TEST', { paymentId: result.paymentId, providerTransactionId: 'test-' + result.paymentId, status: 'SUCCESS', payload: { test: true } });

    await verify('single specialty checkout has one order and one order invoice', async () => {
      const result = await single('Single');
      const order = await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId }, include: { appointments: true, invoice: { include: { payments: true } } } });
      assert.equal(order.groupType, 'SINGLE'); assert.equal(order.appointments.length, 1);
      assert.equal(order.appointments[0].id, result.appointmentId); assert.equal(order.invoice.id, result.invoiceId);
      assert.equal(order.invoice.payments.length, 1); assert.equal(Number(order.totalAmount), result.totalAmount);
      assert.equal('appointmentId' in order.invoice, false);
      const list = await patient.myAppointments(account.id);
      assert.equal(list.find(item => item.id === result.appointmentId).invoiceStatus, 'UNPAID');
      const status = await payments.paymentStatus(result.appointmentId, account.id);
      assert.equal(status.bookingOrderId, result.bookingOrderId);
      const link = await payments.createPaymentUrl(result.appointmentId, result.totalAmount, undefined, account.id);
      assert.equal(link.amount, result.totalAmount);
      await payments.createPaymentUrl(result.bookingOrderId, result.totalAmount, undefined, account.id);
      assert.equal(gatewayCalls, 1);
      const other = await tx.user.create({ data: {} });
      await assert.rejects(() => payments.createPaymentUrl(result.appointmentId, result.totalAmount, undefined, other.id), /hóa đơn/);
    });
    await verify('health package checkout uses the same order model', async () => {
      const person = await profile('Health');
      const result = await booking.checkout(account.id, { patientProfileId: person.id, bookingMethodCode: 'HEALTH_PACKAGE', servicePackageId: healthPackage.id, receptionSlotId: receptionSlot.id });
      const order = await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId }, include: { invoice: true, appointments: true } });
      assert.equal(order.appointments[0].scheduleSlotId, null); assert.equal(order.invoice.id, result.invoiceId);
    });
    await verify('family payment confirms all members once', async () => {
      const result = await family('Family'); assert.equal(result.totalAmount, 410000);
      const first = await pay(result); const notified = notifications;
      await pay(result); assert.equal(notifications, notified);
      assert.equal(first.appointments.length, 2);
      const order = await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId }, include: { appointments: true, invoice: true } });
      assert.equal(order.status, 'PAID'); assert.equal(order.invoice.status, 'PAID');
      assert.ok(order.appointments.every(item => item.status === 'CONFIRMED'));
      const amounts = order.appointments.map(item => allocateAppointmentPayment(result.totalAmount, item.id, order.appointments));
      assert.equal(amounts.reduce((sum, value) => sum + value, 0), result.totalAmount);
      const member = order.appointments[0];
      const quote = await getAppointmentRefundQuote(tx, { appointmentId: member.id, bookingOrderId: order.id, reason: 'test' });
      assert.equal(quote.paidAmount, amounts[0]);
      const cancelled = await patient.cancelMyAppointment(account.id, member.id, { reason: 'Có việc đột xuất', expectedRefundQuote: quote.quoteKey });
      assert.equal(cancelled.refund.refundAmount, Math.floor(amounts[0] * 0.95));
      const sibling = await tx.appointment.findUniqueOrThrow({ where: { id: order.appointments[1].id } });
      assert.equal(sibling.status, 'CONFIRMED');
    });
    await verify('single settlement and reschedule retain order and invoice', async () => {
      const result = await single('Reschedule'); const paid = await pay(result);
      assert.equal(typeof paid.qrToken, 'string');
      await patient.rescheduleMyAppointment(account.id, result.appointmentId, { newScheduleSlotId: slots[2].id });
      const appt = await tx.appointment.findUniqueOrThrow({ where: { id: result.appointmentId }, include: { bookingOrder: { include: { invoice: true } } } });
      assert.equal(appt.scheduleSlotId, slots[2].id); assert.equal(appt.bookingOrderId, result.bookingOrderId); assert.equal(appt.bookingOrder.invoice.id, result.invoiceId);
    });
    await verify('expiry cancels order and late money requires refund', async () => {
      const result = await single('Expire');
      await tx.appointment.update({ where: { id: result.appointmentId }, data: { holdExpiresAt: new Date(0) } });
      assert.equal(await booking.expireHold(result.appointmentId), true);
      const order = await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId }, include: { invoice: true } });
      assert.equal(order.status, 'CANCELLED'); assert.equal(order.invoice.status, 'CANCELLED');
      const late = await pay(result); assert.equal(late.status, 'REFUND_REQUIRED');
      assert.equal((await tx.appointment.findUniqueOrThrow({ where: { id: result.appointmentId } })).status, 'CANCELLED');
    });
    await verify('unpaid family cancellation is atomic and cancels the whole order', async () => {
      const result = await family('Partial unpaid');
      await assert.rejects(() => patient.cancelMyAppointment(account.id, result.appointments[0].appointmentId, { reason: 'Có việc đột xuất' }), /hủy toàn bộ/);
      assert.equal((await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId } })).status, 'UNPAID');
      assert.equal((await tx.appointment.findUniqueOrThrow({ where: { id: result.appointments[0].appointmentId } })).status, 'HOLD');
      await booking.cancelUnpaidPayment(result.paymentId, account.id);
      const order = await tx.bookingOrder.findUniqueOrThrow({ where: { id: result.bookingOrderId }, include: { invoice: true } });
      assert.equal(order.status, 'CANCELLED'); assert.equal(order.invoice.status, 'CANCELLED');
    });
    await verify('counter booking creates an order and counter payment confirms it', async () => {
      const person = await profile('Counter');
      const created = await reception.createReception(staff.id, { specialtyId: specialty.id, servicePackageId: specialtyPackage.id, doctorId: doctor.id, scheduleSlotId: slots[0].id, branchId: branch.id, appointmentDate: date.toISOString().slice(0, 10), startTime: '08:00', patient: { id: person.id } });
      const appointment = created.appointment || created;
      const id = appointment.id;
      assert.ok(id);
      await assert.rejects(() => counter.recordPayment(staff.id, id, { method: 'cash', amount: 1 }), /tổng tiền/);
      const paid = await counter.recordPayment(staff.id, id, { method: 'cash', amount: 200000 });
      assert.equal(paid.appointment.status, 'CONFIRMED');
      assert.equal((await tx.bookingOrder.findUniqueOrThrow({ where: { id: paid.appointment.bookingOrderId } })).status, 'PAID');
      const history = await counter.myCollections(staff.id, { page: 1, pageSize: 10 });
      assert.ok(history.items.some(item => item.invoiceId === paid.payment.invoiceId && item.patientName === person.fullName));
    });
    await verify('counter payment of a family order confirms every member', async () => {
      const result = await family('Family counter');
      await counter.recordPayment(staff.id, result.appointments[0].appointmentId, { method: 'cash', amount: result.totalAmount });
      const members = await tx.appointment.findMany({ where: { bookingOrderId: result.bookingOrderId } });
      assert.ok(members.every(item => item.status === 'CONFIRMED'));
    });
    await verify('package method is shared across branches and cannot be changed by branch deployment', async () => {
      const chain = await tx.user.create({ data: { role: 'CHAIN_MANAGER' } });
      const branch2 = await tx.branch.create({ data: { ...branch, id: undefined, code: 'TEST-B-' + tag, slug: 'test-b-' + tag } });
      await tx.branchBookingMethod.create({ data: { branchId: branch2.id, bookingMethodId: methods.HEALTH_PACKAGE.bookingMethodId } });
      const catalog = new SystemCatalogService(client, { isEnabled: () => false }, {});
      const pkg = await catalog.create(chain.id, 'service-packages', {
        name: 'Single method fixture', code: 'SINGLE-' + tag, slug: 'single-' + tag,
        price: 100000, bookingMethodId: methods.HEALTH_PACKAGE.bookingMethodId,
        branchIds: [branch.id, branch2.id],
      });
      assert.equal(pkg.bookingMethodId, methods.HEALTH_PACKAGE.bookingMethodId);
      assert.equal(pkg.branches.length, 2);
      await catalog.setBranchPackage(chain.id, pkg.id, { branchId: branch2.id, isDeployed: true, bookingMethodId: methods.SPECIALTY_EXAM.bookingMethodId, schedules: [] });
      assert.equal((await tx.servicePackage.findUniqueOrThrow({ where: { id: pkg.id } })).bookingMethodId, methods.HEALTH_PACKAGE.bookingMethodId);
      await catalog.setBranchPackage(chain.id, pkg.id, { branchId: branch2.id, isDeployed: false, schedules: [] });
      assert.equal(await tx.packageBranch.count({ where: { servicePackageId: pkg.id } }), 1);
      await assert.rejects(() => catalog.create(chain.id, 'service-packages', {
        name: 'Invalid method', code: 'INVALID-' + tag, slug: 'invalid-' + tag,
        bookingMethodId: methods.CONSULTATION.bookingMethodId, branchIds: [branch.id],
      }), /hình thức/);
    });
    await verify('shared package seed stays one package and one method across branches', async () => {
      const seedSource = fs.readFileSync(path.join(root, 'prisma/seed.mjs'), 'utf8');
      const functionSource = seedSource.slice(seedSource.indexOf('async function upsertSharedSeedPackage('), seedSource.indexOf('\nconst DAY ='));
      const upsertSeed = new Function(functionSource + '; return upsertSharedSeedPackage;')();
      const create = {
        code: 'SEED-' + tag, slug: 'seed-' + tag, name: 'Seed fixture', imageUrl: '', description: '',
        price: 100000, bookingMethodId: methods.HEALTH_PACKAGE.bookingMethodId,
        branches: { create: { branchId: branch.id } },
        receptionSchedules: { create: [{ branchId: branch.id, dayOfWeek: 1, sessions: ['MORNING'] }] },
      };
      const input = { where: { code: create.code }, create, update: { bookingMethodId: create.bookingMethodId } };
      const first = await upsertSeed(client, input);
      const second = await upsertSeed(client, input);
      assert.equal(first.id, second.id);
      assert.equal(await tx.packageBranch.count({ where: { servicePackageId: first.id } }), 1);
      const branch2 = await tx.branch.findFirstOrThrow({ where: { code: 'TEST-B-' + tag } });
      const third = await upsertSeed(client, { ...input, create: { ...create, branches: { create: { branchId: branch2.id } }, receptionSchedules: { create: [{ branchId: branch2.id, dayOfWeek: 1, sessions: ['MORNING'] }] } } });
      assert.equal(first.id, third.id);
      assert.equal(await tx.packageBranch.count({ where: { servicePackageId: first.id } }), 2);
    });
    await verify('derived branches preserve staff isolation and patient API responses', async () => {
      const branch2 = await tx.branch.findFirstOrThrow({ where: { code: 'TEST-B-' + tag } });
      const otherSource = await tx.packageReceptionTime.create({ data: { branchId: branch2.id, servicePackageId: healthPackage.id, dayOfWeek: date.getUTCDay(), sessions: ['MORNING'] } });
      const otherSlot = await tx.packageReceptionSlot.create({ data: { receptionScheduleId: otherSource.id, date, startTime: time('08:00'), endTime: time('08:30'), capacity: 100 } });
      const person = await profile('Branch isolation');
      const order = await tx.bookingOrder.create({ data: { accountId: account.id, orderCode: 'SCOPE-' + tag, totalAmount: 300000 } });
      const otherAppointment = await tx.appointment.create({ data: { bookingOrderId: order.id, patientProfileId: person.id, bookingMethodId: methods.HEALTH_PACKAGE.bookingMethodId, receptionSlotId: otherSlot.id, servicePackageId: healthPackage.id, servicePrice: 300000 } });
      const appointments = new AppointmentsService(client, {}, {}, {});
      const visible = await appointments.receptionAppointments(staff.id, {});
      assert.ok(visible.appointments.length > 0);
      assert.ok(visible.appointments.every(row => row.branch.id === branch.id));
      assert.ok(!visible.appointments.some(row => row.id === otherAppointment.id));
      await assert.rejects(() => appointments.updateStatus(staff.id, otherAppointment.id, { status: 'CHECKED_IN' }), /chi nhánh/);
      const mine = await patient.myAppointments(account.id);
      assert.ok(mine.some(row => row.id === otherAppointment.id && row.branchId === branch2.id));
      const summary = new ReceptionSummaryService(client);
      await summary.getReceptionSummary(staff.id, { date: date.toISOString().slice(0,10), branchId: branch.id });
    });
    await verify('dashboard filters and branch comparison use slot joins', async () => {
      const chain = await tx.user.findFirstOrThrow({ where: { role: 'CHAIN_MANAGER' } });
      const dashboard = new AdminDashboardService(client, { isEnabled: () => false }, { get: () => undefined });
      await dashboard.overview(chain.id, { branchId: branch.id });
      await dashboard.compareBranches(chain.id, { timeFilter: 'month' });
      await dashboard.getDemandMetrics(chain.id, { branchId: branch.id, timeFilter: 'month' });
    });
    await verify('editing and disabling reception schedules retain IDs and existing slots', async () => {
      const chain = await tx.user.findFirstOrThrow({ where: { role: 'CHAIN_MANAGER' } });
      const catalog = new SystemCatalogService(client, { isEnabled: () => false }, {});
      const beforeIds = await tx.packageReceptionSlot.findMany({ where: { receptionScheduleId: sourceSchedule.id }, select: { id: true }, orderBy: { id: 'asc' } });
      await catalog.setReceptionSchedules(chain.id, healthPackage.id, { branchId: branch.id, schedules: [] });
      assert.equal((await tx.packageReceptionTime.findUniqueOrThrow({ where: { id: sourceSchedule.id } })).isActive, false);
      const flow = new BookingFlowService(client);
      const hidden = await flow.getBookingSlots({ bookingMethodCode: 'HEALTH_PACKAGE', branchId: branch.id, servicePackageId: healthPackage.id, date: date.toISOString().slice(0,10) });
      assert.equal(hidden.slots.length, 0);
      await catalog.setReceptionSchedules(chain.id, healthPackage.id, { branchId: branch.id, schedules: [{ dayOfWeek: date.getUTCDay(), sessions: ['MORNING'] }] });
      const source = await tx.packageReceptionTime.findUniqueOrThrow({ where: { servicePackageId_branchId_dayOfWeek: { servicePackageId: healthPackage.id, branchId: branch.id, dayOfWeek: date.getUTCDay() } } });
      assert.equal(source.id, sourceSchedule.id);
      assert.equal(source.isActive, true);
      assert.deepEqual(await tx.packageReceptionSlot.findMany({ where: { receptionScheduleId: sourceSchedule.id }, select: { id: true }, orderBy: { id: 'asc' } }), beforeIds);
    });
    await verify('slot generation, branch scope and capacity operate through the source schedule', async () => {
      const manager = await tx.user.create({ data: { role: 'BRANCH_MANAGER', branchId: branch.id } });
      const slotService = new PackageReceptionSlotsService(client);
      const input = { servicePackageId: healthPackage.id, from: date.toISOString().slice(0,10), to: date.toISOString().slice(0,10), startTime: '09:00', endTime: '10:00', slotDurationMin: 30, capacity: 1 };
      const generated = await slotService.create(manager.id, input);
      assert.equal(generated.count, 2);
      assert.equal((await slotService.create(manager.id, input)).count, 0);
      const listed = await slotService.list(manager.id, healthPackage.id);
      const target = listed.find(row => row.date.getTime() === date.getTime() && row.startTime.getTime() === time('09:00').getTime());
      assert.ok(target);
      assert.equal(target.servicePackageId, healthPackage.id);
      assert.equal(target.receptionScheduleId, sourceSchedule.id);
      const personForCapacity = await profile('Reception capacity B');
      const bookingInput = { bookingMethodCode: 'HEALTH_PACKAGE', servicePackageId: healthPackage.id, receptionSlotId: target.id };
      await booking.checkout(account.id, { ...bookingInput, patientProfileId: (await profile('Reception capacity A')).id });
      await assert.rejects(() => booking.checkout(account.id, { ...bookingInput, patientProfileId: personForCapacity.id }), /hết chỗ/);
      assert.equal((await tx.packageReceptionSlot.findUniqueOrThrow({ where: { id: target.id } })).occupiedCount, 1);
      const branch2 = await tx.branch.findFirstOrThrow({ where: { code: 'TEST-B-' + tag } });
      const manager2 = await tx.user.create({ data: { role: 'BRANCH_MANAGER', branchId: branch2.id } });
      await assert.rejects(() => slotService.update(manager2.id, target.id, { capacity: 5 }), /chi nhánh/);
    });
    throw rollback;
  }, { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => { if (error !== rollback) throw error; });
  console.log(`PASSED ${passed} database regression scenarios. All test records rolled back.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
