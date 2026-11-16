import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
export const createPool = (connectionString) =>
  new pg.Pool({ connectionString, max: 10 });
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export const one = async (db, sql, values = []) =>
  (await db.query(sql, values)).rows[0];
export const all = async (db, sql, values = []) =>
  (await db.query(sql, values)).rows;
export async function migrate(pool) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('muse-schema-v1'))");
    await db.query(sql);
  });
}
export async function emitEvent(db, taskId, type, payload) {
  const row = await one(
    db,
    'UPDATE tasks SET last_event_seq=last_event_seq+1,updated_at=now() WHERE id=$1 RETURNING last_event_seq',
    [taskId],
  );
  await db.query(
    'INSERT INTO task_events(task_id,seq,type,payload) VALUES($1,$2,$3,$4)',
    [taskId, row.last_event_seq, type, payload],
  );
  return row.last_event_seq;
}
export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableJSON(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : stableJSON(value),
    )
    .digest('hex');
export async function ensureUser(
  db,
  id,
  subject = `dev:${id}`,
  name = '开发用户',
) {
  await db.query(
    'INSERT INTO users(id,identity_subject,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',
    [id, subject, name],
  );
  await db.query(
    'INSERT INTO preferences(owner_id) VALUES($1) ON CONFLICT DO NOTHING',
    [id],
  );
  for (const scene of ['daily', 'weekend', 'meeting'])
    await db.query(
      'INSERT INTO outfit_drafts(id,owner_id,scene) VALUES($1,$2,$3) ON CONFLICT(owner_id,scene) DO NOTHING',
      [randomUUID(), id, scene],
    );
  return one(db, 'SELECT * FROM users WHERE id=$1', [id]);
}
export async function claimTask(pool, leaseMs = 60_000) {
  return transaction(pool, async (db) => {
    const task = await one(
      db,
      "SELECT * FROM tasks WHERE status IN ('queued','running','waiting_tools') AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!task) return null;
    return one(
      db,
      "UPDATE tasks SET lease_token=$2,lease_until=now()+($3 * interval '1 millisecond'),attempt=attempt+1,status='running',updated_at=now() WHERE id=$1 RETURNING *",
      [task.id, randomUUID(), leaseMs],
    );
  });
}
export async function fenced(pool, task, fn) {
  return transaction(pool, async (db) => {
    const current = await one(
      db,
      'SELECT * FROM tasks WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE',
      [task.id, task.lease_token],
    );
    if (!current) {
      const e = new Error('Task lease lost');
      e.code = 'lease_lost';
      throw e;
    }
    return fn(db, current);
  });
}
export async function renewLease(pool, task, leaseMs = 60_000) {
  const row = await one(
    pool,
    "UPDATE tasks SET lease_until=now()+($3*interval '1 millisecond') WHERE id=$1 AND lease_token=$2 AND lease_until>now() RETURNING id",
    [task.id, task.lease_token, leaseMs],
  );
  if (!row) {
    const e = new Error('Task lease lost');
    e.code = 'lease_lost';
    throw e;
  }
}
