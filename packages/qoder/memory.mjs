import { randomUUID } from 'node:crypto';
import { one, all, transaction } from '../db/index.mjs';
import { collectPages } from './client.mjs';

/** Shared lock serializes sync, deletion and Dream promotion for this owner. */
async function withOwner(pool, owner, fn) {
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
      'memory:' + owner,
    ]);
    return await fn(db);
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
      'memory:' + owner,
    ]);
    db.release();
  }
}
function contentForFeedback(row) {
  return JSON.stringify(
    {
      feedback_id: row.id,
      actually_worn: row.actually_worn,
      fit_by_part: row.fit_by_part,
      comment: row.comment,
      confirmed_at: row.created_at,
      source: 'user_confirmed_feedback',
    },
    null,
    2,
  );
}
async function upsert(client, store, path, content) {
  let items = await collectPages((page) => client.listMemories(store, page));
  let found = items.find((x) => x.path === path);
  if (!found) {
    try {
      return await client.createMemory(store, { path, content });
    } catch (error) {
      if (!error.uncertain) throw error;
      items = await collectPages((page) => client.listMemories(store, page));
      found = items.find((x) => x.path === path);
      if (!found) throw error;
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await client.getMemory(store, found.id);
    if (current.content === content) return current;
    try {
      return await client.updateMemory(
        store,
        found.id,
        content,
        current.content_sha256,
      );
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  throw new Error('memory_revision_conflict');
}
async function removePath(client, store, path) {
  const memories = await collectPages((page) =>
    client.listMemories(store, page),
  );
  for (const item of memories.filter((x) => x.path === path))
    await client.deleteMemory(store, item.id);
  const versions = await collectPages((page) =>
    client.listMemoryVersions(store, page),
  );
  for (const version of versions) {
    if (version.redacted) continue;
    if (version.path === path || version.memory_path === path)
      await client.redactMemoryVersion(store, version.id);
    else if (!version.path && !version.memory_path)
      throw new Error('memory_history_scope_unverified');
  }
}
async function syncAll(db, client, owner, store) {
  const p = await one(db, 'SELECT * FROM preferences WHERE owner_id=$1', [
    owner,
  ]);
  await upsert(
    client,
    store,
    'preferences/profile.md',
    JSON.stringify(
      {
        ...p.data,
        revision: p.revision,
        updated_at: p.updated_at,
        source: 'user_confirmed_preferences',
      },
      null,
      2,
    ),
  );
  const feedback = await all(
    db,
    'SELECT * FROM wear_feedback WHERE owner_id=$1 AND consent_to_memory=true ORDER BY seq',
    [owner],
  );
  for (const row of feedback) {
    const path = `wear-feedback/${row.id}.md`;
    if (row.deleted_at) await removePath(client, store, path);
    else await upsert(client, store, path, contentForFeedback(row));
  }
}
export async function provisionMemory({ pool, client, owner }) {
  return withOwner(pool, owner, async (db) => {
    const old = await one(
      db,
      'SELECT * FROM memory_bindings WHERE owner_id=$1',
      [owner],
    );
    if (old) return old;
    const user = await one(db, 'SELECT id FROM users WHERE id=$1', [owner]);
    if (!user) throw new Error('Unknown owner');
    const key = `memory-store:${owner}`;
    const existing = await one(
      db,
      'SELECT * FROM provider_operations WHERE operation_key=$1',
      [key],
    );
    if (existing?.state === 'dispatching' || existing?.state === 'unconfirmed')
      throw new Error(
        'Memory Store creation is unconfirmed; bind the verified store explicitly',
      );
    let store = existing?.output;
    if (!store) {
      await db.query(
        "INSERT INTO provider_operations(id,owner_id,provider,operation_key,kind,state) VALUES($1,$2,'qoder',$3,'memory_store','dispatching')",
        [randomUUID(), owner, key],
      );
      try {
        store = await client.createMemoryStore(`muse-user-${owner}`);
        await db.query(
          "UPDATE provider_operations SET state='done',output=$2 WHERE operation_key=$1",
          [key, store],
        );
      } catch (error) {
        await db.query(
          "UPDATE provider_operations SET state='unconfirmed' WHERE operation_key=$1",
          [key],
        );
        throw error;
      }
    }
    return one(
      db,
      'INSERT INTO memory_bindings(owner_id,active_store_id) VALUES($1,$2) RETURNING *',
      [owner, store.id],
    );
  });
}
export async function syncMemoryJobs({ pool, client, limit = 10 }) {
  const jobs = await all(
    pool,
    "SELECT * FROM memory_sync_jobs WHERE state IN ('queued','waiting_config','waiting_dream') ORDER BY created_at LIMIT $1",
    [limit],
  );
  let count = 0;
  for (const job of jobs)
    await withOwner(pool, job.owner_id, async (db) => {
      const binding = await one(
        db,
        'SELECT * FROM memory_bindings WHERE owner_id=$1',
        [job.owner_id],
      );
      if (!binding) {
        await db.query(
          "UPDATE memory_sync_jobs SET state='waiting_config' WHERE id=$1",
          [job.id],
        );
        return;
      }
      try {
        if (job.resource_key === 'preferences') {
          const p = await one(
            db,
            'SELECT * FROM preferences WHERE owner_id=$1',
            [job.owner_id],
          );
          await upsert(
            client,
            binding.active_store_id,
            'preferences/profile.md',
            JSON.stringify(
              {
                ...p.data,
                revision: p.revision,
                updated_at: p.updated_at,
                source: 'user_confirmed_preferences',
              },
              null,
              2,
            ),
          );
        } else {
          const row = await one(
            db,
            'SELECT * FROM wear_feedback WHERE id=$1 AND owner_id=$2',
            [job.resource_key.slice('feedback:'.length), job.owner_id],
          );
          if (!row) throw new Error('feedback_missing');
          const path = `wear-feedback/${row.id}.md`;
          if (row.deleted_at) {
            const dreams = await all(
              db,
              "SELECT * FROM dream_jobs WHERE owner_id=$1 AND status NOT IN ('promoted','failed')",
              [job.owner_id],
            );
            if (dreams.length) throw new Error('active_dream_deletion_pending');
            const stores = new Set([
              binding.active_store_id,
              ...(
                await all(
                  db,
                  'SELECT input_store_id,output_store_id FROM dream_jobs WHERE owner_id=$1',
                  [job.owner_id],
                )
              )
                .flatMap((x) => [x.input_store_id, x.output_store_id])
                .filter(Boolean),
            ]);
            for (const store of stores) await removePath(client, store, path);
          } else if (row.consent_to_memory)
            await upsert(
              client,
              binding.active_store_id,
              path,
              contentForFeedback(row),
            );
        }
        await db.query(
          "UPDATE memory_sync_jobs SET state='done',error=NULL WHERE id=$1",
          [job.id],
        );
        count++;
      } catch (error) {
        await db.query(
          'UPDATE memory_sync_jobs SET state=$3,error=$2 WHERE id=$1',
          [
            job.id,
            { code: error.code ?? error.message ?? 'memory_sync_failed' },
            error.message === 'active_dream_deletion_pending'
              ? 'waiting_dream'
              : 'failed',
          ],
        );
      }
    });
  return count;
}
export async function startDream({ pool, client, owner }) {
  return withOwner(pool, owner, async (db) => {
    // The provider's active-Dream limit is workspace-wide, not per-user.
    await db.query("SELECT pg_advisory_lock(hashtext('muse-dream-workspace'))");
    try {
      const active = await one(
        db,
        "SELECT id FROM dream_jobs WHERE status IN ('queued','dispatching','running','unconfirmed','reconciling') LIMIT 1",
      );
      if (active) throw new Error('Another Dream is active or unconfirmed');
      const binding = await one(
        db,
        'SELECT * FROM memory_bindings WHERE owner_id=$1',
        [owner],
      );
      if (!binding) throw new Error('Memory Store is not provisioned');
      const sessions = await all(
        db,
        "SELECT a.qoder_session_id FROM agent_sessions a JOIN tasks t ON t.id=a.task_id WHERE a.owner_id=$1 AND t.status='succeeded' AND a.memory_store_id=$2 ORDER BY t.created_at DESC LIMIT 100",
        [owner, binding.active_store_id],
      );
      if (!sessions.length)
        throw new Error(
          'Dream requires at least one completed same-owner Session',
        );
      const watermark = await one(
        db,
        'SELECT coalesce(max(seq),0) AS seq FROM wear_feedback WHERE owner_id=$1',
        [owner],
      );
      const job = await one(
        db,
        "INSERT INTO dream_jobs(id,owner_id,input_store_id,input_generation,feedback_watermark,session_ids,status) VALUES($1,$2,$3,$4,$5,$6,'dispatching') RETURNING *",
        [
          randomUUID(),
          owner,
          binding.active_store_id,
          binding.generation,
          watermark.seq,
          JSON.stringify(sessions.map((s) => s.qoder_session_id)),
        ],
      );
      try {
        const dream = await client.createDream(
          binding.active_store_id,
          sessions.map((s) => s.qoder_session_id),
        );
        return one(
          db,
          "UPDATE dream_jobs SET provider_id=$2,status='running' WHERE id=$1 RETURNING *",
          [job.id, dream.id],
        );
      } catch (error) {
        await db.query(
          "UPDATE dream_jobs SET status='unconfirmed',error=$2 WHERE id=$1",
          [job.id, { code: error.code ?? 'dream_create_unknown' }],
        );
        throw error;
      }
    } finally {
      await db.query(
        "SELECT pg_advisory_unlock(hashtext('muse-dream-workspace'))",
      );
    }
  });
}
export async function reconcileDream({
  pool,
  client,
  jobId,
  verifyIsolation = false,
}) {
  let job = await one(pool, 'SELECT * FROM dream_jobs WHERE id=$1', [jobId]);
  if (!job?.provider_id) throw new Error('Dream provider ID is unconfirmed');
  return withOwner(pool, job.owner_id, async (db) => {
    job = await one(db, 'SELECT * FROM dream_jobs WHERE id=$1', [jobId]);
    if (job.status === 'promoted')
      return { status: 'promoted', store_id: job.output_store_id };
    if (job.status === 'failed') return { status: 'failed' };
    const remote = await client.getDream(job.provider_id);
    const state = remote.status;
    if (['failed', 'cancelled', 'canceled', 'terminated'].includes(state)) {
      await db.query(
        "UPDATE dream_jobs SET status='failed',error=$2 WHERE id=$1",
        [job.id, { code: 'dream_failed' }],
      );
      return { status: 'failed' };
    }
    if (!['succeeded', 'completed', 'success'].includes(state))
      return { status: state ?? 'running' };
    const outputs = remote.outputs ?? [];
    const stores = outputs
      .filter((x) => x.type === 'memory_store')
      .map((x) => x.memory_store_id ?? x.id);
    if (stores.length !== 1 || stores[0] === job.input_store_id)
      throw new Error('Dream output is not a distinct Memory Store');
    await db.query(
      "UPDATE dream_jobs SET status='reconciling',output_store_id=$2 WHERE id=$1",
      [job.id, stores[0]],
    );
    if (!verifyIsolation)
      throw new Error(
        'Explicit isolation validation is required before Dream promotion',
      );
    const binding = await one(
      db,
      'SELECT * FROM memory_bindings WHERE owner_id=$1',
      [job.owner_id],
    );
    if (
      binding.generation !== job.input_generation ||
      binding.active_store_id !== job.input_store_id
    )
      throw new Error('Memory generation conflict; Dream not promoted');
    const sessions = await all(
      db,
      'SELECT qoder_session_id FROM agent_sessions WHERE owner_id=$1 AND qoder_session_id=ANY($2::text[])',
      [job.owner_id, job.session_ids],
    );
    if (sessions.length !== job.session_ids.length)
      throw new Error('Dream Session owner verification failed');
    await syncAll(db, client, job.owner_id, stores[0]);
    // Re-read DB revisions after remote writes; new sync jobs always target current binding.
    await transaction(pool, async (tx) => {
      const updated = await one(
        tx,
        'UPDATE memory_bindings SET active_store_id=$3,generation=generation+1 WHERE owner_id=$1 AND generation=$2 RETURNING *',
        [job.owner_id, job.input_generation, stores[0]],
      );
      if (!updated) throw new Error('Memory generation conflict');
      await tx.query("UPDATE dream_jobs SET status='promoted' WHERE id=$1", [
        job.id,
      ]);
      await tx.query(
        "INSERT INTO memory_sync_jobs(id,owner_id,resource_key,generation) VALUES($1,$2,'preferences',$3) ON CONFLICT DO NOTHING",
        [randomUUID(), job.owner_id, updated.generation],
      );
      const rows = await all(
        tx,
        'SELECT id FROM wear_feedback WHERE owner_id=$1 AND consent_to_memory=true',
        [job.owner_id],
      );
      for (const row of rows)
        await tx.query(
          'INSERT INTO memory_sync_jobs(id,owner_id,resource_key,generation) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [
            randomUUID(),
            job.owner_id,
            'feedback:' + row.id,
            updated.generation,
          ],
        );
    });
    return { status: 'promoted', store_id: stores[0] };
  });
}
