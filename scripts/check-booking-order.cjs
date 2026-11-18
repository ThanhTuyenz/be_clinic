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
      branchBookingMethodId: methods[code].id,
      branchBookingMethods: { create: { branchBookingMethodId: methods[code].id } },
      receptionSchedules: { create: { branchId: branch.id, dayOfWeek: date.getUTCDay(), sessions: ['MORNING'] } },
    } });
    const specialtyPackage = await createPackage('SPECIALTY_EXAM', specialty.id, 200000);
    const healthPackage = await createPackage('HEALTH_PACKAGE', null, 300000);
    const receptionSlot = await tx.packageReceptionSlot.create({ data: { branchId: branch.id, servicePackageId: healthPackage.id, date, startTime: time('08:00'), endTime: time('08:30'), capacity: 100 } });
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
    throw rollback;
  }, { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => { if (error !== rollback) throw error; });
  console.log(`PASSED ${passed} database regression scenarios. All test records rolled back.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
