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
const { PATH_METADATA, METHOD_METADATA, MODULE_METADATA } = require('@nestjs/common/constants');
const { RequestMethod } = require('@nestjs/common');
const { transferAppointmentSlot } = require('../src/modules/appointments/helpers/appointment.helper.ts');
const { AppointmentsService } = require('../src/modules/appointments/appointments.service.ts');
const { CounterPaymentsService } = require('../src/modules/payments/counter-payments.service.ts');
const { resolvePatientCode } = require('../src/modules/patients/patient-code.ts');
const { ReceptionSummaryService } = require('../src/modules/admin-dashboard/reception-summary.service.ts');

test('updating one appointment ignores legacy room input and preserves the shared schedule room', async () => {
  const current = {
    id: 'appointment', branchId: 'branch', status: 'CONFIRMED', queueNumber: 5, scheduleSlotId: 'slot',
    patientProfile: { id: 'patient', fullName: 'Bệnh nhân' }, branch: { id: 'branch' },
    scheduleSlot: { scheduleId: 'schedule', schedule: { room: { id: 'original-room', name: 'Phòng 101' } } },
  };
  const tx = {
    appointment: { updateMany: async () => ({ count: 1 }), findUniqueOrThrow: async () => ({ ...current, status: 'CHECKED_IN' }) },
    appointmentStatusHistory: { create: async () => {} },
  };
  const service = new AppointmentsService({
    user: { findUnique: async () => ({ id: 'receptionist', role: 'RECEPTIONIST', branchAssignments: [{ branchId: 'branch' }] }) },
    appointment: { findUnique: async () => current, findUniqueOrThrow: async () => ({ ...current, status: 'CHECKED_IN' }) },
    $transaction: async callback => callback(tx),
  }, {}, { emitAppointmentStatusChanged: () => {} }, {});
  const result = await service.updateStatus('receptionist', current.id, { status: 'checked_in', clinicRoom: 'another-room' });
  assert.equal(result.appointment.clinicRoom, 'original-room');
  assert.equal(result.appointment.clinicRoomName, 'Phòng 101');
});

function summaryFixture(role, branchIds = []) {
  const queries = [];
  const capture = (name, result) => async args => { queries.push([name, args]); return result; };
  const prisma = {
    user: { findUnique: async () => ({ role, branchAssignments: branchIds.map(branchId => ({ branchId })) }) },
    appointment: { groupBy: capture('appointments', []), findMany: capture('sources', []), count: capture('actions', 0) },
    invoice: { findMany: capture('invoices', []) },
    patientProfile: { count: capture('patients', 0) },
  };
  return { service: new ReceptionSummaryService(prisma), queries };
}

test('reception statistics reject unsupported roles, unassigned staff and another branch before querying data', async () => {
  for (const [role, branches, requested] of [
    ['DOCTOR', ['east'], 'east'], ['PATIENT', [], undefined],
    ['RECEPTIONIST', [], undefined], ['BRANCH_MANAGER', ['east'], 'central'],
  ]) {
    const { service, queries } = summaryFixture(role, branches);
    await assert.rejects(service.getReceptionSummary('user', { branchId: requested }), error => error.getStatus() === 403);
    assert.equal(queries.length, 0);
  }
});

test('reception statistics scope appointments, revenue and patient totals to the assigned branch', async () => {
  const { service, queries } = summaryFixture('RECEPTIONIST', ['east']);
  await service.getReceptionSummary('user', { branchId: 'all', date: '2026-10-18' });
  assert.ok(queries.find(([name]) => name === 'appointments')[1].where.AND.some(condition => condition.branchId === 'east'));
  assert.equal(queries.find(([name]) => name === 'invoices')[1].where.issuedBranchId, 'east');
  assert.deepEqual(queries.find(([name]) => name === 'patients')[1].where, { appointments: { some: { branchId: 'east' } } });
  const chain = summaryFixture('CHAIN_MANAGER');
  await chain.service.getReceptionSummary('manager', { branchId: 'all' });
  assert.equal(chain.queries.find(([name]) => name === 'invoices')[1].where.issuedBranchId, undefined);
});

test('registered controllers have unique routes and all moved endpoints are registered', () => {
  const modules = [
    require('../src/modules/appointments/appointments.module.ts').AppointmentsModule,
    require('../src/modules/admin-dashboard/admin-dashboard.module.ts').AdminDashboardModule,
    require('../src/modules/bookings/booking.module.ts').BookingModule,
    require('../src/modules/payments/payments.module.ts').PaymentsModule,
    require('../src/modules/patients/patients.module.ts').PatientsModule,
    require('../src/modules/schedules/schedules.module.ts').SchedulesModule,
  ];
  const routes = new Map();
  for (const module of modules) {
    for (const controller of Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) || []) {
      const prefixes = [Reflect.getMetadata(PATH_METADATA, controller)].flat();
      for (const key of Object.getOwnPropertyNames(controller.prototype)) {
        const fn = controller.prototype[key];
        if (typeof fn !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, fn);
        if (method === undefined) continue;
        for (const prefix of prefixes) for (const suffix of [Reflect.getMetadata(PATH_METADATA, fn)].flat()) {
          const route = `${RequestMethod[method]} /${[prefix, suffix].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '');
          const normalized = route.replace(/:[^/]+/g, ':param');
          assert.equal(routes.has(normalized), false, `Duplicate route: ${route} (${controller.name}.${key})`);
          routes.set(normalized, route);
        }
      }
    }
  }
  const values = [...routes.values()];
  for (const expected of ['POST /bookings/checkout', 'POST /bookings/batch-checkout', 'POST /bookings/reception',
    'GET /patients', 'GET /patients/lookup', 'GET /schedules/availability', 'POST /schedules/doctor-leave/impact-analysis',
    'POST /payments/appointments/:id/counter', 'GET /payments/appointments/:id/status',
    'POST /appointments/:id/reschedule', 'POST /appointments/:id/clinic-reschedule',
    'GET /appointments/my-bookings', 'GET /appointments/:id/check-in-pass', 'GET /stats/reception-summary']) {
    assert.ok(values.includes(expected), `Missing route: ${expected}`);
  }
  for (const removed of ['POST /appointments/checkout', 'GET /appointments/suggest-slots', 'GET /reception/summary',
    'POST /appointments/:id/payment', 'GET /appointments/availability', 'GET /appointments/next-visit-queue', 'GET /appointments/reception-summary',
    'POST /check-in/qr/:token', 'POST /check-in/scan', 'POST /check-in/preview', 'POST /check-in/by-national-id']) assert.ok(!values.includes(removed));
});

const appointment = { id: 'a', status: 'CONFIRMED', scheduleSlotId: 'old', rescheduleCount: 0 };
const newSlot = { id: 'new', schedule: { branchId: 'branch' } };
function transferFixture({ claimed = 1, reserved = 1 } = {}) {
  const calls = [];
  const tx = {
    appointment: {
      updateMany: async args => { calls.push(['claim', args]); return { count: claimed }; },
      count: async () => 0,
      update: async args => { calls.push(['update', args]); return { ...appointment, ...args.data }; },
    },
    doctorScheduleSlot: { findUnique: async () => null },
    $executeRaw: async (sql, slotId) => {
      const reserve = sql.join('').includes('"occupied_count" + 1');
      calls.push([reserve ? 'reserve' : 'release', slotId]);
      return reserve ? reserved : 1;
    },
  };
  return { tx, calls };
}

test('shared transfer claims the current appointment before reserving and releasing capacity', async () => {
  const { tx, calls } = transferFixture();
  await transferAppointmentSlot(tx, appointment, newSlot, 'staff', 'RESCHEDULE');
  assert.deepEqual(calls.map(c => c[0]), ['claim', 'reserve', 'release', 'update']);
  assert.deepEqual(calls[0][1].where, { id: 'a', status: 'CONFIRMED', scheduleSlotId: 'old', rescheduleCount: 0 });
  assert.equal(calls[3][1].data.statusHistories.create.reason, 'RESCHEDULE');
});

test('a concurrent change or full destination never releases the original slot', async () => {
  for (const options of [{ claimed: 0 }, { reserved: 0 }]) {
    const { tx, calls } = transferFixture(options);
    await assert.rejects(transferAppointmentSlot(tx, appointment, newSlot, 'staff', 'RESCHEDULE'), error => error.getStatus() === 409);
    assert.ok(!calls.some(c => c[0] === 'release' || c[0] === 'update'));
  }
});

test('cancelled appointments and unchanged slots cannot be transferred', async () => {
  for (const [current, destination] of [[{ ...appointment, status: 'CANCELLED' }, newSlot], [appointment, { ...newSlot, id: 'old' }]]) {
    const { tx, calls } = transferFixture();
    await assert.rejects(transferAppointmentSlot(tx, current, destination, 'staff', 'RESCHEDULE'), error => error.getStatus() === 400);
    assert.equal(calls.length, 0);
  }
});

test('batch rescheduling uses the single transfer path and reports every failure', async () => {
  const service = new AppointmentsService({ user: { findUnique: async () => ({ id: 'manager', role: 'CHAIN_MANAGER', branchAssignments: [] }) } });
  const calls = [];
  service.rescheduleForActor = async (actor, id, body) => {
    calls.push([actor.id, id, body.newSlotId]);
    if (id === 'bad') throw new Error('Không tìm thấy lịch hẹn');
    return { success: true, appointmentId: id };
  };
  const result = await service.executeSmartReschedule('manager', { items: [{ appointmentId: 'a', newSlotId: 'x' }, { appointmentId: 'bad', newSlotId: 'y' }] });
  assert.equal(result.total, 2);
  assert.equal(result.successCount, 1);
  assert.equal(result.results.length, 2);
  assert.deepEqual(calls, [['manager', 'a', 'x'], ['manager', 'bad', 'y']]);
});

test('a competing counter payment cannot create a second successful transaction', async () => {
  let created = false;
  const service = new CounterPaymentsService({
    user: { findUnique: async () => ({ role: 'CHAIN_MANAGER', branchAssignments: [] }) },
    invoice: { findUnique: async () => ({ id: 'i', totalAmount: 100, status: 'UNPAID', payments: [], appointment: { status: 'HOLD' } }) },
    $transaction: async callback => callback({
      invoice: { updateMany: async () => ({ count: 0 }) },
      paymentTransaction: { create: async () => { created = true; } },
    }),
  });
  await assert.rejects(service.recordPayment('manager', 'a', {}), error => error.getStatus() === 409);
  assert.equal(created, false);
});

test('online and reception allocation share patient codes for the same identity', async () => {
  const calls = [];
  const code = await resolvePatientCode({
    $executeRaw: async () => calls.push('lock'),
    patientProfile: { findFirst: async () => { calls.push('identity'); return { patientCode: 'BN2600001' }; } },
  }, 'identity-number');
  assert.equal(code, 'BN2600001');
  assert.deepEqual(calls, ['lock', 'identity']);
});
