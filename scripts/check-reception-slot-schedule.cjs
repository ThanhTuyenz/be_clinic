// Dry-run pending migration in a transaction; all regression mutations roll back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', process.env.ENV_FILE || '.env.development'), override: true, quiet: true });
const backupPath = path.resolve(__dirname, '../../e2e/backups/reception-slots-before-20261124.json');

async function snapshot(client, normalized) {
  const from = normalized
    ? 'package_reception_slots r JOIN package_reception_schedules s ON s.id=r.reception_schedule_id'
    : 'package_reception_slots r';
  const owner = normalized ? 's' : 'r';
  const slots = (await client.query(`SELECT r.id, ${owner}.branch_id, ${owner}.service_package_id,
    r.date,r.start_time,r.end_time,r.capacity,r.occupied_count,r.is_active,r.created_at,r.updated_at
    FROM ${from} ORDER BY r.id`)).rows;
  const appointments = (await client.query('SELECT id,reception_slot_id,status FROM appointments ORDER BY id')).rows;
  return JSON.parse(JSON.stringify({ slots, appointments }));
}

(async () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const pending = (await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='package_reception_slots' AND column_name='branch_id'")).rowCount > 0;
    const before = await snapshot(client, !pending);
    if (process.argv.includes('--backup') && pending) {
      const schedules = (await client.query('SELECT * FROM package_reception_schedules ORDER BY id')).rows;
      fs.writeFileSync(backupPath, JSON.stringify({ ...before, schedules }, null, 2), { flag: 'wx' });
      console.log('Backup saved: ' + backupPath);
    }
    if (pending) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/schema/migrations/20261124090000_reception_slot_schedule/migration.sql'), 'utf8');
      await client.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    }
    const after = await snapshot(client, true);
    assert.deepEqual(after, before);
    if (process.argv.includes('--verify-backup')) {
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      assert.deepEqual(after, { slots: backup.slots, appointments: backup.appointments });
    }
    let checks = 0;
    async function reject(sql, values, code) {
      await client.query('SAVEPOINT invalid_change');
      await assert.rejects(client.query(sql, values), { code });
      await client.query('ROLLBACK TO SAVEPOINT invalid_change');
      checks++;
    }
    const first = (await client.query('SELECT r.id,r.reception_schedule_id,s.day_of_week FROM package_reception_slots r JOIN package_reception_schedules s ON s.id=r.reception_schedule_id LIMIT 1')).rows[0];
    if (first) {
      await reject('DELETE FROM package_reception_schedules WHERE id=$1', [first.reception_schedule_id], '23503');
      await reject('UPDATE package_reception_schedules SET day_of_week=(day_of_week+1)%7 WHERE id=$1', [first.reception_schedule_id], 'P0001');
      await reject("INSERT INTO package_reception_slots(reception_schedule_id,date,start_time,end_time,updated_at) SELECT reception_schedule_id,date+1,start_time,end_time,now() FROM package_reception_slots WHERE id=$1", [first.id], '23514');
      await client.query('UPDATE package_reception_schedules SET is_active=false WHERE id=$1', [first.reception_schedule_id]);
      await reject("INSERT INTO package_reception_slots(reception_schedule_id,date,start_time,end_time,updated_at) SELECT reception_schedule_id,date+7,start_time,end_time,now() FROM package_reception_slots WHERE id=$1", [first.id], 'P0001');
    }
    const shape = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='package_reception_slots'")).rows.map(row => row.column_name);
    assert.ok(shape.includes('reception_schedule_id'));
    assert.ok(!shape.includes('branch_id') && !shape.includes('service_package_id'));
    console.log(JSON.stringify({ status: 'PASS', pendingMigrationTested: pending, preservedSlots: before.slots.length, preservedAppointments: before.appointments.length, protectedChanges: checks }));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
