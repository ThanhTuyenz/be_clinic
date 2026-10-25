require('ts-node/register/transpile-only');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(request);
  if (request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSync } = require('class-validator');
const { buildDoctorProfileData, syncDoctorSpecialties } = require('../src/modules/auth/users/helpers/doctor-profile.helper.ts');
const { CreateUserDto } = require('../src/modules/auth/users/dtos/create-user.dto.ts');
const { UpdateUserAdminDto } = require('../src/modules/auth/users/dtos/update-user-admin.dto.ts');
const profile = { academicRank: 'BS. CKI', licenseNumber: 'CCHN-123', experienceYears: 0, consultationFee: 0, onlineConsultationFee: 0, isOnlineConsultationEnabled: true, doctorIsActive: false, isFeatured: true };
const stored = { ...profile, isActive: true };

test('profile persists explicit zero fees, zero experience and false flags', () => {
  const data = buildDoctorProfileData(profile);
  assert.equal(data.consultationFee, 0);
  assert.equal(data.onlineConsultationFee, 0);
  assert.equal(data.experienceYears, 0);
  assert.equal(data.isActive, false);
  assert.equal(data.isFeatured, true);
  assert.equal(data.isOnlineConsultationEnabled, true);
});

test('partial updates preserve fees and configuration when omitted', () => {
  const data = buildDoctorProfileData({ biography: ' Updated ' }, stored);
  assert.equal(data.biography, 'Updated');
  for (const key of ['consultationFee', 'onlineConsultationFee', 'isOnlineConsultationEnabled', 'isActive', 'isFeatured']) assert.equal(Object.hasOwn(data, key), false);
});

test('incomplete doctor profiles and invalid fees/experience are rejected', () => {
  for (const changes of [{ academicRank: '' }, { licenseNumber: '' }, { consultationFee: undefined }, { consultationFee: null }, { consultationFee: -1 }, { onlineConsultationFee: -1 }, { onlineConsultationFee: NaN }, { onlineConsultationFee: null }, { experienceYears: -1 }, { experienceYears: 1.5 }]) {
    assert.throws(() => buildDoctorProfileData({ ...profile, ...changes }), error => error.getStatus() === 400);
  }
});

test('disabling online consultation preserves its price; an inactive legacy profile can still be locked', () => {
  assert.equal(buildDoctorProfileData({ isOnlineConsultationEnabled: false }, stored).onlineConsultationFee, undefined);
  assert.doesNotThrow(() => buildDoctorProfileData({}, { ...stored, licenseNumber: null, academicRank: null, onlineConsultationFee: null }));
});

function specialtyFixture(validCount = 2) {
  let links = [{ specialtyId: 1, isPrimary: true }, { specialtyId: 2, isPrimary: true }, { specialtyId: 4, isPrimary: false }];
  const writes = [];
  const tx = {
    specialty: { count: async () => validCount },
    doctorSpecialty: {
      findMany: async () => links,
      deleteMany: async ({ where }) => { writes.push('delete'); links = links.filter(link => where.specialtyId.notIn.includes(link.specialtyId)); },
      updateMany: async () => { writes.push('reset'); links.forEach(link => { link.isPrimary = false; }); },
      createMany: async ({ data }) => { writes.push('insert'); for (const link of data) if (!links.some(item => item.specialtyId === link.specialtyId)) links.push(link); },
      update: async ({ where, data }) => { writes.push('primary'); Object.assign(links.find(link => link.specialtyId === where.doctorId_specialtyId.specialtyId), data); },
    },
  };
  return { tx, writes, get links() { return links; } };
}

test('multiple specialties replace removed links and leave exactly one primary', async () => {
  const fixture = specialtyFixture();
  await syncDoctorSpecialties(fixture.tx, 'doctor', { specialtyIds: [1, 3], primarySpecialtyId: 3 });
  assert.deepEqual(fixture.links.map(link => link.specialtyId), [1, 3]);
  assert.deepEqual(fixture.links.filter(link => link.isPrimary).map(link => link.specialtyId), [3]);
});

test('invalid specialty sets fail before modifying assignments', async () => {
  for (const input of [{ specialtyIds: [] }, { specialtyIds: [1, 1], primarySpecialtyId: 1 }, { specialtyIds: [1, 3], primarySpecialtyId: 2 }, { specialtyIds: [1, 3] }]) {
    const { tx, writes } = specialtyFixture();
    await assert.rejects(() => syncDoctorSpecialties(tx, 'doctor', input), error => error.getStatus() === 400);
    assert.deepEqual(writes, []);
  }
  const { tx, writes } = specialtyFixture(1);
  await assert.rejects(() => syncDoctorSpecialties(tx, 'doctor', { specialtyIds: [1, 3], primarySpecialtyId: 1 }), /ngừng hoạt động/);
  assert.deepEqual(writes, []);
});

test('legacy single specialty requests remain supported and unrelated updates retain assignments', async () => {
  const fixture = specialtyFixture(1);
  await syncDoctorSpecialties(fixture.tx, 'doctor', { specialtyId: 2 });
  assert.deepEqual(fixture.links.map(link => [link.specialtyId, link.isPrimary]), [[2, true]]);
  const { tx, writes } = specialtyFixture();
  await syncDoctorSpecialties(tx, 'doctor', {});
  assert.deepEqual(writes, []);
});

test('both request DTOs validate the added fields and reject invalid types', () => {
  for (const Dto of [CreateUserDto, UpdateUserAdminDto]) {
    const base = { email: 'doctor@example.com', fullName: 'Doctor', password: '123456', role: 'doctor', ...profile, specialtyIds: [1, 3], primarySpecialtyId: 1 };
    assert.deepEqual(validateSync(Object.assign(new Dto(), base)), []);
    for (const changes of [{ consultationFee: -1 }, { onlineConsultationFee: -1 }, { experienceYears: 0.5 }, { specialtyIds: [] }, { specialtyIds: [1, 1] }, { specialtyIds: ['1'] }, { isOnlineConsultationEnabled: 'true' }, { doctorIsActive: 'false' }, { isFeatured: 1 }]) {
      assert.ok(validateSync(Object.assign(new Dto(), base, changes)).length > 0, JSON.stringify(changes));
    }
  }
});
