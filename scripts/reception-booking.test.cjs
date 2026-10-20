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
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const { Prisma } = require('@prisma/client');
const { ReceptionBookingService } = require('../src/modules/bookings/reception-booking.service.ts');
const { ScheduleAvailabilityService } = require('../src/modules/schedules/schedule-availability.service.ts');
const { PatientDirectoryService } = require('../src/modules/patients/patient-directory.service.ts');
const { CreateReceptionAppointmentDto, ReceptionAvailabilityQueryDto } = require('../src/modules/bookings/dtos/reception-booking.dto.ts');

const doctorId = '550e8400-e29b-41d4-a716-446655440000';
const serviceId = '550e8400-e29b-41d4-a716-446655440001';
const slotId = '550e8400-e29b-41d4-a716-446655440002';
const branchId = '550e8400-e29b-41d4-a716-446655440003';
const time = value => new Date(`1970-01-01T${value}:00Z`);
const input = {
  specialtyId: 1, servicePackageId: serviceId, doctorId, scheduleSlotId: slotId,
  appointmentDate: '2026-10-19', startTime: '10:00', patient: { id: 'patient' },
};

function fixture() {
  const queries = {};
  const events = [];
  const actor = { id: 'staff', role: 'RECEPTIONIST', branchAssignments: [{ branchId }] };
  const service = {
    id: serviceId, name: 'Khám chuyên khoa mắt', specialtyId: 1, isActive: true, price: new Prisma.Decimal(250000),
    branchBookingMethod: { branchId, bookingMethodId: 'method', isEnabled: true }, branchBookingMethods: [],
    receptionSchedules: [{ branchId, dayOfWeek: 1, sessions: ['MORNING'] }],
  };
  const slot = {
    id: slotId, scheduleId: 'schedule', startTime: time('10:00'), endTime: time('10:30'),
    capacity: 2, occupiedCount: 0, isActive: true,
    schedule: {
      id: 'schedule', branchId, doctorId, workDate: new Date('2026-10-19T00:00:00Z'),
      branch: { name: 'Cơ sở 1' }, room: { id: 'room', name: 'Phòng khám mắt' },
      doctor: { id: doctorId, user: { fullName: 'Bác sĩ A' }, consultationFee: new Prisma.Decimal(100000), academicRank: 'BS' },
    },
  };
  const state = { appointment: null, invoice: null, released: false, reservations: 0, committed: false };
  let duplicate = false;
  let reserveResult = 1;
  const tx = {
    specialty: { findUnique: async () => ({ id: 1, name: 'Mắt', isActive: true }) },
    servicePackage: { findUnique: async () => service },
    bookingMethod: { findFirst: async () => ({ id: 'method' }) },
    doctorScheduleSlot: {
      fields: { capacity: 'capacity' },
      findFirst: async args => {
        queries.selectedSlot = args;
        const where = args.where;
        const branches = where.schedule.branchId;
        if (where.id && where.id !== slot.id) return null;
        if (where.schedule.doctorId !== slot.schedule.doctorId) return null;
        if (typeof branches === 'string' ? branches !== branchId : !branches.in.includes(branchId)) return null;
        return slot;
      },
      findUnique: async () => slot,
      findMany: async args => {
        if (args.where.scheduleId) return [{ capacity: 2 }];
        queries.availableSlots = args;
        const result = [slot, { ...slot, id: 'second-slot', schedule: { ...slot.schedule, doctor: { ...slot.schedule.doctor, id: 'second-doctor', user: { fullName: 'Bác sĩ B' } } } }];
        return args.where.startTime ? result.filter(item => item.startTime.getTime() === args.where.startTime.getTime()) : result;
      },
    },
    doctorSchedule: { findMany: async args => {
      queries.availableDates = args;
      return [{ workDate: slot.schedule.workDate, branchId, slots: [slot] }];
    } },
    appointment: {
      findFirst: async () => duplicate ? { id: 'duplicate' } : null,
      count: async () => 0,
      create: async ({ data }) => { state.appointment = data; return data; },
      findUniqueOrThrow: async () => ({
        ...state.appointment,
        patientProfile: { id: 'patient', fullName: 'Bệnh nhân', phoneNumber: '0901234567' },
        branch: { id: branchId, name: 'Cơ sở 1' },
        scheduleSlot: slot,
        servicePackage: { ...service, specialty: { id: 1, name: 'Mắt' } },
        bookingMethod: { id: 'method', code: 'SPECIALTY_EXAM', name: 'Khám chuyên khoa' },
        invoice: { ...state.invoice, items: [state.invoice.items.create] },
        statusHistories: [{ actor: { id: 'staff', role: 'RECEPTIONIST', fullName: 'Tiếp tân' } }],
      }),
    },
    invoice: { create: async ({ data }) => { state.invoice = { id: 'invoice', status: 'UNPAID', ...data }; return state.invoice; } },
    $executeRaw: async () => { state.reservations += reserveResult; return reserveResult; },
  };
  const prisma = {
    ...tx,
    user: { findUnique: async () => actor },
    $transaction: async (callback, options) => {
      queries.transaction = options;
      try {
        const result = await callback(tx);
        state.committed = true;
        return result;
      } catch (error) {
        state.appointment = null;
        state.invoice = null;
        state.reservations = 0;
        throw error;
      }
    },
  };
  const patients = { resolveReceptionProfile: async () => 'patient' };
  const reception = new ReceptionBookingService(prisma, { emitAppointmentBooked: payload => {
    assert.equal(state.committed, true, 'realtime must run after commit');
    events.push(payload);
  } }, patients);
  return {
    reception, availability: new ScheduleAvailabilityService(prisma),
    actor, service, slot, state, events, queries, tx,
    duplicate: () => { duplicate = true; },
    fill: () => { reserveResult = 0; },
  };
}

function freeze(t, now = '2026-10-19T02:00:00Z') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
}

test('reception requires specialty and service, while availability can be requested before choosing a doctor', () => {
  const dto = plainToInstance(CreateReceptionAppointmentDto, { ...input, specialtyId: '1' });
  assert.equal(validateSync(dto).length, 0);
  assert.equal(dto.specialtyId, 1);
  for (const field of ['specialtyId', 'servicePackageId', 'scheduleSlotId']) {
    const invalid = { ...input };
    delete invalid[field];
    assert.ok(validateSync(plainToInstance(CreateReceptionAppointmentDto, invalid)).some(error => error.property === field));
  }
  for (const startTime of ['25:00', '10:75']) {
    assert.ok(validateSync(plainToInstance(CreateReceptionAppointmentDto, { ...input, startTime })).length);
  }
  assert.equal(validateSync(plainToInstance(ReceptionAvailabilityQueryDto, { date: input.appointmentDate, specialtyId: '1', servicePackageId: serviceId })).length, 0);
  assert.ok(validateSync(plainToInstance(ReceptionAvailabilityQueryDto, { date: input.appointmentDate, startTime: '25:00' })).length);
});

test('reception books specialty service at its price on the same day, creates an unpaid invoice and emits after commit', async t => {
  freeze(t);
  const f = fixture();
  const result = await f.reception.createReception('staff', input);
  assert.deepEqual(f.queries.transaction, { isolationLevel: 'Serializable' });
  assert.equal(f.queries.selectedSlot.where.schedule.workDate.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(f.queries.selectedSlot.where.startTime.toISOString(), '1970-01-01T10:00:00.000Z');
  assert.equal(f.queries.selectedSlot.where.id, slotId);
  assert.equal(f.queries.selectedSlot.where.schedule.doctor.specialties.some.specialtyId, 1);
  assert.deepEqual(f.queries.selectedSlot.where.schedule.branchId, { in: [branchId] });
  assert.equal(f.state.appointment.bookingMethodId, 'method');
  assert.equal(f.state.appointment.servicePackageId, serviceId);
  assert.equal(Number(f.state.appointment.servicePrice), 250000);
  assert.equal(f.state.appointment.status, 'HOLD');
  assert.equal(f.state.appointment.holdExpiresAt, undefined);
  assert.equal(f.state.appointment.queueNumber, 3);
  assert.equal(Number(f.state.invoice.totalAmount), 250000);
  assert.equal(Number(f.state.invoice.subtotal), 250000);
  assert.equal(f.state.invoice.items.create.description, f.service.name);
  assert.equal(result.appointment.bookingMethod.code, 'SPECIALTY_EXAM');
  assert.equal(result.appointment.specialty.name, 'Mắt');
  assert.equal(result.appointment.bookingSource, 'clinic');
  assert.equal(f.events[0].bookingType, 'SERVICE_PACKAGE');
  assert.equal(f.events[0].doctorName, 'Bác sĩ A');
  assert.equal(f.events[0].servicePackageName, f.service.name);
});

test('reception rejects an unrelated service, inactive service and disabled deployment without creating a booking', async t => {
  freeze(t);
  for (const change of [
    f => { f.service.specialtyId = 2; },
    f => { f.service.specialtyId = null; },
    f => { f.service.isActive = false; },
    f => { f.service.branchBookingMethod.isEnabled = false; },
    f => { f.service.branchBookingMethod.bookingMethodId = 'other-method'; },
    f => { f.service.receptionSchedules[0].sessions = ['EVENING']; },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.reception.createReception('staff', input), error => [400, 404].includes(error.getStatus()));
    assert.equal(f.state.appointment, null);
    assert.equal(f.state.reservations, 0);
    assert.equal(f.events.length, 0);
  }
});

test('reception rejects an unauthorized role or branch, an inactive slot selection and past dates', async t => {
  freeze(t);
  for (const change of [
    f => { f.actor.role = 'DOCTOR'; },
    f => { f.actor.branchAssignments = []; },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.reception.createReception('staff', input), error => error.getStatus() === 403);
  }
  const f = fixture();
  await assert.rejects(f.reception.createReception('staff', { ...input, branchId: doctorId }), error => error.getStatus() === 403);
  await assert.rejects(f.reception.createReception('staff', { ...input, doctorId: serviceId }), error => error.getStatus() === 400);
  await assert.rejects(f.reception.createReception('staff', { ...input, scheduleSlotId: serviceId }), error => error.getStatus() === 400);
  await assert.rejects(f.reception.createReception('staff', { ...input, appointmentDate: '2026-10-18' }), error => error.getStatus() === 400);
  await assert.rejects(f.reception.createReception('staff', { ...input, appointmentDate: '2026-02-30' }), error => error.getStatus() === 400);
  assert.equal(f.events.length, 0);
});

test('reception never creates an invoice or emits realtime after a duplicate or competing reservation', async t => {
  freeze(t);
  for (const block of [f => f.duplicate(), f => f.fill()]) {
    const f = fixture();
    block(f);
    await assert.rejects(f.reception.createReception('staff', input), error => error.getStatus() === 409);
    assert.equal(f.state.invoice, null);
    assert.equal(f.state.reservations, 0);
    assert.equal(f.events.length, 0);
  }
});

test('same-day reception excludes slots that have already ended', async t => {
  freeze(t, '2026-10-19T05:00:00Z');
  const f = fixture();
  await assert.rejects(f.reception.createReception('staff', input), error => error.getStatus() === 400);
  const result = await f.availability.availability('staff', undefined, input.appointmentDate, input);
  assert.deepEqual(result.freeSlots, []);
  assert.deepEqual(result.availableDates, []);
});

test('specialty availability returns the available time and doctors before a doctor is chosen', async t => {
  freeze(t);
  const f = fixture();
  const result = await f.availability.availability('staff', undefined, input.appointmentDate, input);
  assert.equal(f.queries.availableSlots.where.schedule.doctorId, undefined);
  assert.deepEqual(f.queries.availableSlots.where.schedule.branchId, { in: [branchId] });
  assert.equal(f.queries.availableSlots.where.schedule.doctor.specialties.some.specialtyId, 1);
  assert.equal(f.queries.availableSlots.where.schedule.branch.bookingMethods.some.bookingMethodId, 'method');
  assert.deepEqual(result.freeSlots, ['10:00']);
  assert.deepEqual(result.availableDates, ['2026-10-19']);
  assert.deepEqual(result.slots.map(slot => slot.doctorName), ['Bác sĩ A', 'Bác sĩ B']);
  assert.ok(result.slots.every(slot => slot.branchId === branchId && slot.remainingSlots === 2));
});

test('availability filters package reception sessions and validates specialty and branch scope', async t => {
  freeze(t);
  const f = fixture();
  f.service.receptionSchedules[0].sessions = ['EVENING'];
  const result = await f.availability.availability('staff', undefined, input.appointmentDate, input);
  assert.deepEqual(result.slots, []);
  assert.deepEqual(result.availableDates, []);
  await assert.rejects(f.availability.availability('staff', undefined, input.appointmentDate, { ...input, specialtyId: 2 }), error => error.getStatus() === 400);
  await assert.rejects(f.availability.availability('staff', undefined, input.appointmentDate, { ...input, branchId: doctorId }), error => error.getStatus() === 403);
});

test('the counter flow can choose the time first and then request its available doctors', async t => {
  freeze(t);
  const f = fixture();
  const beforeDoctor = await f.availability.availability('staff', undefined, input.appointmentDate, {
    specialtyId: input.specialtyId, servicePackageId: input.servicePackageId, startTime: '10:00',
  });
  assert.deepEqual(beforeDoctor.freeSlots, ['10:00']);
  assert.equal(beforeDoctor.slots.length, 2);
  assert.equal(f.queries.availableSlots.where.schedule.doctorId, undefined);
  assert.equal(f.queries.availableSlots.where.startTime.toISOString(), '1970-01-01T10:00:00.000Z');

  const chosen = beforeDoctor.slots.find(slot => slot.doctorId === doctorId);
  const booking = await f.reception.createReception('staff', {
    ...input, doctorId: chosen.doctorId, scheduleSlotId: chosen.id, branchId: chosen.branchId,
  });
  assert.equal(booking.appointment.doctor.id, chosen.doctorId);
  assert.equal(booking.appointment.startTime, '10:00');
  assert.equal(booking.appointment.payment.amount, 250000);
  assert.equal(booking.appointment.workflowStatus, 'HOLD');

  const unavailableTime = await f.availability.availability('staff', undefined, input.appointmentDate, {
    specialtyId: input.specialtyId, servicePackageId: input.servicePackageId, startTime: '11:00',
  });
  assert.deepEqual(unavailableTime.slots, []);
});

test('a serializable conflict returns a retryable error and never emits an uncommitted booking', async t => {
  freeze(t);
  const f = fixture();
  f.tx.invoice.create = async () => { throw new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: 'test' }); };
  await assert.rejects(f.reception.createReception('staff', input), error => error.getStatus() === 409);
  assert.equal(f.state.appointment, null);
  assert.equal(f.state.reservations, 0);
  assert.equal(f.events.length, 0);
});


test('a service with only full slots has no available times or dates', async t => {
  freeze(t);
  const f = fixture();
  f.slot.occupiedCount = f.slot.capacity;
  const result = await f.availability.availability('staff', undefined, input.appointmentDate, input);
  assert.deepEqual(result.freeSlots, []);
  assert.deepEqual(result.slots, []);
  assert.deepEqual(result.availableDates, []);
});

test('a new reception patient keeps the contact phone entered on the form', async () => {
  let created;
  const tx = {
    $executeRaw: async () => 1,
    patientProfile: {
      findFirst: async () => null,
      create: async ({ data }) => { created = data; return { id: 'new-patient' }; },
    },
  };
  const id = await new PatientDirectoryService({}).resolveReceptionProfile(tx, {
    patient: { fullName: 'Bệnh nhân', dateOfBirth: '2000-01-01', phone: '0901234567' },
  });
  assert.equal(id, 'new-patient');
  assert.equal(created.phoneNumber, '0901234567');
});
