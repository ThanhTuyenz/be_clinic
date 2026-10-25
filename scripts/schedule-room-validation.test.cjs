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
const { SchedulesService } = require('../src/modules/schedules/schedules.service.ts');

function fixture(roomOverrides = {}) {
  const doctor = {
    id: 'doctor', isActive: true, specialties: [{ specialtyId: 1 }, { specialtyId: 3 }],
    user: { branchAssignments: [{ branchId: 'east', branch: { isActive: true } }] },
  };
  const room = { branchId: 'east', isActive: true, specialties: [{ specialtyId: 1 }, { specialtyId: 2 }], ...roomOverrides };
  const existing = {
    id: 'shift', doctorId: 'doctor', branchId: 'east', roomId: 'room', status: 'OPEN',
    workDate: new Date('2026-11-02T00:00:00Z'), startTime: new Date('2026-11-02T08:00:00Z'),
    endTime: new Date('2026-11-02T09:00:00Z'), slotDurationMin: 30, capacityPerSlot: 1,
  };
  const writes = [];
  const queries = {};
  const service = new SchedulesService({
    doctor: { findFirst: async args => { queries.doctor = args; return doctor; } },
    clinicRoom: { findFirst: async args => { queries.room = args; return room; } },
    doctorScheduleException: { findFirst: async () => null },
    doctorSchedule: {
      findUnique: async () => existing,
      findFirst: async () => null,
      findMany: async () => [{ ...existing, doctor, room }],
      create: async args => { writes.push(args); return { id: 'new', ...args.data }; },
      update: async args => { writes.push(args); return { ...existing, ...args.data }; },
    },
  });
  service.generateSlotsForShift = async () => ({ slotsCreated: 2 });
  return { service, doctor, room, existing, writes, queries };
}
const createBody = { doctorId: 'doctor', branchId: 'east', roomId: 'room', workDate: '2026-11-02', startTime: '08:00', endTime: '09:00' };
const batchBody = { ...createBody, startDate: '2026-11-02', endDate: '2026-11-02', daysOfWeek: [1] };

test('create accepts intersecting specialties C/F and C/D, using active specialty links', async () => {
  const { service, writes, queries } = fixture();
  await service.create(createBody);
  assert.equal(writes.length, 1);
  assert.deepEqual(queries.room.where, { id: 'room', branchId: 'east', isActive: true });
  assert.deepEqual(queries.room.select.specialties.where, { isActive: true, specialty: { isActive: true } });
  assert.deepEqual(queries.doctor.select.specialties.where, { specialty: { isActive: true } });
});

for (const [name, room] of [
  ['unrelated specialties', { specialties: [{ specialtyId: 2 }] }],
  ['no active room specialties', { specialties: [] }],
  ['wrong branch', { branchId: 'west' }],
  ['inactive room', { isActive: false }],
]) {
  test(`create rejects ${name} before writing`, async () => {
    const { service, writes } = fixture(room);
    await assert.rejects(() => service.create(createBody), error => error.getStatus() === 400);
    assert.equal(writes.length, 0);
  });
}

test('no doctor specialties cannot be assigned a room', async () => {
  const { service, doctor, writes } = fixture();
  doctor.specialties = [];
  await assert.rejects(() => service.create(createBody), /chuyên khoa/);
  assert.equal(writes.length, 0);
});

test('unassigned room remains supported', async () => {
  const { service, queries, writes } = fixture();
  await service.create({ ...createBody, roomId: null });
  assert.equal(queries.room, undefined);
  assert.equal(writes[0].data.roomId, null);
});

test('batch rejects an incompatible room before creating any shifts', async () => {
  const { service, writes } = fixture({ specialties: [{ specialtyId: 2 }] });
  await assert.rejects(() => service.createBatch(batchBody), /chuyên khoa/);
  assert.equal(writes.length, 0);
});

test('batch allows a compatible room', async () => {
  const { service, writes } = fixture();
  const result = await service.createBatch(batchBody);
  assert.equal(result.createdCount, 1);
  assert.equal(writes.length, 1);
});

test('changing rooms and reopening an existing shift both validate compatibility', async () => {
  for (const body of [{ roomId: 'new-room' }, { status: 'OPEN' }]) {
    const { service, writes } = fixture({ specialties: [{ specialtyId: 2 }] });
    await assert.rejects(() => service.update('shift', body), /chuyên khoa/);
    assert.equal(writes.length, 0);
  }
});

test('closing a shift is still allowed after its room configuration becomes invalid', async () => {
  const { service, writes, queries } = fixture({ specialties: [] });
  await service.update('shift', { status: 'CLOSED' });
  assert.equal(writes.length, 1);
  assert.equal(queries.room, undefined);
});

test('copy week rejects incompatible source rooms before creating shifts', async () => {
  const { service, writes } = fixture({ specialties: [{ specialtyId: 2 }] });
  await assert.rejects(() => service.copyWeek({ sourceMonday: '2026-11-02', targetMonday: '2026-11-09' }), /chuyên khoa/);
  assert.equal(writes.length, 0);
});

test('copy week accepts compatible source rooms', async () => {
  const { service, writes } = fixture();
  const result = await service.copyWeek({ sourceMonday: '2026-11-02', targetMonday: '2026-11-09' });
  assert.equal(result.copiedCount, 1);
  assert.equal(writes.length, 1);
});
