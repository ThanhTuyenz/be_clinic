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
const { AppointmentsService } = require('../src/modules/appointments/appointments.service.ts');
const { reminderSlotWindows, parseAppointmentDate } = require('../src/modules/appointments/helpers/appointment.helper.ts');
const { assertRescheduleDestination } = require('../src/modules/appointments/helpers/appointment.helper.ts');
const { requestAppointmentRefund } = require('../src/modules/payments/appointment-refund.ts');
const { AppointmentReminderTask } = require('../src/modules/appointments/appointment-reminder.task.ts');
const { PaymentSettlementService } = require('../src/modules/payments/payment-settlement.service.ts');

const actor = (role = 'CHAIN_MANAGER', branches = []) => ({ id: 'actor', role, branchAssignments: branches.map(branchId => ({ branchId })), doctor: role === 'DOCTOR' ? { id: 'doctor' } : null });

test('date and search filters are combined and branch scope cannot be overwritten', async () => {
  let query;
  const service = new AppointmentsService({
    user: { findUnique: async () => actor('RECEPTIONIST', ['east']) },
    appointment: { findMany: async args => { query = args; return []; } },
  });
  await service.receptionAppointments('actor', { from: '2026-10-18', to: '2026-10-20', q: 'test', status: 'confirmed' });
  const conditions = query.where.AND;
  assert.deepEqual(conditions[0], { branchId: { in: ['east'] } });
  assert.deepEqual(conditions[1], { status: { in: ['CONFIRMED', 'CHECKED_IN'] } });
  assert.equal(conditions[2].OR[0].scheduleSlot.schedule.workDate.lt.toISOString(), '2026-10-21T00:00:00.000Z');
  assert.equal(conditions[3].OR[0].bookingCode.contains, 'test');
});

test('impossible calendar dates and empty branch assignments fail before loading appointments', async () => {
  assert.throws(() => parseAppointmentDate('2026-02-30'), error => error.getStatus() === 400);
  let loaded = false;
  const service = new AppointmentsService({ user: { findUnique: async () => actor('RECEPTIONIST') }, appointment: { findMany: async () => { loaded = true; return []; } } });
  await assert.rejects(service.receptionAppointments('actor', {}), error => error.getStatus() === 403);
  assert.equal(loaded, false);
});

test('ticket lookup rejects empty input and never falls back to patient identity or appointment id', async () => {
  let query;
  const service = new AppointmentsService({ user: { findUnique: async () => actor('RECEPTIONIST', ['east']) }, appointment: { findFirst: async args => { query = args; return null; } } });
  await assert.rejects(service.lookupTicket('actor', ''), error => error.getStatus() === 400);
  for (const input of ['x'.repeat(36), '550e8400-e29b-41d4-a716-446655440000', '0901234567', '001234567890', 'PAT001', '001234567890|old-id|Test']) {
    await assert.rejects(service.lookupTicket('actor', input), error => error.getStatus() === 404);
    assert.deepEqual(query.where.AND, [
      { branchId: { in: ['east'] } },
      { bookingCode: { equals: input, mode: 'insensitive' } },
    ]);
  }
});

test('ticket and secure QR lookup return the appointment within the staff branch scope', async () => {
  const row = { id: 'appointment', bookingCode: '260810-ABC123', status: 'CONFIRMED', patientProfile: { id: 'patient' } };
  let ticketQuery;
  let qrQuery;
  const service = new AppointmentsService({
    user: { findUnique: async () => actor('RECEPTIONIST', ['east']) },
    appointment: { findFirst: async args => { ticketQuery = args; return row; } },
    appointmentQrToken: { findFirst: async args => { qrQuery = args; return { appointment: row }; } },
  });
  const result = await service.lookupTicket('actor', '  260810-abc123  ');
  assert.equal(result.appointment.id, row.id);
  assert.deepEqual(ticketQuery.where.AND[1], { bookingCode: { equals: '260810-abc123', mode: 'insensitive' } });
  const qrResult = await service.lookupTicket('actor', 'VITACARE_CHECKIN:secret');
  assert.equal(qrResult.appointment.id, row.id);
  assert.deepEqual(qrQuery.where, {
    tokenHash: require('node:crypto').createHash('sha256').update('secret').digest('hex'),
    appointment: { branchId: { in: ['east'] } },
  });
});

function statusFixture(status = 'CONFIRMED', acting = actor()) {
  const calls = [];
  const current = {
    id: 'a', status, branchId: 'east', queueNumber: 1, scheduleSlotId: 'slot', rescheduleCount: 0,
    patientProfileId: 'patient', patientProfile: { id: 'patient', fullName: 'Test' },
    branch: { id: 'east', name: 'Test' },
    scheduleSlot: { schedule: { doctorId: 'doctor' } },
  };
  const tx = {
    appointment: {
      updateMany: async ({ data }) => { calls.push('update'); Object.assign(current, data); return { count: 1 }; },
      findUniqueOrThrow: async () => current,
    },
    appointmentStatusHistory: { create: async () => calls.push('history') },
  };
  const service = new AppointmentsService({
    user: { findUnique: async () => acting },
    appointment: { findUnique: async () => ({ ...current }), findUniqueOrThrow: async () => current },
    $transaction: async callback => callback(tx),
  }, {}, { emitAppointmentStatusChanged: () => calls.push('realtime') }, {
    invalidateCache: async () => calls.push('invalidate'), triggerAsyncRecommendation: () => calls.push('recommend'),
  });
  return { service, current, calls, tx };
}

test('both completion APIs share one mutation and repeat completion does not repeat side effects', async () => {
  const f = statusFixture('CHECKED_IN', actor('DOCTOR'));
  await f.service.finishMedicalVisit('actor', 'a');
  await f.service.updateStatus('actor', 'a', { status: 'completed' });
  assert.equal(f.current.status, 'COMPLETED');
  for (const operation of ['update', 'history', 'realtime', 'recommend']) assert.equal(f.calls.filter(call => call === operation).length, 1);
});

test('cancelled or completed appointments cannot be reopened and another branch cannot mutate a visit', async () => {
  for (const status of ['CANCELLED', 'COMPLETED']) {
    const f = statusFixture(status);
    await assert.rejects(f.service.updateStatus('actor', 'a', { status: 'confirmed' }), error => error.getStatus() === 400);
    assert.equal(f.calls.length, 0);
  }
  const f = statusFixture('CONFIRMED', actor('RECEPTIONIST', ['central']));
  await assert.rejects(f.service.updateStatus('actor', 'a', { status: 'checked_in' }), error => error.getStatus() === 403);
  assert.equal(f.calls.length, 0);
});

test('reminder windows use clinic calendar date and time separately, including midnight', () => {
  const nextDay = reminderSlotWindows(new Date('2026-10-18T02:00:00Z'), 24);
  assert.equal(nextDay[0].schedule.workDate.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(nextDay[0].startTime.gte.toISOString(), '1970-01-01T08:30:00.000Z');
  const midnight = reminderSlotWindows(new Date('2026-10-18T15:00:00Z'), 2);
  assert.equal(midnight.length, 2);
  assert.equal(midnight[0].schedule.workDate.toISOString(), '2026-10-18T00:00:00.000Z');
  assert.equal(midnight[1].schedule.workDate.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(midnight[1].startTime.lt.toISOString(), '1970-01-01T00:30:00.000Z');
});

test('a total reminder delivery failure remains retryable', async () => {
  let marked = false;
  const reminder = new AppointmentReminderTask({ appointment: {
    findMany: async () => [{ id: 'a', patientProfile: { fullName: 'Test', account: { email: 'test@example.invalid' } }, branch: { name: 'Test' } }],
    updateMany: async () => { marked = true; },
  } }, { sendAppointmentReminder: async () => { throw new Error('offline'); } }, {}, {});
  reminder.logger = { log: () => {}, warn: () => {}, error: () => {} };
  await reminder.sendReminders(2);
  assert.equal(marked, false);
});

test('reschedule keeps the doctor and branch for every booking type, and rejects past slots', () => {
  const appointment = { branchId: 'east', scheduleSlotId: 'old', scheduleSlot: { schedule: { doctorId: 'doctor' } } };
  const slot = { id: 'new', isActive: true, startTime: new Date('1970-01-01T08:00:00Z'), schedule: {
    doctorId: 'doctor', branchId: 'east', status: 'OPEN', workDate: new Date('2026-10-20T00:00:00Z'), doctor: { isActive: true },
  } };
  const now = new Date('2026-10-18T00:00:00Z');
  assert.doesNotThrow(() => assertRescheduleDestination(appointment, slot, now));
  for (const changes of [{ doctorId: 'other' }, { branchId: 'central' }, { workDate: new Date('2026-10-17T00:00:00Z') }]) {
    assert.throws(() => assertRescheduleDestination(appointment, { ...slot, schedule: { ...slot.schedule, ...changes } }, now), error => error.getStatus() === 400);
  }
});

test('patient rescheduling rejects virtual slots without loading a shift or creating a slot', async () => {
  const { PatientAppointmentsService } = require('../src/modules/appointments/patient-appointments.service.ts');
  let scheduleReads = 0;
  let slotWrites = 0;
  const service = new PatientAppointmentsService({
    appointment: { findUnique: async () => ({
      id: 'appointment', patientProfile: { accountId: 'owner' }, status: 'CONFIRMED', rescheduleCount: 0,
      createdAt: new Date(), scheduleSlot: null,
    }) },
    doctorSchedule: { findUnique: async () => { scheduleReads++; return null; } },
    doctorScheduleSlot: { upsert: async () => { slotWrites++; } },
  });
  await assert.rejects(service.rescheduleMyAppointment('owner', 'appointment', {
    newScheduleSlotId: 'virtual_550e8400-e29b-41d4-a716-446655440000_08:00',
  }), error => error.getStatus() === 400);
  assert.equal(scheduleReads, 0);
  assert.equal(slotWrites, 0);
});

test('refund requests stay pending, are idempotent and never refund an entire family payment for one member', async () => {
  for (const groupSize of [1, 2]) {
    const payment = { id: 'p', amount: 200, rawPayload: {} };
    const events = [];
    const tx = {
      invoice: { findFirst: async () => ({ id: 'i', bookingOrderId: 'order', bookingOrder: { _count: { appointments: groupSize } }, payments: [payment] }) },
      paymentTransaction: { update: async ({ data }) => Object.assign(payment, data) },
      outboxEvent: { create: async ({ data }) => events.push(data) },
    };
    const input = { appointmentId: 'a', reason: 'Test', isClinicCancelled: true };
    assert.equal(await requestAppointmentRefund(tx, input), true);
    assert.equal(await requestAppointmentRefund(tx, input), true);
    assert.equal(payment.status, 'REFUND_REQUIRED');
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.requiresManualReview, groupSize > 1 ? true : undefined);
    assert.equal(events[0].payload.amount, groupSize > 1 ? undefined : 200);
  }
});

test('payment confirmation sends notifications only after commit, and never after rollback', async () => {
  for (const shouldRollback of [false, true]) {
    let committed = false;
    let notified = 0;
    const rollback = new Error('rollback');
    const snapshot = { id: 'a', status: 'CONFIRMED', bookingCode: 'VC-TEST' };
    const tx = {
      paymentTransaction: {
        findUnique: async () => ({ id: 'p', invoiceId: 'i', status: 'PENDING', providerTransactionId: '123', invoice: {
          appointment: { id: 'a', status: 'HOLD', queueNumber: 1, statusHistories: [] }, bookingOrder: null,
        } }),
        update: async () => {},
      },
      invoice: { update: async () => {} },
      appointment: { findUnique: async () => ({ id: 'a', queueNumber: 1, scheduleSlotId: null }) },
    };
    const service = new PaymentSettlementService({ $transaction: async callback => {
      const result = await callback(tx);
      if (shouldRollback) throw rollback;
      committed = true;
      return result;
    } }, {
      confirmSingleAppointment: async () => ({ rawToken: 'token', updated: snapshot }),
      notifyConfirmedAppointment: async value => { assert.equal(committed, true); assert.equal(value, snapshot); notified++; },
    });
    const request = service.handlePaymentWebhook('PAYOS', { paymentId: 'p', providerTransactionId: '123', status: 'SUCCESS', payload: {} });
    if (shouldRollback) await assert.rejects(request, error => error === rollback);
    else await request;
    assert.equal(notified, shouldRollback ? 0 : 1);
  }
});
