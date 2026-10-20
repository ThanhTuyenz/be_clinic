require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(__dirname, '..', request);
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BookingService } = require('../src/modules/bookings/booking.service.ts');
const { PatientAppointmentsService } = require('../src/modules/appointments/patient-appointments.service.ts');
const { PaymentService } = require('../src/modules/payments/payment.service.ts');
const { PaymentSettlementService } = require('../src/modules/payments/payment-settlement.service.ts');
const { Prisma } = require('@prisma/client');
const { PaymentReconciliationService } = require('../src/modules/payments/payment-reconciliation.service.ts');

function fixture(batch = false) {
  const appointments = [
    { id: 'a', scheduleSlotId: 'slot', status: 'HOLD' },
    ...(batch ? [{ id: 'b', scheduleSlotId: 'slot', status: 'HOLD' }] : []),
  ];
  const payment = { id: 'p', invoiceId: 'i', status: 'PENDING', paidAt: null,
    invoice: { status: 'UNPAID', paidAt: null, payments: [], appointmentId: batch ? null : 'a', bookingOrderId: batch ? 'order' : null } };
  const histories = [];
  let released = 0;
  const tx = {
    voucherUsage: { findMany: async () => [] },
    paymentTransaction: { findFirst: async () => payment, updateMany: async () => { payment.status = 'CANCELLED'; } },
    appointment: {
      findMany: async () => appointments.filter(a => a.status === 'HOLD'),
      updateMany: async ({ where }) => {
        const row = appointments.find(a => a.id === where.id && a.status === where.status);
        if (!row) return { count: 0 };
        row.status = 'CANCELLED';
        return { count: 1 };
      },
    },
    appointmentStatusHistory: { create: async ({ data }) => histories.push(data) },
    invoice: { updateMany: async () => { payment.invoice.status = 'CANCELLED'; } },
    bookingOrder: { updateMany: async () => {} },
    $executeRaw: async () => { released++; return 1; },
  };
  const prisma = { $transaction: async callback => callback(tx) };
  const service = new BookingService(prisma);
  return { service, payment, tx, appointments, histories, released: () => released };
}

test('cancels unpaid single and family bookings, releases every reservation exactly once', async () => {
  for (const batch of [false, true]) {
    const f = fixture(batch);
    const abandoned = [];
    f.service.behaviorTelemetry = { recordAbandonedBooking: async id => {
      assert.equal(f.payment.invoice.status, 'CANCELLED');
      abandoned.push(id);
    } };
    await f.service.cancelUnpaidPayment('123', 'owner');
    await f.service.cancelUnpaidPayment('123', 'owner');
    assert.ok(f.appointments.every(a => a.status === 'CANCELLED'));
    assert.equal(f.released(), batch ? 2 : 1);
    assert.equal(f.histories.length, batch ? 2 : 1);
    assert.ok(f.histories.every(h => h.reason === 'PAYMENT_CANCELLED' && h.actorId === 'owner'));
    assert.equal(f.payment.status, 'CANCELLED');
    assert.equal(f.payment.invoice.status, 'CANCELLED');
    assert.deepEqual(abandoned, batch ? ['a', 'b'] : ['a']);
  }
});

test('does not cancel a paid invoice, successful payment or another paid transaction', async () => {
  for (const markPaid of [f => { f.payment.status = 'SUCCESS'; }, f => { f.payment.invoice.status = 'PAID'; },
    f => { f.payment.invoice.payments = [{ id: 'other-paid-payment' }]; }]) {
    const f = fixture();
    markPaid(f);
    assert.equal(await f.service.cancelUnpaidPayment('123', 'owner'), false);
    assert.equal(f.appointments[0].status, 'HOLD');
    assert.equal(f.released(), 0);
  }
});

test('cancelling an unpaid checkout restores its voucher once and scopes single versus family usage', async () => {
  for (const batch of [false, true]) {
    const f = fixture(batch);
    const usages = [{ id: 'usage', voucherId: 'voucher' }];
    let restored = 0;
    f.tx.voucherUsage = {
      findMany: async ({ where }) => { assert.deepEqual(where, batch ? { bookingOrderId: 'order' } : { appointmentId: 'a' }); return [...usages]; },
      deleteMany: async () => ({ count: usages.splice(0).length }),
    };
    f.tx.voucher = { updateMany: async ({ data }) => { restored += data.usedCount.decrement; return { count: 1 }; } };
    await f.service.cancelUnpaidPayment('123', 'owner');
    await f.service.cancelUnpaidPayment('123', 'owner');
    assert.equal(restored, 1);
  }
});

test('family timeout restores the shared voucher only after its final hold is released', async () => {
  const rows = [{ id: 'a', bookingOrderId: 'order', scheduleSlotId: 'slot-a', status: 'HOLD' }, { id: 'b', bookingOrderId: 'order', scheduleSlotId: 'slot-b', status: 'HOLD' }];
  let restored = 0;
  const usages = [{ id: 'usage', voucherId: 'voucher' }];
  const tx = {
    appointment: {
      findUnique: async ({ where }) => rows.find(row => row.id === where.id),
      updateMany: async ({ where }) => { const row = rows.find(row => row.id === where.id && row.status === 'HOLD'); if (!row) return { count: 0 }; row.status = 'CANCELLED'; return { count: 1 }; },
      count: async () => rows.filter(row => row.status === 'HOLD').length,
    },
    paymentTransaction: { updateMany: async () => {} }, appointmentStatusHistory: { create: async () => {} }, $executeRaw: async () => 1,
    voucherUsage: { findMany: async () => [...usages], deleteMany: async () => ({ count: usages.splice(0).length }) },
    voucher: { updateMany: async () => { restored++; return { count: 1 }; } },
  };
  const service = new BookingService({ $transaction: async fn => fn(tx) });
  await service.expireHold('a'); assert.equal(restored, 0);
  await service.expireHold('b'); assert.equal(restored, 1);
  await service.expireHold('b'); assert.equal(restored, 1);
});

function settlementFixture(statuses) {
  const appointments = statuses.map((status, i) => ({ id: 'a' + i, status, scheduleSlotId: 'slot' + i, queueNumber: i + 1 }));
  const payment = { id: 'payment', status: 'PENDING', invoiceId: 'invoice', providerTransactionId: '123', invoice: { status: 'UNPAID', appointment: null, bookingOrder: { id: 'order', appointments } } };
  const effects = [];
  const tx = {
    paymentTransaction: { findUnique: async () => payment, update: async ({ data }) => { Object.assign(payment, data); effects.push('payment:' + data.status); } },
    invoice: { update: async ({ data }) => { payment.invoice.status = data.status; effects.push('invoice:' + data.status); } },
    bookingOrder: { update: async () => {} },
    appointment: { updateMany: async ({ where }) => { const row = appointments.find(a => a.id === where.id && a.status === where.status); if (!row) return { count: 0 }; row.status = 'CANCELLED'; return { count: 1 }; } },
    appointmentStatusHistory: { create: async () => {} },
    voucherUsage: { findMany: async () => [] },
    outboxEvent: { create: async ({ data }) => effects.push(data.eventType) },
    $executeRaw: async () => { effects.push('release'); return 1; },
  };
  const service = new PaymentSettlementService({ $transaction: async fn => fn(tx) }, {
    confirmSingleAppointment: async (_, id) => { effects.push('confirm'); return { updated: { id, status: 'CONFIRMED' } }; },
    notifyConfirmedAppointment: async () => effects.push('notify'),
  });
  return { service, effects, payment, appointments };
}

test('late family payment never resurrects a cancelled member and refunds the full group without sending confirmations', async () => {
  for (const statuses of [['CANCELLED', 'CANCELLED'], ['HOLD', 'CANCELLED']]) {
    const f = settlementFixture(statuses);
    const result = await f.service.handlePaymentWebhook('PAYOS', { paymentId: 'payment', providerTransactionId: '123', status: 'SUCCESS', payload: {} });
    assert.equal(result.status, 'REFUND_REQUIRED');
    assert.ok(f.appointments.every(a => a.status === 'CANCELLED'));
    assert.equal(f.effects.includes('confirm') || f.effects.includes('notify') || f.effects.includes('invoice:PAID'), false);
    assert.equal(f.effects.filter(e => e === 'release').length, statuses.filter(status => status === 'HOLD').length);
    assert.equal(f.effects.filter(e => e === 'payment.refund.required').length, 1);
    await f.service.handlePaymentWebhook('PAYOS', { paymentId: 'payment', providerTransactionId: 'other-delivery', status: 'SUCCESS', payload: {} });
    assert.equal(f.effects.filter(e => e === 'payment.refund.required').length, 1);
  }
});

test('late single payments never reacquire released capacity, even after timeout without a voucher', async () => {
  const f = settlementFixture(['CANCELLED']);
  const appointment = { ...f.appointments[0], holdExpiresAt: new Date(0), statusHistories: [{ reason: 'PAYMENT_HOLD_TIMEOUT' }] };
  f.payment.invoice.appointment = appointment;
  f.payment.invoice.bookingOrder = null;
  const dto = { paymentId: 'payment', providerTransactionId: '123', status: 'SUCCESS', payload: {} };
  for (let i = 0; i < 2; i++) assert.equal((await f.service.handlePaymentWebhook('PAYOS', dto)).status, 'REFUND_REQUIRED');
  assert.equal(f.effects.filter(e => e === 'payment.refund.required').length, 1);
  assert.equal(f.effects.some(e => ['release', 'confirm', 'notify', 'invoice:PAID'].includes(e)), false);
  assert.equal(appointment.status, 'CANCELLED');
});

test('expiration reconciles with PayOS before releasing a hold and keeps it when the gateway is unavailable', async () => {
  for (const status of ['PAID', 'PENDING', 'EXPIRED', 'CANCELLED', 'UNAVAILABLE']) {
    const calls = [];
    const service = new PaymentReconciliationService({ paymentTransaction: { findFirst: async () => ({
      id: 'payment', status: 'PENDING', invoice: { status: 'UNPAID' },
    }) } }, { syncPayosPaymentStatus: async () => { calls.push('sync'); return status === 'UNAVAILABLE' ? null : { status }; } },
    { expireHold: async () => { calls.push('expire'); return true; } }, { get: key => key === 'PAYOS_RECONCILIATION_ENABLED' ? 'true' : 'test-key' });
    const canExpire = ['PENDING', 'EXPIRED', 'CANCELLED'].includes(status);
    assert.equal(await service.expireHoldIfUnpaid('appointment'), canExpire);
    assert.deepEqual(calls, canExpire ? ['sync', 'expire'] : ['sync']);
  }
});

test('background reconciliation queries only older unpaid transactions and skips fresh checkouts', async () => {
  const started = Date.now();
  let query;
  const synced = [];
  const service = new PaymentReconciliationService({ paymentTransaction: { findMany: async args => {
    query = args; return [{ id: 'payment' }];
  } } }, { syncPayosPaymentStatus: async id => { synced.push(id); } }, {},
  { get: key => key === 'PAYOS_RECONCILIATION_ENABLED' ? 'true' : 'test-key' });
  await service.reconcilePendingPayments();
  assert.equal(query.where.invoice.status, 'UNPAID');
  assert.ok(query.where.createdAt.lte.getTime() <= Date.now() - 30000);
  assert.ok(query.where.createdAt.lte.getTime() >= started - 30000);
  assert.deepEqual(synced, ['payment']);
});

test('family member payment status reads the shared invoice, including pending refunds', async () => {
  const service = new PaymentService({ get: () => undefined }, { appointment: {
    findFirst: async () => ({ id: 'a', status: 'CANCELLED', bookingOrderId: 'order', bookingOrder: {
      invoice: { payments: [{ status: 'REFUND_REQUIRED' }] },
    } }), findMany: async () => [],
  } });
  assert.equal((await service.paymentStatus('a', 'owner')).paymentStatus, 'REFUND_REQUIRED');
});

test('webhook verification rejects invalid signatures and unsupported SDKs without trusting raw data', async () => {
  const service = new PaymentService({ get: () => undefined });
  const { PayOS } = require('@payos/node');
  const { createHmac } = require('node:crypto');
  const key = 'webhook-test-checksum';
  service.payOS = new PayOS({ clientId: 'test', apiKey: 'test', checksumKey: key });
  const data = { amount: 1000, orderCode: 123, reference: 'test' };
  const signature = createHmac('sha256', key).update('amount=1000&orderCode=123&reference=test').digest('hex');
  assert.deepEqual(await service.verifyWebhookData({ code: '00', desc: 'success', success: true, data, signature }), data);
  await assert.rejects(service.verifyWebhookData({ data, signature: 'invalid' }), error => error.getStatus() === 400);
  service.payOS = {};
  await assert.rejects(service.verifyWebhookData({ data }), error => error.getStatus() === 400);
});

test('normal family payment confirms each owned hold once and later failed deliveries cannot undo success', async () => {
  const f = settlementFixture(['HOLD', 'HOLD']);
  const result = await f.service.handlePaymentWebhook('PAYOS', { paymentId: 'payment', providerTransactionId: '123', status: 'SUCCESS', payload: {} });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(f.effects.filter(e => e === 'confirm').length, 2);
  await f.service.handlePaymentWebhook('PAYOS', { paymentId: 'payment', providerTransactionId: 'different', status: 'FAILED', payload: {} });
  assert.equal(f.payment.status, 'SUCCESS');
  assert.equal(f.effects.filter(e => e === 'confirm').length, 2);
});

test('replayed terminal webhooks never rewrite payment, refund requests or confirmations', async () => {
  for (const status of ['SUCCESS', 'REFUNDED', 'REFUND_REQUIRED']) {
    for (const deliveredStatus of ['SUCCESS', 'FAILED']) {
      const f = settlementFixture(['CONFIRMED']);
      f.payment.status = status;
      const result = await f.service.handlePaymentWebhook('PAYOS', {
        paymentId: 'payment', providerTransactionId: '123', status: deliveredStatus, payload: {},
      });
      assert.equal(result.status, status);
      assert.deepEqual(f.effects, []);
    }
  }
});

test('repeated failures write once but a later successful payment can still settle', async () => {
  const f = settlementFixture(['HOLD']);
  const dto = { paymentId: 'payment', providerTransactionId: '123', status: 'FAILED', payload: {} };
  await f.service.handlePaymentWebhook('PAYOS', dto);
  await f.service.handlePaymentWebhook('PAYOS', dto);
  assert.equal(f.effects.filter(e => e === 'payment:FAILED').length, 1);
  await f.service.handlePaymentWebhook('PAYOS', { ...dto, status: 'SUCCESS' });
  assert.equal(f.payment.status, 'SUCCESS');
  assert.equal(f.effects.filter(e => e === 'confirm').length, 1);
});

test('serialization retry discards rolled-back notification snapshots and notifies only after commit', async () => {
  const f = settlementFixture(['HOLD', 'HOLD']);
  const transaction = f.service.prisma.$transaction;
  let attempts = 0;
  f.service.prisma.$transaction = async (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const before = structuredClone(f.payment);
    const effectsBefore = f.effects.length;
    const result = await transaction(fn);
    if (++attempts === 1) {
      Object.assign(f.payment, before);
      f.effects.splice(effectsBefore);
      throw new Prisma.PrismaClientKnownRequestError('concurrent write', { code: 'P2034', clientVersion: 'test' });
    }
    return result;
  };
  const result = await f.service.handlePaymentWebhook('PAYOS', {
    paymentId: 'payment', providerTransactionId: '123', status: 'SUCCESS', payload: {},
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(attempts, 2);
  assert.equal(f.effects.filter(e => e === 'confirm').length, 2);
  assert.equal(f.effects.filter(e => e === 'notify').length, 2);
});

test('persistent conflicts stop after three attempts and unrelated errors are never retried', async () => {
  for (const code of ['P2034', 'P2002']) {
    const f = settlementFixture(['HOLD']);
    let attempts = 0;
    const failure = new Prisma.PrismaClientKnownRequestError('database failure', { code, clientVersion: 'test' });
    f.service.prisma.$transaction = async () => { attempts++; throw failure; };
    await assert.rejects(f.service.handlePaymentWebhook('PAYOS', {
      paymentId: 'payment', providerTransactionId: '123', status: 'SUCCESS', payload: {},
    }), error => error === failure);
    assert.equal(attempts, code === 'P2034' ? 3 : 1);
    assert.deepEqual(f.effects, []);
  }
});

test('PostgreSQL concurrent webhooks commit confirmation or refund events exactly once', {
  skip: process.env.RUN_PAYMENT_DB_TESTS !== '1', timeout: 30000,
}, async () => {
  const { randomUUID } = require('node:crypto');
  const { PrismaClient } = require('@prisma/client');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { AppointmentConfirmationService } = require('../src/modules/appointments/appointment-confirmation.service.ts');
  require('dotenv').config({ path: '.env', quiet: true });
  require('dotenv').config({ path: process.env.ENV_FILE || '.env.development', override: true, quiet: true });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });
  try {
    const profile = await prisma.patientProfile.findFirst({ where: { accountId: { not: null } }, select: { id: true, accountId: true } });
    const branch = await prisma.branch.findFirst({ select: { id: true } });
    assert.ok(profile && branch, 'Requires a seeded development database');
    for (const mode of ['single', 'family', 'refund', 'single-refund']) {
      const single = mode.startsWith('single');
      const refund = mode.includes('refund');
      const appointmentIds = [randomUUID(), ...(single ? [] : [randomUUID()])];
      const paymentId = randomUUID(), invoiceId = randomUUID(), orderId = single ? null : randomUUID();
      try {
        await prisma.$transaction(async tx => {
          if (orderId) await tx.bookingOrder.create({ data: { id: orderId, accountId: profile.accountId, orderCode: `IDEM-${orderId.slice(0, 8)}`, totalAmount: 1000 } });
          for (const id of appointmentIds) await tx.appointment.create({ data: {
            id, patientProfileId: profile.id, branchId: branch.id, bookingOrderId: orderId,
            status: refund ? 'CANCELLED' : 'HOLD', queueNumber: 1,
          } });
          await tx.invoice.create({ data: {
            id: invoiceId, issuedBranchId: branch.id, totalAmount: 1000,
            ...(orderId ? { bookingOrderId: orderId } : { appointmentId: appointmentIds[0] }),
            payments: { create: { id: paymentId, provider: 'PAYOS', providerTransactionId: paymentId,
              idempotencyKey: paymentId, method: 'VIETQR', amount: 1000 } },
          } });
        });
        const confirmation = new AppointmentConfirmationService({ get: () => 'idempotency-test-secret' });
        let notifications = 0, reads = 0, conflicts = 0;
        let unblock;
        const bothRead = new Promise(resolve => { unblock = resolve; });
        const client = { $transaction: (fn, options) => prisma.$transaction(async tx => {
          const paymentTransaction = {
            ...tx.paymentTransaction,
            findUnique: async args => {
              const payment = await tx.paymentTransaction.findUnique(args);
              if (++reads <= 2) { if (reads === 2) unblock(); await bothRead; }
              return payment;
            },
          };
          // Test events never enter the live mail/refund queues.
          const outboxEvent = { create: args => tx.outboxEvent.create({ ...args, data: {
            ...args.data, status: 'PUBLISHED', publishedAt: new Date(),
          } }) };
          return fn(new Proxy(tx, { get: (target, key) => {
            if (key === 'paymentTransaction') return paymentTransaction;
            if (key === 'outboxEvent') return outboxEvent;
            return Reflect.get(target, key);
          } }));
        }, options).catch(error => { if (error.code === 'P2034') conflicts++; throw error; }) };
        const service = new PaymentSettlementService(client, {
          confirmSingleAppointment: (...args) => confirmation.confirmSingleAppointment(...args),
          notifyConfirmedAppointment: async () => { notifications++; },
        });
        const dto = { paymentId, providerTransactionId: paymentId, status: 'SUCCESS', payload: {} };
        const results = await Promise.all([service.handlePaymentWebhook('PAYOS', dto), service.handlePaymentWebhook('PAYOS', dto)]);
        assert.ok(conflicts >= 1, 'Both first deliveries must overlap and exercise a real serialization conflict');
        assert.ok(results.every(result => result.status === (refund ? 'REFUND_REQUIRED' : 'SUCCESS')));
        await service.handlePaymentWebhook('PAYOS', dto);
        await service.handlePaymentWebhook('PAYOS', { ...dto, status: 'FAILED' });
        const count = appointmentIds.length;
        assert.equal(notifications, refund ? 0 : count);
        assert.equal(await prisma.appointmentStatusHistory.count({ where: { appointmentId: { in: appointmentIds }, toStatus: 'CONFIRMED' } }), refund ? 0 : count);
        assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: { in: [...appointmentIds, paymentId] } } }), refund ? 1 : count);
        assert.equal(await prisma.appointmentQrToken.count({ where: { appointmentId: { in: appointmentIds } } }), refund ? 0 : count);
      } finally {
        await prisma.$transaction(async tx => {
          await tx.outboxEvent.deleteMany({ where: { aggregateId: { in: [...appointmentIds, paymentId] } } });
          await tx.appointmentQrToken.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
          await tx.paymentTransaction.deleteMany({ where: { id: paymentId } });
          await tx.invoice.deleteMany({ where: { id: invoiceId } });
          await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
          if (orderId) await tx.bookingOrder.deleteMany({ where: { id: orderId } });
        });
      }
    }
  } finally { await prisma.$disconnect(); }
});

test('retrying PayOS returns the persisted link without creating another provider order', async () => {
  const service = new PaymentService({ get: () => undefined }, { appointment: { findFirst: async () => ({
    id: 'appointment', holdExpiresAt: new Date(Date.now() + 600000),
    invoice: { status: 'UNPAID', payments: [{ status: 'PENDING', provider: 'PAYOS', providerTransactionId: '123', amount: 1000,
      rawPayload: { checkoutUrl: 'https://payment.example/existing', paymentLinkId: 'link', qrCode: 'actual-qr' } }] },
  }) } });
  service.payOS = { paymentRequests: { create: async () => assert.fail('must reuse existing PayOS link') } };
  const result = await service.createPaymentUrl('appointment', 200000, undefined, 'owner');
  assert.equal(result.checkoutUrl, 'https://payment.example/existing');
  assert.equal(result.orderCode, 123);
  assert.equal(result.amount, 1000);
});

test('does not release capacity if the conditional HOLD transition loses a race', async () => {
  const f = fixture();
  f.tx.appointment.updateMany = async () => ({ count: 0 });
  await f.service.cancelUnpaidPayment('123', 'owner');
  assert.equal(f.released(), 0);
  assert.equal(f.histories.length, 0);
});

test('expired holds release capacity and fail pending payments exactly once', async () => {
  let status = 'HOLD';
  const calls = [];
  const tx = {
    voucherUsage: { findMany: async () => [] },
    appointment: {
      findUnique: async () => ({ id: 'a', scheduleSlotId: 'slot' }),
      updateMany: async ({ where }) => {
        assert.equal(where.status, 'HOLD');
        assert.ok(where.holdExpiresAt.lte instanceof Date);
        if (status !== 'HOLD') return { count: 0 };
        status = 'CANCELLED';
        return { count: 1 };
      },
    },
    $executeRaw: async () => { calls.push('release'); return 1; },
    paymentTransaction: { updateMany: async args => {
      assert.deepEqual(args, { where: { invoice: { appointmentId: 'a' }, status: 'PENDING' }, data: { status: 'FAILED' } });
      calls.push('payment');
    } },
    appointmentStatusHistory: { create: async ({ data }) => {
      assert.equal(data.reason, 'PAYMENT_HOLD_TIMEOUT');
      calls.push('history');
    } },
  };
  const service = new BookingService({ $transaction: callback => callback(tx) });
  service.behaviorTelemetry = { recordAbandonedBooking: async id => {
    assert.equal(status, 'CANCELLED');
    assert.equal(id, 'a');
    calls.push('dropoff');
  } };
  assert.equal(await service.expireHold('a'), true);
  assert.equal(await service.expireHold('a'), false);
  assert.deepEqual(calls, ['release', 'payment', 'history', 'dropoff']);
});

test('missing or unchanged holds never release capacity or update payments', async () => {
  for (const appointment of [null, { id: 'a', scheduleSlotId: 'slot' }]) {
    const tx = {
      appointment: { findUnique: async () => appointment, updateMany: async () => ({ count: 0 }) },
      $executeRaw: async () => assert.fail('must not release capacity'),
      paymentTransaction: { updateMany: async () => assert.fail('must not fail payments') },
    };
    const service = new BookingService({ $transaction: callback => callback(tx) });
    assert.equal(await service.expireHold('a'), false);
  }
});

test('requires ownership before contacting PayOS, including numeric order codes', async () => {
  const service = new PaymentService({ get: () => undefined }, { paymentTransaction: { findFirst: async () => null } });
  service.payOS = { paymentRequests: { get: async () => { throw new Error('must not contact provider'); } } };
  await assert.rejects(service.syncPayosPaymentStatus('123', 'stranger'), error => error.getStatus() === 404);
});

test('only verified PayOS cancellation cancels holds; PAID follows confirmation', async () => {
  for (const status of ['CANCELLED', 'PENDING', 'PAID']) {
    const calls = [];
    const service = new PaymentService({ get: () => undefined }, { paymentTransaction: { findFirst: async () => ({ id: 'p' }) } },
      { cancelUnpaidPayment: async (...args) => calls.push(['cancel', ...args]) });
    service.payOS = { paymentRequests: { get: async () => ({ status }) } };
    service.handleSuccessfulPayment = async () => calls.push(['confirm']);
    await service.syncPayosPaymentStatus('123', 'owner');
    assert.deepEqual(calls, status === 'CANCELLED' ? [['cancel', '123', 'owner']] : status === 'PAID' ? [['confirm']] : []);
  }
});

test('appointment history excludes abandoned holds while retaining previously confirmed cancellations', async () => {
  let query;
  const service = new PatientAppointmentsService({ appointment: { findMany: async args => { query = args; return []; } } });
  await service.myAppointments('owner');
  assert.deepEqual(query.where.NOT, { status: 'CANCELLED', statusHistories: {
    some: { fromStatus: 'HOLD', toStatus: 'CANCELLED' },
    none: { OR: [{ fromStatus: 'CONFIRMED' }, { toStatus: 'CONFIRMED' }] },
  } });
  assert.equal(query.take, 100);
});
