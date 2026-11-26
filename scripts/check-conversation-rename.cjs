// Validate a pending rename in a transaction, or the already-renamed schema.
// Conversation fixtures always roll back; no chat content is printed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', process.env.ENV_FILE || '.env.development'), override: true, quiet: true });

const tables = ['conversations', 'messages'];
async function fingerprint(client, prefix) {
  return Promise.all(tables.map(async table => {
    const name = prefix + table;
    const result = await client.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '|' ORDER BY id), '')) AS digest FROM "${name}" t`);
    return { table, ...result.rows[0] };
  }));
}

(async () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const pending = (await client.query("SELECT to_regclass('ai_conversations') AS old_table")).rows[0].old_table !== null;
    const before = await fingerprint(client, pending ? 'ai_' : '');
    if (pending) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/schema/migrations/20261123100000_remove_ai_table_prefix/migration.sql'), 'utf8');
      await client.query(sql.replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
    }
    assert.deepEqual(await fingerprint(client, ''), before);
    for (const table of tables) assert.equal((await client.query('SELECT to_regclass($1) AS old_table', ['ai_' + table])).rows[0].old_table, null);
    const id = randomUUID();
    await client.query('INSERT INTO conversations(id, updated_at) VALUES ($1, now())', [id]);
    const message = await client.query("INSERT INTO messages(conversation_id, sender, content) VALUES ($1, 'USER', 'Rename regression fixture') RETURNING id", [id]);
    assert.ok(message.rows[0].id > 0);
    await client.query('DELETE FROM conversations WHERE id=$1', [id]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1', [id])).rows[0].count, 0);
    console.log(JSON.stringify({ status: 'PASS', pendingMigrationTested: pending, preserved: before.map(({ table, count }) => ({ table, count })), insertsAndCascadeDelete: true }));
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
