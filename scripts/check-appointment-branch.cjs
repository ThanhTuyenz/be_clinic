const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', process.env.ENV_FILE || '.env.development'), override: true, quiet: true });

(async () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const pending = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='appointments' AND column_name='branch_id'")).rowCount > 0;
    const normalized = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='package_reception_slots' AND column_name='reception_schedule_id'")).rowCount > 0;
    const locationJoin = normalized ? ' LEFT JOIN package_reception_schedules prs ON prs.id=r.reception_schedule_id' : '';
    const receptionBranch = normalized ? 'prs.branch_id' : 'r.branch_id';
    const derived = `SELECT a.id, COALESCE(ds.branch_id,${receptionBranch}) AS branch_id FROM appointments a LEFT JOIN doctor_schedule_slots s ON s.id=a.schedule_slot_id LEFT JOIN doctor_schedules ds ON ds.id=s.schedule_id LEFT JOIN package_reception_slots r ON r.id=a.reception_slot_id${locationJoin} ORDER BY a.id`;
    const before = (await client.query(pending ? 'SELECT id, branch_id FROM appointments ORDER BY id' : derived)).rows;
    if (pending) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/schema/migrations/20261123110000_appointment_branch_from_slot/migration.sql'), 'utf8');
      await client.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    }
    assert.deepEqual((await client.query(derived)).rows, before);
    let checks = 0;
    async function reject(sql, values, code) {
      await client.query('SAVEPOINT invalid_change');
      await assert.rejects(client.query(sql, values), { code });
      await client.query('ROLLBACK TO SAVEPOINT invalid_change');
      checks++;
    }
    if (before.length) await reject('UPDATE appointments SET schedule_slot_id=NULL,reception_slot_id=NULL WHERE id=$1', [before[0].id], '23514');
    const schedule = (await client.query('SELECT DISTINCT ds.id,ds.branch_id FROM doctor_schedules ds JOIN doctor_schedule_slots s ON s.schedule_id=ds.id JOIN appointments a ON a.schedule_slot_id=s.id LIMIT 1')).rows[0];
    if (schedule) {
      const other = (await client.query('SELECT id FROM branches WHERE id<>$1 LIMIT 1', [schedule.branch_id])).rows[0];
      if (other) await reject('UPDATE doctor_schedules SET branch_id=$1 WHERE id=$2', [other.id, schedule.id], 'P0001');
    }
    const reception = (await client.query(normalized ? 'SELECT DISTINCT prs.id,prs.branch_id FROM package_reception_schedules prs JOIN package_reception_slots r ON r.reception_schedule_id=prs.id JOIN appointments a ON a.reception_slot_id=r.id LIMIT 1' : 'SELECT DISTINCT r.id,r.branch_id FROM package_reception_slots r JOIN appointments a ON a.reception_slot_id=r.id LIMIT 1')).rows[0];
    if (reception) {
      const other = (await client.query('SELECT id FROM branches WHERE id<>$1 LIMIT 1', [reception.branch_id])).rows[0];
      if (other) await reject(normalized ? 'UPDATE package_reception_schedules SET branch_id=$1 WHERE id=$2' : 'UPDATE package_reception_slots SET branch_id=$1 WHERE id=$2', [other.id, reception.id], 'P0001');
    }
    console.log(JSON.stringify({ status: 'PASS', pendingMigrationTested: pending, preservedAppointments: before.length, protectedChanges: checks }));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
