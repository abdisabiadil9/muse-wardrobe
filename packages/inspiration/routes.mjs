import { one, emitEvent } from '../db/index.mjs';
import { owned, fail } from '../domain/index.mjs';
import { styles, inspirationInput } from './domain.mjs';
import { enqueueInspiration } from './enqueue.mjs';
export function registerInspirationRoutes({
  route,
  pool,
  config,
  idempotent,
  validate,
}) {
  route('GET', '/style-library', async () => ({ data: styles }));
  route('GET', '/inspirations', async (req) => {
    const input = inspirationInput(
      { action: 'search', style_id: req.query.style_id ?? 'city' },
      req.user.id,
    );
    const cache = await one(
      pool,
      'SELECT data,expires_at FROM inspiration_cache WHERE cache_key=$1',
      [input.cache_key],
    );
    return {
      data: cache?.data?.data ?? [],
      fetched_at: cache?.data?.fetched_at ?? null,
      stale: !cache?.data || new Date(cache.expires_at) <= new Date(),
      next_cursor: null,
    };
  });
  route('POST', '/inspiration-tasks', async (req, reply) => {
    validate('/inspiration-tasks', 'post', req.body);
    const input = inspirationInput(req.body, req.user.id);
    return idempotent(
      req,
      reply,
      (db) => enqueueInspiration(db, input, req.user.id, config),
      202,
    );
  });
  route('POST', '/inspiration-tasks/:id/reconcile', async (req, reply) =>
    idempotent(
      req,
      reply,
      async (db) => {
        const task = await owned(db, 'tasks', req.params.id, req.user.id);
        if (task.type !== 'inspiration' || task.status !== 'unconfirmed')
          fail(409, 'invalid_task_state', '这项任务不需要核对');
        const op = await one(
          db,
          "SELECT * FROM provider_operations WHERE task_id=$1 AND provider='everyinfra'",
          [task.id],
        );
        if (!op?.output?.job_id && !op?.error?.request_id)
          fail(
            409,
            'source_reconciliation_required',
            '没有可查询的来源标识，已保留原任务；请由管理员核对，勿重复提交',
          );
        await db.query(
          "UPDATE tasks SET status='queued',error=NULL,next_run_at=now() WHERE id=$1",
          [task.id],
        );
        await emitEvent(db, task.id, 'task.updated', {
          task_id: task.id,
          status: 'queued',
        });
        return { task_id: task.id, status: 'queued' };
      },
      202,
    ),
  );
}
