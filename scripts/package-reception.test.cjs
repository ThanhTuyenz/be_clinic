require('ts-node/register/transpile-only');
// Resolve the repository's .js import specifiers to TS sources without emitting build files.
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith('src/')) request = path.resolve(__dirname, '..', request);
  if (request.startsWith('.') && request.endsWith('.js') && parent) {
    const source = path.resolve(path.dirname(parent.filename), request.slice(0, -3) + '.ts');
    if (fs.existsSync(source)) return resolve.call(this, source, parent, ...rest);
  }
  return resolve.call(this, request, parent, ...rest);
};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packageAcceptsSlot, assertPackageReception, parseReceptionDays } = require('../src/modules/bookings/helpers/package-reception.helper.ts');

const date = new Date('2026-10-19T00:00:00Z'); // Monday, database DATE
const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`); // database TIME
const schedules = [
  { branchId: 'east', dayOfWeek: 1, sessions: ['MORNING', 'EVENING'] },
  { branchId: 'central', dayOfWeek: 1, sessions: ['AFTERNOON'] },
  { branchId: 'east', dayOfWeek: 6, sessions: ['MORNING'] },
];

test('accepts disjoint sessions and keeps branch and weekday restrictions', () => {
  for (const hhmm of ['07:30', '09:00', '17:00', '20:00']) assert.equal(packageAcceptsSlot(schedules, 'east', date, time(hhmm)), true);
  for (const hhmm of ['07:00', '11:30', '12:00', '13:30', '20:30']) assert.equal(packageAcceptsSlot(schedules, 'east', date, time(hhmm)), false);
  assert.equal(packageAcceptsSlot(schedules, 'central', date, time('09:00')), false);
  assert.equal(packageAcceptsSlot(schedules, 'central', date, time('13:30')), true);
  assert.equal(packageAcceptsSlot(schedules, 'east', new Date('2026-10-20T00:00:00Z'), time('09:00')), false);
  assert.equal(packageAcceptsSlot(schedules, 'east', new Date('2026-10-24T00:00:00Z'), time('17:30')), false);
});

test('closing boundaries exclude lunch and attribute 17:00 to evening', () => {
  const days = [{ branchId: 'east', dayOfWeek: 1, sessions: ['AFTERNOON'] }];
  assert.equal(packageAcceptsSlot(days, 'east', date, time('13:00')), false);
  assert.equal(packageAcceptsSlot(days, 'east', date, time('13:30')), true);
  assert.equal(packageAcceptsSlot(days, 'east', date, time('16:30')), true);
  assert.equal(packageAcceptsSlot(days, 'east', date, time('17:00')), false);
});

test('unconfigured or paused packages cannot be booked', () => {
  const slot = { startTime: time('09:00'), schedule: { branchId: 'east', workDate: date } };
  assert.throws(() => assertPackageReception([], slot), /ngoài lịch tiếp nhận/);
  assert.doesNotThrow(() => assertPackageReception(schedules, slot));
});

test('validates day and session selections before writing any rows', () => {
  for (const value of [null, {}, [{ dayOfWeek: 7, sessions: ['MORNING'] }], [{ dayOfWeek: '1', sessions: ['MORNING'] }], [{ dayOfWeek: 1, sessions: [] }], [{ dayOfWeek: 1, sessions: ['ALL_DAY'] }], [{ dayOfWeek: 1, sessions: ['__proto__'] }], [{ dayOfWeek: 1, sessions: ['MORNING'] }, { dayOfWeek: 1, sessions: ['EVENING'] }]]) {
    assert.throws(() => parseReceptionDays(value));
  }
  assert.deepEqual(parseReceptionDays([]), []);
  assert.deepEqual(parseReceptionDays([{ dayOfWeek: 0, sessions: ['MORNING', 'MORNING', 'EVENING'] }]), [{ dayOfWeek: 0, sessions: ['MORNING', 'EVENING'] }]);
});

const { SystemCatalogService } = require('../src/modules/system-catalog/system-catalog.service.ts');
const { UsersService } = require('../src/modules/auth/users/users.service.ts');

function doctorUserFixture(branchIds = ['east'], futureShifts = 0) {
  const writes = [];
  const stored = { id: 'user', role: 'DOCTOR', status: 'ACTIVE', provider: 'EMAIL', fullName: 'Bác sĩ', branchAssignments: branchIds.map(branchId => ({ branchId })) };
  const tx = {
    branch: { findFirst: async () => ({ id: 'east' }) },
    user: { findUnique: async () => stored, update: async ({ data }) => { writes.push(['user', data]); return { ...stored, ...data }; }, create: async ({ data }) => { writes.push(['user', data]); return { id: 'user', ...data }; } },
    userBranchAssignment: { deleteMany: async args => writes.push(['remove', args]), upsert: async args => writes.push(['assign', args]) },
    doctor: { upsert: async () => ({ id: 'doctor' }) },
    doctorSchedule: { count: async () => futureShifts },
  };
  const prisma = { ...tx, user: { ...tx.user, findUnique: async ({ where }) => where.email ? null : stored }, $transaction: async fn => fn(tx) };
  const service = new UsersService(prisma, { create: async () => {} }, { invalidateCache() {} }, { delete: async () => {} });
  service.findOneUser = async () => ({ ...stored, role: 'doctor' });
  return { service, writes };
}

test('creating a doctor requires one branch and rejects conflicting primary selection before writes', async () => {
  for (const config of [{ branchIds: [] }, { branchIds: ['east', 'west'] }, { branchIds: ['east'], primaryBranchId: 'west' }]) {
    const { service, writes } = doctorUserFixture();
    await assert.rejects(service.createUser({ email: 'doctor@test.local', role: 'doctor', ...config }), /đúng một chi nhánh/);
    assert.equal(writes.length, 0);
  }
  const { service, writes } = doctorUserFixture();
  await service.createUser({ email: 'doctor@test.local', role: 'doctor', branchIds: ['east'] });
  assert.equal(writes.filter(([kind]) => kind === 'assign').length, 1);
  assert.equal(writes.find(([kind]) => kind === 'assign')[1].create.branchId, 'east');
});

test('doctor updates cannot clear or multiply branches and cannot transfer unhandled future shifts', async () => {
  for (const branchIds of [[], ['east', 'west']]) {
    const { service, writes } = doctorUserFixture();
    await assert.rejects(service.updateUser('user', { branchIds }), /đúng một chi nhánh/);
    assert.equal(writes.length, 0);
  }
  const { service, writes } = doctorUserFixture(['west'], 1);
  await assert.rejects(service.updateUser('user', { branchIds: ['east'] }), /còn ca làm việc/);
  assert.equal(writes.length, 0);
});

test('editing doctor metadata preserves the existing single branch', async () => {
  const { service, writes } = doctorUserFixture();
  await service.updateUser('user', { fullName: 'Bác sĩ cập nhật' });
  assert.deepEqual(writes.map(([kind]) => kind), ['user']);
});

function deploymentFixture({ code = 'SPECIALTY_EXAM', enabled = true, specialtyAvailable = true, days = [] } = {}) {
  const writes = [];
  const method = { id: 'east-method', branchId: 'east', isEnabled: enabled, branch: { isActive: true }, bookingMethod: { code, isActive: true } };
  const existing = { id: 'package', isActive: true, branchBookingMethodId: method.id, branchBookingMethods: [{ branchBookingMethodId: method.id }] };
  const tx = {
    branchBookingMethod: { findMany: async ({ where }) => where.id.in.includes(method.id) ? [method] : [] },
    branchSpecialty: { findMany: async () => specialtyAvailable ? [{ branchId: 'east' }] : [] },
    servicePackage: {
      findUnique: async ({ where }) => where.code ? null : existing,
      create: async ({ data }) => { writes.push(['package', data]); return { id: 'package', ...data }; },
      update: async ({ data }) => { writes.push(['update', data]); return { ...existing, ...data }; },
    },
    servicePackageBranchBookingMethod: {
      findMany: async () => [{ branchBookingMethodId: method.id }],
      findFirst: async () => ({ branchBookingMethodId: method.id }),
      upsert: async (args) => writes.push(['preserve', args]),
      deleteMany: async (args) => writes.push(['unlink', args]),
      createMany: async (args) => writes.push(['link', args]),
    },
    packageReceptionSchedule: {
      findMany: async () => days,
      deleteMany: async (args) => writes.push(['delete-days', args]),
      createMany: async (args) => writes.push(['days', args]),
    },
  };
  const prisma = { ...tx,
    user: { findUnique: async () => ({ role: 'CHAIN_MANAGER', isDeleted: false, branchAssignments: [] }) },
    $transaction: async (callback) => callback(tx),
  };
  const service = new SystemCatalogService(prisma, { isEnabled: () => false }, {});
  service.syncPackageVector = async () => {};
  return { service, writes };
}

test('package creation links only explicitly selected existing methods and retains uploaded image', async () => {
  const { service, writes } = deploymentFixture();
  await service.create('manager', 'service-packages', { name: 'Khám', price: 100, specialtyId: 1, imageUrl: '/actual-image.jpg', branchBookingMethodIds: ['east-method', 'east-method'] });
  const data = writes[0][1];
  assert.equal(data.imageUrl, '/actual-image.jpg');
  assert.deepEqual(data.branchBookingMethods.create, [{ branchBookingMethodId: 'east-method' }]);
  assert.equal(data.branchBookingMethodId, 'east-method');
  assert.equal(data.receptionSchedules, undefined);
});

test('missing, empty, unknown and disabled deployment selections never create or enable methods', async () => {
  for (const ids of [undefined, [], ['unknown'], 'east-method']) {
    const { service, writes } = deploymentFixture();
    await assert.rejects(service.create('manager', 'service-packages', { name: 'Khám', branchBookingMethodIds: ids }));
    assert.equal(writes.length, 0);
  }
  const { service, writes } = deploymentFixture({ enabled: false });
  await assert.rejects(service.create('manager', 'service-packages', { name: 'Khám', branchBookingMethodIds: ['east-method'] }), /ngừng hoạt động/);
  assert.equal(writes.length, 0);
});

test('package creation does not auto-assign a specialty to a branch', async () => {
  const { service, writes } = deploymentFixture({ specialtyAvailable: false });
  await assert.rejects(service.create('manager', 'service-packages', { name: 'Khám', specialtyId: 1, branchBookingMethodIds: ['east-method'] }), /chưa triển khai chuyên khoa/);
  assert.equal(writes.length, 0);
});

test('after-hours-only creation rejects weekday reception before writes and accepts explicit weekend sessions', async () => {
  const { service, writes } = deploymentFixture({ code: 'AFTER_HOURS' });
  const body = { name: 'Khám', branchBookingMethodIds: ['east-method'], branchReceptionSchedules: [{ branchId: 'east', schedules: [{ dayOfWeek: 1, sessions: ['EVENING'] }] }] };
  await assert.rejects(service.create('manager', 'service-packages', body), /thứ Bảy hoặc Chủ nhật/);
  assert.equal(writes.length, 0);
  body.branchReceptionSchedules[0].schedules[0].dayOfWeek = 6;
  await service.create('manager', 'service-packages', body);
  assert.deepEqual(writes[0][1].receptionSchedules.create, [{ branchId: 'east', dayOfWeek: 6, sessions: ['EVENING'] }]);
});

test('metadata update preserves deployment and omitted reception configuration', async () => {
  const { service, writes } = deploymentFixture();
  await service.update('manager', 'service-packages', 'package', { name: 'Khám', price: 100 });
  assert.deepEqual(writes.map(([operation]) => operation), ['update']);
  assert.equal(writes[0][1].branchBookingMethodId, undefined);
});

test('explicitly clearing deployments clears legacy primary, links and reception days', async () => {
  const { service, writes } = deploymentFixture();
  await service.update('manager', 'service-packages', 'package', { name: 'Khám', branchBookingMethodIds: [] });
  assert.deepEqual(writes.map(([operation]) => operation), ['delete-days', 'unlink', 'update']);
  assert.equal(writes[2][1].branchBookingMethodId, null);
});

test('changing to after-hours-only rejects retained weekday schedules until explicitly corrected', async () => {
  const { service, writes } = deploymentFixture({ code: 'AFTER_HOURS', days: [{ branchId: 'east', dayOfWeek: 1, sessions: ['MORNING'] }] });
  const body = { name: 'Khám', branchBookingMethodIds: ['east-method'] };
  await assert.rejects(service.update('manager', 'service-packages', 'package', body), /thứ Bảy hoặc Chủ nhật/);
  assert.equal(writes.length, 0);
  await service.update('manager', 'service-packages', 'package', { ...body, branchReceptionSchedules: [{ branchId: 'east', schedules: [{ dayOfWeek: 0, sessions: ['AFTERNOON'] }] }] });
  assert.ok(writes.some(([operation]) => operation === 'days'));
});

test('branch modal saves methods and corrected reception together without validating the obsolete schedule', async () => {
  const { service, writes } = deploymentFixture({ code: 'AFTER_HOURS', days: [{ branchId: 'east', dayOfWeek: 1, sessions: ['MORNING'] }] });
  await service.setBranchPackage('manager', 'package', {
    branchId: 'east', branchBookingMethodIds: ['east-method'], schedules: [{ dayOfWeek: 6, sessions: ['AFTERNOON'] }],
  });
  assert.deepEqual(writes.find(([operation]) => operation === 'link')[1].data, [{ servicePackageId: 'package', branchBookingMethodId: 'east-method' }]);
  assert.deepEqual(writes.find(([operation]) => operation === 'days')[1].data, [{ servicePackageId: 'package', branchId: 'east', dayOfWeek: 6, sessions: ['AFTERNOON'] }]);
});

test('invalid combined modal configuration rejects before changing deployments or schedules', async () => {
  for (const body of [
    { branchId: 'east', branchBookingMethodIds: ['east-method'], schedules: [{ dayOfWeek: 1, sessions: ['MORNING'] }] },
    { branchId: 'east', branchBookingMethodIds: [], schedules: [{ dayOfWeek: 6, sessions: ['MORNING'] }] },
  ]) {
    const { service, writes } = deploymentFixture({ code: 'AFTER_HOURS' });
    await assert.rejects(service.setBranchPackage('manager', 'package', body));
    assert.equal(writes.length, 0);
  }
});

function catalogueFixture(role = 'BRANCH_MANAGER', deployed = true) {
  const writes = [];
  const tx = {
    servicePackage: { findUnique: async () => ({ isActive: true, branchBookingMethod: deployed ? { branchId: 'east', bookingMethod: { code: 'SPECIALTY_EXAM' } } : null, branchBookingMethods: [] }) },
    packageReceptionSchedule: {
      deleteMany: async (args) => writes.push(['delete', args]),
      createMany: async (args) => writes.push(['create', args]),
    },
  };
  const prisma = {
    user: { findUnique: async () => ({ role, isDeleted: false, customPermissions: ['service:update'], branchAssignments: [{ branchId: 'east' }] }) },
    $transaction: async (callback) => callback(tx),
  };
  return { service: new SystemCatalogService(prisma, { isEnabled: () => false }, {}), writes };
}

test('branch managers cannot change reception schedules of another branch', async () => {
  const { service, writes } = catalogueFixture();
  await assert.rejects(service.setReceptionSchedules('manager', 'package', { branchId: 'central', schedules: [{ dayOfWeek: 1, sessions: ['MORNING'] }] }), /chi nhánh mình phụ trách/);
  assert.equal(writes.length, 0);
});

test('technical admins and undeployed packages cannot open reception schedules', async () => {
  const body = { branchId: 'east', schedules: [{ dayOfWeek: 1, sessions: ['MORNING'] }] };
  const admin = catalogueFixture('ADMIN');
  await assert.rejects(admin.service.setReceptionSchedules('admin', 'package', body), /Chỉ quản lý/);
  const undeployed = catalogueFixture('BRANCH_MANAGER', false);
  await assert.rejects(undeployed.service.setReceptionSchedules('manager', 'package', body), /chưa được áp dụng/);
  assert.equal(undeployed.writes.length, 0);
});

test('saving or pausing reception only changes the selected package and branch', async () => {
  const { service, writes } = catalogueFixture();
  await service.setReceptionSchedules('manager', 'package', { branchId: 'east', schedules: [{ dayOfWeek: 1, sessions: ['MORNING', 'EVENING'] }] });
  assert.deepEqual(writes, [
    ['delete', { where: { servicePackageId: 'package', branchId: 'east' } }],
    ['create', { data: [{ servicePackageId: 'package', branchId: 'east', dayOfWeek: 1, sessions: ['MORNING', 'EVENING'] }] }],
  ]);
  writes.length = 0;
  await service.setReceptionSchedules('manager', 'package', { branchId: 'east', schedules: [] });
  assert.deepEqual(writes, [['delete', { where: { servicePackageId: 'package', branchId: 'east' } }]]);
});

const { parseBranchReceptionSchedules } = require('../src/modules/bookings/helpers/package-reception.helper.ts');
test('chain schedules validate branch scope and preserve omitted branch configuration', () => {
  assert.equal(parseBranchReceptionSchedules(undefined, ['east']), undefined);
  assert.deepEqual(parseBranchReceptionSchedules([{ branchId: 'east', schedules: [] }], ['east']), []);
  assert.deepEqual(parseBranchReceptionSchedules([
    { branchId: 'east', schedules: [{ dayOfWeek: 1, sessions: ['MORNING', 'EVENING'] }] },
    { branchId: 'central', schedules: [{ dayOfWeek: 6, sessions: ['AFTERNOON'] }] },
  ], ['east', 'central']), [
    { branchId: 'east', dayOfWeek: 1, sessions: ['MORNING', 'EVENING'] },
    { branchId: 'central', dayOfWeek: 6, sessions: ['AFTERNOON'] },
  ]);
  for (const input of [
    null,
    [{ branchId: 'outside', schedules: [] }],
    [{ branchId: 'east', schedules: [] }, { branchId: 'east', schedules: [] }],
    [{ branchId: 'east', schedules: [{ dayOfWeek: 1, sessions: [] }] }],
  ]) assert.throws(() => parseBranchReceptionSchedules(input, ['east']));
});

const { CLINIC_SESSIONS, clinicPeriod } = require('../src/common/constants/clinic-sessions.ts');
const { SchedulesService } = require('../src/modules/schedules/schedules.service.ts');

test('single and batch scheduling reject another branch before creating any shift', async () => {
  const service = new SchedulesService({ doctor: { findFirst: async () => ({ id: 'doctor', user: { branchAssignments: [{ branchId: 'east', branch: { isActive: true } }] } }) } });
  await assert.rejects(service.create({ doctorId: 'doctor', branchId: 'west', workDate: '2026-10-21' }), /chi nhánh làm việc duy nhất/);
  await assert.rejects(service.createBatch({ doctorId: 'doctor', branchId: 'west', startDate: '2026-10-21', endDate: '2026-10-22', daysOfWeek: [3] }), /chi nhánh làm việc duy nhất/);
});
test('new doctor shifts generate only slots within the package reception session', async () => {
  const counts = { MORNING: 8, AFTERNOON: 7, EVENING: 7 };
  for (const session of CLINIC_SESSIONS) {
    const slots = [];
    const service = new SchedulesService({
      doctorScheduleSlot: { upsert: (args) => { slots.push(args.create); return Promise.resolve(); } },
      $transaction: (operations) => Promise.all(operations),
    });
    await service.generateSlotsForShift('shift', time(session.start), time(session.end), 30, 1);
    assert.equal(slots.length, counts[session.code]);
    assert.equal(slots[0].startTime.toISOString().slice(11,16), session.start);
    assert.equal(slots.at(-1).endTime.toISOString().slice(11,16), session.end);
    for (const slot of slots) {
      assert.equal(clinicPeriod(slot.startTime.toISOString().slice(11,16)), session.code);
      assert.ok(packageAcceptsSlot([{ branchId: 'east', dayOfWeek: 1, sessions: [session.code] }], 'east', date, slot.startTime));
    }
  }
});
test('portal and backend use identical session hours and classify 17:00 as evening', () => {
  const ts = require('typescript');
  const source = fs.readFileSync(path.resolve(__dirname, '../../fe_clinic_ad/src/common/constants/clinic-sessions.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const portal = { exports: {} };
  new Function('exports', compiled)(portal.exports);
  assert.deepEqual(portal.exports.CLINIC_SESSIONS.map(({ code, start, end }) => ({ code, start, end })), CLINIC_SESSIONS);
  for (const clock of ['07:30', '11:30', '13:30', '16:59', '17:00', '17:30', '20:00']) {
    assert.equal(portal.exports.clinicPeriod(clock), clinicPeriod(clock));
  }
  assert.equal(clinicPeriod('17:00'), 'EVENING');
  assert.equal(clinicPeriod('16:59'), 'AFTERNOON');
});

function portalModule(file, dependencies = {}) {
  const ts = require('typescript');
  const vm = require('node:vm');
  const base = path.resolve(__dirname, '../../fe_clinic_ad');
  const source = fs.readFileSync(path.join(base, 'src', file), 'utf8');
  const context = { exports: {}, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'react') return { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] };
    if (name === 'react/jsx-runtime') return require(path.join(base, 'node_modules/react/jsx-runtime'));
    if (name === '@/common/constants/clinic-sessions') return portalModule('common/constants/clinic-sessions.ts');
    if (name === '../types/catalog.types') return portalModule('modules/catalog/types/catalog.types.ts');
    if (name === './PackageSchedulesField') return { default: () => null };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
function portalElements(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => portalElements(child, type));
  return [...(tree.type === type ? [tree] : []), ...portalElements(tree.props?.children, type)];
}
test('reception form requires explicit sessions and disables weekday additions for after-hours-only deployments', () => {
  const Field = portalModule('modules/catalog/components/PackageSchedulesField.tsx').default;
  let changed;
  const normal = Field({ value: [], onChange: (value) => { changed = value; } });
  const monday = portalElements(normal, 'button').find((button) => Object.hasOwn(button.props, 'aria-pressed') && JSON.stringify(button.props.children).includes('Thứ 2'));
  monday.props.onClick();
  assert.equal(changed[0].dayOfWeek, 1);
  assert.equal(changed[0].sessions.length, 0);
  const weekend = Field({ value: [], weekendOnly: true, onChange() {} });
  const weekdays = portalElements(weekend, 'button').filter((button) => Object.hasOwn(button.props, 'aria-pressed'));
  assert.equal(weekdays.filter((button) => button.props.disabled).length, 5);
  assert.equal(weekdays.filter((button) => !button.props.disabled).length, 2);
});
test('branch form toggles only the chosen DB method while preserving the other branch selection', () => {
  const Field = portalModule('modules/catalog/components/PackageBranchSchedulesField.tsx').default;
  let changed;
  const tree = Field({ branches: [{ id: 'east', name: 'East' }, { id: 'west', name: 'West' }], value: [], onChange() {},
    methods: [{ id: 'east-real-id', branchId: 'east', code: 'AFTER_HOURS', displayName: 'Tên từ DB', isEnabled: true, bookingMethodIsActive: true }],
    methodIds: ['west-real-id'], onMethodsChange: (value) => { changed = value; },
  });
  const inputs = portalElements(tree, 'input');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].props.checked, false);
  inputs[0].props.onChange();
  assert.equal(JSON.stringify(changed), JSON.stringify(['west-real-id', 'east-real-id']));
  assert.ok(JSON.stringify(tree).includes('Tên từ DB'));
  assert.equal(portalElements(tree, 'button').length, 0);
});

test('branch table only displays data; modal edits stay local until one explicit save', async () => {
  const state = [], effects = [], updates = [];
  let cursor = 0, mounted = false;
  const Field = () => null;
  const pkg = { id: 'package', code: 'PKG', name: 'Khám', price: 100, isActive: true,
    branchBookingMethodId: 'east-real', branchBookingMethod: { branchId: 'east' },
    receptionSchedules: [{ branchId: 'east', dayOfWeek: 6, sessions: ['MORNING'] }],
  };
  const methods = [{ id: 'east-real', branchId: 'east', code: 'SPECIALTY_EXAM', displayName: 'Tên DB', isEnabled: true, bookingMethodIsActive: true }];
  const Page = portalModule('modules/catalog/pages/BranchPackagesPage.tsx', {
    react: {
      useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (value) => { state[index] = value; }]; },
      useEffect(effect) { if (!mounted) { effects.push(effect); mounted = true; } },
    },
    'lucide-react': { LoaderCircle: () => null, X: () => null },
    '@/common/hooks/usePermission': { usePermission: () => ({ hasPermission: () => true }) },
    '@/common/constants/permissions.constant': { AppPermission: { SERVICE_UPDATE: 'service:update' } },
    '../components/PackageBranchSchedulesField': { default: Field },
    '../services/catalogService': {
      listCatalog: async (resource) => resource === 'service-packages' ? [pkg] : resource === 'branches' ? [{ id: 'east', name: 'East' }] : methods,
      updateCatalog: async (...args) => { updates.push(args); },
    },
  }).default;
  const render = () => { cursor = 0; const tree = Page(); while (effects.length) effects.shift()(); return tree; };
  const settle = () => new Promise(setImmediate);
  render(); await settle();
  let tree = render();
  assert.equal(portalElements(tree, 'input').some((input) => input.props.type === 'checkbox'), false);
  const open = () => portalElements(render(), 'button').find((button) => button.props.children === 'Thiết lập lịch').props.onClick();
  open();
  let field = portalElements(render(), Field)[0];
  assert.equal(JSON.stringify(field.props.methodIds), JSON.stringify(['east-real']));
  field.props.onMethodsChange(['east-other']);
  field.props.onChange([{ branchId: 'east', dayOfWeek: 0, sessions: ['AFTERNOON'] }]);
  assert.equal(updates.length, 0);
  portalElements(render(), 'button').find((button) => button.props.children === 'Hủy').props.onClick();
  assert.equal(portalElements(render(), 'section').length, 0);
  assert.equal(updates.length, 0);
  open();
  field = portalElements(render(), Field)[0];
  assert.equal(JSON.stringify(field.props.methodIds), JSON.stringify(['east-real']));
  field.props.onChange([{ branchId: 'east', dayOfWeek: 0, sessions: ['AFTERNOON'] }]);
  portalElements(render(), 'button').find((button) => JSON.stringify(button.props.children).includes('Lưu thiết lập')).props.onClick();
  await settle();
  assert.equal(updates.length, 1);
  assert.equal(JSON.stringify(updates[0]), JSON.stringify(['branch-packages', 'package', {
    branchId: 'east', branchBookingMethodIds: ['east-real'], schedules: [{ dayOfWeek: 0, sessions: ['AFTERNOON'] }],
  }]));
});
