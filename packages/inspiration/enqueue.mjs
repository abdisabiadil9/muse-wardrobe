import { randomUUID } from 'node:crypto';
import { one, emitEvent } from '../db/index.mjs';
import { fail } from '../domain/index.mjs';
// Call inside a transaction; UI and Agent use identical quota and cache rules.
export async function enqueueInspiration(db, input, owner, config) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'inspiration-request:' + owner,
  ]);
  const cache = await one(
    db,
    'SELECT * FROM inspiration_cache WHERE cache_key=$1',
    [input.cache_key],
  );
  const fresh = cache?.data && new Date(cache.expires_at) > new Date();
  if (!fresh) {
    if (!config.inspirationEnabled)
      fail(
        503,
        'inspiration_unconfigured',
        '外部内容服务尚未配置，风格说明仍可使用',
      );
    const pending = await one(
      db,
      "SELECT id,status FROM tasks WHERE owner_id=$1 AND type='inspiration' AND input_snapshot->>'cache_key'=$2 AND status IN ('queued','running','unconfirmed') ORDER BY created_at DESC LIMIT 1",
      [owner, input.cache_key],
    );
    if (pending) return { task_id: pending.id, status: pending.status };
    const count = await one(
      db,
      "SELECT count(*)::int AS count FROM tasks WHERE owner_id=$1 AND type='inspiration' AND COALESCE(result->>'cached','false')!='true' AND created_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')",
      [owner],
    );
    if (count.count >= (config.inspirationDailyLimit ?? 20))
      fail(
        429,
        'inspiration_daily_limit',
        '今日灵感查询次数已用完，已有内容仍可浏览',
      );
  }
  const id = randomUUID(),
    status = fresh ? 'succeeded' : 'queued';
  const result = fresh ? { ...cache.data, cached: true } : null;
  await db.query(
    "INSERT INTO tasks(id,owner_id,type,input_snapshot,status,result) VALUES($1,$2,'inspiration',$3,$4,$5)",
    [id, owner, input, status, result],
  );
  await emitEvent(db, id, 'task.updated', { task_id: id, status });
  return { task_id: id, status };
}
