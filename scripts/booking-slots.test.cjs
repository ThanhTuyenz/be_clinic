require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSync } = require('class-validator');
const { BookingFlowService } = require('../src/modules/bookings/booking-flow.service.ts');
const { BookingSlotsDto } = require('../src/modules/bookings/dtos/booking-slots.dto.ts');

const workDate = new Date('2026-10-21T00:00:00Z');
const time = value => new Date(`1970-01-01T${value}:00Z`);
function slot(id, start, capacity, occupiedCount, branchId = 'east') {
  return {
    id, startTime: time(start), endTime: time(start.slice(0, 3) + '30'), capacity, occupiedCount,
    schedule: {
      workDate, branchId, room: null,
      doctor: { id: `doctor-${id}`, user: { fullName: id }, consultationFee: '100000', onlineConsultationFee: '80000' },
    },
  };
}
function fixture({ pkg = null, slots = [], schedules } = {}) {
  const queries = {};
  const service = new BookingFlowService({
    branch: { findFirst: async () => ({ id: 'east' }) },
    servicePackage: { findFirst: async () => structuredClone(pkg) },
    doctorSchedule: { findMany: async args => {
      queries.schedules = args;
      return schedules || [{ workDate, branchId: 'east', slots }];
    } },
    doctorScheduleSlot: { findMany: async args => { queries.slots = args; return slots; } },
  });
  return { service, queries };
}
const pkg = {
  id: 'package', specialtyId: 1,
  branchBookingMethod: { branchId: 'east', isEnabled: true },
  branchBookingMethods: [{ branchBookingMethod: { branchId: 'west', isEnabled: false } }],
  receptionSchedules: [
    { branchId: 'east', dayOfWeek: 3, sessions: ['MORNING'] },
    { branchId: 'west', dayOfWeek: 3, sessions: ['MORNING'] },
  ],
};
function freeze(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-19T09:29:00Z') });
}

const weekendSlot = (id, start, date = '2026-10-24') => {
  const value = slot(id, start, 1, 0);
  value.schedule.workDate = new Date(date + 'T00:00:00Z');
  return value;
};

test('after-hours allows Saturday and Sunday sessions and excludes weekday evenings', async t => {
  freeze(t);
  const saturday = new Date('2026-10-24T00:00:00Z');
  const sunday = new Date('2026-10-25T00:00:00Z');
  const slots = [slot('weekday-night', '17:00', 1, 0), weekendSlot('morning', '08:00'), weekendSlot('afternoon', '14:00'), weekendSlot('night', '17:00')];
  const { service, queries } = fixture({ slots, schedules: [
    { workDate, branchId: 'east', slots: [slots[0]] },
    { workDate: saturday, branchId: 'east', slots: slots.slice(1) },
    { workDate: sunday, branchId: 'east', slots: [weekendSlot('sunday', '09:00', '2026-10-25')] },
  ] });
  const result = await service.getBookingSlots({ bookingMethodCode: 'AFTER_HOURS' });
  assert.deepEqual(result.availableDates, ['2026-10-24', '2026-10-25']);
  assert.deepEqual(result.slots.map(s => s.startTime), ['08:00', '14:00', '17:00']);
  assert.deepEqual(result.summary, { morning: 1, afternoon: 1, evening: 1 });
  const expected = { some: { isEnabled: true, bookingMethod: { code: 'AFTER_HOURS', isActive: true } } };
  assert.deepEqual(queries.schedules.where.branch.bookingMethods, expected);
  assert.deepEqual(queries.slots.where.schedule.branch.bookingMethods, expected);
  assert.equal(queries.schedules.where.doctor.isActive, true);
  assert.equal(queries.slots.where.schedule.doctor.isActive, true);
  assert.equal(queries.slots.where.startTime, undefined);
  const onlyWeekday = fixture({ slots: [slots[0]] });
  const unavailable = await onlyWeekday.service.getBookingSlots({ bookingMethodCode: 'AFTER_HOURS', date: '2026-10-21' });
  assert.deepEqual(unavailable.slots, []);
});

test('after-hours available dates exclude weekdays and full weekends', async t => {
  freeze(t);
  const full = weekendSlot('full', '08:00');
  full.occupiedCount = full.capacity;
  for (const [date, slots] of [[workDate, [slot('night', '17:00', 1, 0)]], [full.schedule.workDate, [full]]]) {
    const { service, queries } = fixture({ slots, schedules: [{ workDate: date, branchId: 'east', slots }] });
    const result = await service.getBookingSlots({ bookingMethodCode: 'AFTER_HOURS' });
    assert.deepEqual(result.availableDates, []);
    assert.deepEqual(result.slots, []);
    assert.equal(queries.slots, undefined);
  }
});

test('after-hours package requires an enabled matching deployment and configured weekend sessions', async t => {
  freeze(t);
  const matching = structuredClone(pkg);
  matching.branchBookingMethod.bookingMethod = { code: 'AFTER_HOURS', isActive: true };
  matching.receptionSchedules = [{ branchId: 'east', dayOfWeek: 6, sessions: ['MORNING'] }];
  const morning = weekendSlot('morning', '08:00');
  const slots = [morning, weekendSlot('night', '17:00')];
  const schedules = [{ workDate: morning.schedule.workDate, branchId: 'east', slots }];
  const result = await fixture({ pkg: matching, slots, schedules }).service
    .getBookingSlots({ servicePackageId: 'package', branchId: 'east', bookingMethodCode: 'AFTER_HOURS' });
  assert.deepEqual(result.slots.map(s => s.startTime), ['08:00']);
  for (const change of [
    method => { method.isEnabled = false; },
    method => { method.bookingMethod.isActive = false; },
    method => { method.bookingMethod.code = 'SPECIALTY_EXAM'; },
  ]) {
    const invalid = structuredClone(matching);
    change(invalid.branchBookingMethod);
    const { service, queries } = fixture({ pkg: invalid });
    await assert.rejects(service.getBookingSlots({ servicePackageId: 'package', bookingMethodCode: 'AFTER_HOURS' }), error => error.getStatus() === 404);
    assert.equal(queries.schedules, undefined);
  }
  matching.receptionSchedules[0].dayOfWeek = 3;
  const unavailable = await fixture({ pkg: matching, slots, schedules }).service
    .getBookingSlots({ servicePackageId: 'package', bookingMethodCode: 'AFTER_HOURS' });
  assert.deepEqual(unavailable.availableDates, []);
});

test('slots DTO rejects unknown booking methods', () => {
  assert.equal(validateSync(Object.assign(new BookingSlotsDto(), { bookingMethodCode: 'AFTER_HOURS' })).length, 0);
  assert.equal(validateSync(Object.assign(new BookingSlotsDto(), { bookingMethodCode: 'unknown' })).length, 1);
});

test('followup init uses doctor consultation data without requiring a service package', async () => {
  let branchQuery;
  let queriedDoctors = false;
  const service = new BookingFlowService({
    branch: { findMany: async args => { branchQuery = args; return []; } },
    bookingMethod: { findMany: async () => [] },
    servicePackage: { findMany: async () => [] },
    doctor: { findMany: async () => { queriedDoctors = true; return []; } },
  });
  const result = await service.getBookingInit({ flow: 'followup' });
  assert.equal(result.flow, 'doctor');
  assert.equal(result.bookingMethodCode, 'CONSULTATION');
  assert.equal(queriedDoctors, true);
  assert.equal(branchQuery.where.bookingMethods.some.bookingMethod.code, 'CONSULTATION');
  assert.deepEqual(result.services, []);
});

test('after-hours init exposes only enabled matching package branches, including linked deployments', async () => {
  const branch = id => ({ id, name: id, isActive: true });
  const deployment = (branchId, code, isEnabled = true) => ({ branchId, branch: branch(branchId), isEnabled, bookingMethod: { code, isActive: true } });
  const packages = [
    { id: 'weekend-only', specialtyId: 1, price: 250, branchBookingMethod: deployment('east', 'AFTER_HOURS'), branchBookingMethods: [] },
    { id: 'day-only', specialtyId: 1, price: 100, branchBookingMethod: deployment('east', 'SPECIALTY_EXAM'), branchBookingMethods: [] },
    { id: 'linked-night', specialtyId: 1, price: 100, branchBookingMethod: deployment('west', 'SPECIALTY_EXAM'), branchBookingMethods: [
      { branchBookingMethod: deployment('east', 'AFTER_HOURS') },
      { branchBookingMethod: deployment('disabled', 'AFTER_HOURS', false) },
    ] },
  ];
  const service = new BookingFlowService({
    branch: { findMany: async () => [branch('east')] },
    bookingMethod: { findMany: async () => [] },
    servicePackage: { findMany: async () => structuredClone(packages) },
    specialty: { findMany: async () => [] },
  });
  const result = await service.getBookingInit({ flow: 'after-hours' });
  assert.equal(result.bookingMethodCode, 'AFTER_HOURS');
  assert.deepEqual(result.services.map(p => p.id), ['weekend-only', 'linked-night']);
  assert.deepEqual(result.services[0].branches.map(b => b.id), ['east']);
  assert.equal(result.services[0].bookingMethod.code, 'AFTER_HOURS');
  const normal = await service.getBookingInit({ flow: 'specialty' });
  assert.deepEqual(normal.services.map(p => p.id), ['day-only', 'linked-night']);
  assert.deepEqual(normal.healthPackages, []);
  assert.equal(normal.services.every((pkg) => pkg.bookingMethod.code === 'SPECIALTY_EXAM'), true);
});

test('query DTO validates date format while allowing an omitted or empty date', () => {
  for (const date of [undefined, '', '2026-10-21']) {
    assert.equal(validateSync(Object.assign(new BookingSlotsDto(), { date })).length, 0);
  }
  for (const date of ['21/10/2026', '2026-1-21', 'invalid']) {
    const errors = validateSync(Object.assign(new BookingSlotsDto(), { date }));
    assert.equal(errors[0].constraints.matches, 'Ngày khám phải có định dạng YYYY-MM-DD');
  }
});

test('booking init resolves specialty slug to its real id and rejects an unknown slug', async () => {
  const deployment = { branchId: 'east', isEnabled: true, branch: { id: 'east', isActive: true }, bookingMethod: { code: 'SPECIALTY_EXAM', isActive: true } };
  const service = new BookingFlowService({
    branch: { findMany: async () => [deployment.branch] }, bookingMethod: { findMany: async () => [] },
    specialty: { findMany: async () => [], findFirst: async ({ where }) => where.slug.equals.toLowerCase() === 'tim-mach' ? { id: 2 } : null },
    servicePackage: { findMany: async () => [{ id: 'cardio-package', price: 200000, specialtyId: 2, branchBookingMethod: deployment, branchBookingMethods: [] }] },
  });
  const numeric = await service.getBookingInit({ flow: 'specialty', specialtyId: '2' });
  const slug = await service.getBookingInit({ flow: 'specialty', specialtyId: 'TIM-MACH' });
  assert.deepEqual(slug.services, numeric.services);
  assert.equal(slug.services.length, 1);
  await assert.rejects(service.getBookingInit({ flow: 'specialty', specialtyId: 'does-not-exist' }), error => error.getStatus() === 404);
});

test('booking cutoff switches from tomorrow to the following day at 16:30 Vietnam time', async t => {
  freeze(t);
  const { service, queries } = fixture();
  await service.getBookingSlots({});
  assert.equal(queries.schedules.where.workDate.gte.toISOString(), '2026-10-20T00:00:00.000Z');
  t.mock.timers.tick(60_000);
  await service.getBookingSlots({});
  assert.equal(queries.schedules.where.workDate.gte.toISOString(), '2026-10-21T00:00:00.000Z');
});

test('package scope and specialty mismatches are rejected before reading schedules', async t => {
  freeze(t);
  const { service, queries } = fixture({ pkg });
  await assert.rejects(service.getBookingSlots({ servicePackageId: 'package', branchId: '550e8400-e29b-41d4-a716-446655440000' }), error => error.getStatus() === 404);
  await assert.rejects(service.getBookingSlots({ servicePackageId: 'package', specialtyId: '2' }), error => error.getStatus() === 400);
  assert.equal(queries.schedules, undefined);
  await assert.rejects(fixture().service.getBookingSlots({ servicePackageId: 'missing' }), error => error.getStatus() === 404);
});

test('impossible dates, today and dates beyond the booking window are rejected', async t => {
  freeze(t);
  const { service, queries } = fixture();
  for (const date of ['2026-02-30', '2026-10-19', '2026-12-01']) {
    await assert.rejects(service.getBookingSlots({ date }), error => error.getStatus() === 400);
  }
  assert.equal(queries.slots, undefined);
});

test('matching times group doctors and count only groups with remaining capacity', async t => {
  freeze(t);
  const { service } = fixture({ slots: [
    slot('a', '08:00', 2, 0), slot('b', '08:00', 1, 1),
    slot('c', '13:00', 1, 2), slot('d', '17:00', 1, 0),
  ] });
  const result = await service.getBookingSlots({});
  assert.equal(result.date, '2026-10-21');
  assert.deepEqual(result.availableDates, ['2026-10-21']);
  assert.equal(result.slots[0].doctors.length, 2);
  assert.equal(result.slots[0].totalCapacity, 3);
  assert.equal(result.slots[0].remainingSlots, 2);
  assert.equal(result.slots[0].representativeSlotId, 'a');
  assert.equal(result.slots[0].doctors[0].onlineConsultationFee, 80000);
  assert.equal(result.slots[1].remainingSlots, 0);
  assert.equal(result.slots[1].isFull, true);
  assert.deepEqual(result.summary, { morning: 1, afternoon: 0, evening: 1 });
  assert.equal(result.totalAvailableSlots, 2);
});

test('package reception excludes paused branches and sessions outside its reception hours', async t => {
  freeze(t);
  const { service, queries } = fixture({ pkg, slots: [
    slot('a', '08:00', 1, 0), slot('b', '08:00', 1, 0, 'west'), slot('c', '17:00', 1, 0),
  ] });
  const result = await service.getBookingSlots({ servicePackageId: 'package', branchId: 'east', doctorId: 'doctor-a' });
  assert.equal(result.slots.length, 1);
  assert.deepEqual(result.slots[0].doctors.map(doctor => doctor.slotId), ['a']);
  for (const where of [queries.schedules.where, queries.slots.where.schedule]) {
    assert.equal(where.branchId, 'east');
    assert.equal(where.doctorId, 'doctor-a');
    assert.equal(where.doctor.specialties.some.specialtyId, 1);
  }
});
