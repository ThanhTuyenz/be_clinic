const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../src/modules/bookings/helpers/package-deployment.helper.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, require };
vm.runInNewContext(output, context, { filename: file });
const { getPackageDeployments, packageDeploymentWhere } = context.exports;
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  return { bookingMethodId: 2, bookingMethod: { id: 2, code: 'HEALTH_PACKAGE', isActive: true }, branches: [
    { branch: { id: 10, isActive: true, bookingMethods: [
      { id: 1, branchId: 10, bookingMethodId: 1, isEnabled: true },
      { id: 2, branchId: 10, bookingMethodId: 2, isEnabled: true },
    ] } },
    { branch: { id: 20, isActive: true, bookingMethods: [{ id: 3, branchId: 20, bookingMethodId: 2, isEnabled: false }] } },
  ] };
}

test('one package uses the same method at every deployed branch', () => {
  const rows = getPackageDeployments(fixture());
  assert.deepEqual(plain(rows.map(row => row.bookingMethodId)), [2, 2]);
  assert.deepEqual(plain(rows.map(row => row.isEnabled)), [true, false]);
});

test('inactive branch or method cannot make a package bookable', () => {
  const pkg = fixture();
  pkg.branches[0].branch.isActive = false;
  assert.equal(getPackageDeployments(pkg)[0].isEnabled, false);
  pkg.branches[0].branch.isActive = true;
  pkg.bookingMethod.isActive = false;
  assert.ok(getPackageDeployments(pkg).every(row => !row.isEnabled));
});

test('a branch offering a different method does not enable this package', () => {
  const pkg = fixture();
  pkg.branches[0].branch.bookingMethods = [pkg.branches[0].branch.bookingMethods[0]];
  assert.deepEqual(plain(getPackageDeployments(pkg).map(row => row.branchId)), [20]);
});

test('package queries correlate method and branch instead of mixing unrelated branches', async () => {
  let input;
  const db = { branchBookingMethod: { findMany: async args => {
    input = args;
    return [{ branchId: 10, bookingMethodId: 2 }, { branchId: 20, bookingMethodId: 1 }];
  } } };
  const where = await packageDeploymentWhere(db, 10, 'HEALTH_PACKAGE');
  assert.equal(input.where.branchId, 10);
  assert.equal(input.where.bookingMethod.code, 'HEALTH_PACKAGE');
  assert.deepEqual(plain(where.OR), [
    { bookingMethodId: 2, branches: { some: { branchId: 10 } } },
    { bookingMethodId: 1, branches: { some: { branchId: 20 } } },
  ]);
  const empty = await packageDeploymentWhere({ branchBookingMethod: { findMany: async () => [] } });
  assert.deepEqual(plain(empty), { OR: [] });
});

test('migration chooses one method, preserves branches, and removes the old table', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `package_method_test_${process.pid}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE branches (id SERIAL PRIMARY KEY);
      CREATE TABLE booking_methods (id SERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT, description TEXT, is_active BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ);
      CREATE TABLE branch_booking_methods (id SERIAL PRIMARY KEY, branch_id INT, booking_method_id INT, is_enabled BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ, UNIQUE(branch_id, booking_method_id));
      CREATE TABLE service_packages (id SERIAL PRIMARY KEY, branch_booking_method_id INT, specialty_id INT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE service_package_branch_booking_methods (service_package_id INT, branch_booking_method_id INT, created_at TIMESTAMPTZ DEFAULT now());
      INSERT INTO branches VALUES (10), (20);
      INSERT INTO booking_methods (code) VALUES ('SPECIALTY_EXAM'), ('AFTER_HOURS');
      INSERT INTO branch_booking_methods (branch_id,booking_method_id) VALUES (10,1), (20,2), (10,2);
      INSERT INTO service_packages (branch_booking_method_id) VALUES (3), (NULL), (NULL);
      INSERT INTO service_package_branch_booking_methods (service_package_id,branch_booking_method_id) VALUES (1,1), (1,2), (1,3), (2,2);
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../prisma/schema/migrations/20261123090000_single_package_method/migration.sql'), 'utf8')
      .replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
    await client.query(migration);
    assert.deepEqual((await client.query('SELECT booking_method_id FROM service_packages ORDER BY id')).rows.map(row => row.booking_method_id), [2, 2, 3]);
    assert.deepEqual((await client.query('SELECT service_package_id,branch_id FROM service_package_branches ORDER BY 1,2')).rows, [
      { service_package_id: 1, branch_id: 10 }, { service_package_id: 1, branch_id: 20 }, { service_package_id: 2, branch_id: 20 },
    ]);
    assert.equal((await client.query("SELECT to_regclass('service_package_branch_booking_methods') AS table_name")).rows[0].table_name, null);
    assert.equal((await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='service_packages' AND column_name='booking_method_id'", [schema])).rows[0].is_nullable, 'NO');
    await client.query('SAVEPOINT invalid_method');
    await assert.rejects(client.query('UPDATE service_packages SET booking_method_id=999 WHERE id=1'), { code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_method');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
