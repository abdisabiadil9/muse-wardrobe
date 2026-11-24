import { randomUUID } from 'node:crypto';
import { one, fenced } from '../db/index.mjs';
import { AppError } from '../domain/index.mjs';
import { normalizeResult, UNIT_PRICE_USD } from './domain.mjs';
import { sourceReceipt } from './everyinfra.mjs';
import {
  normalizeProducts,
  TAOBAO_SEARCH_PRICE_USD,
} from '../products/domain.mjs';

const delay = (worker, task, stage, seconds = 5) =>
  worker.update(task, {
    status: 'queued',
    stage,
    next_run_at: new Date(Date.now() + seconds * 1000),
  });
export async function runInspirationTask(worker, task) {
  const { pool, inspiration: provider, config } = worker;
  if (!provider)
    throw new AppError(
      503,
      'inspiration_unconfigured',
      '小红书内容服务尚未配置',
    );
  const input = task.input_snapshot;
  const product = input.platform === 'taobao';
  const normalize = (payload) =>
    product
      ? normalizeProducts(payload, input)
      : normalizeResult(payload, input.action);
  const connection = await pool.connect();
  let locked = false;
  try {
    const got = await one(
      connection,
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',
      ['inspiration:' + input.cache_key],
    );
    locked = got.ok;
    if (!locked) return delay(worker, task, 'waiting_for_source');
    const cache = await one(
      pool,
      'SELECT * FROM inspiration_cache WHERE cache_key=$1',
      [input.cache_key],
    );
    const current = await worker.current(task);
    const parent = input.parent_task_id
      ? await one(
          pool,
          'SELECT status,cancel_requested_at FROM tasks WHERE id=$1 AND owner_id=$2',
          [input.parent_task_id, task.owner_id],
        )
      : null;
    if (
      current.cancel_requested_at ||
      parent?.cancel_requested_at ||
      parent?.status === 'cancelled'
    )
      return worker.update(task, { status: 'cancelled', stage: null });
    if (cache?.data && new Date(cache.expires_at) > new Date())
      return worker.update(
        task,
        {
          status: 'succeeded',
          stage: null,
          result: { ...cache.data, cached: true },
        },
        'inspiration.ready',
      );
    if (cache?.pending_task_id && cache.pending_task_id !== task.id) {
      const other = await one(pool, 'SELECT status FROM tasks WHERE id=$1', [
        cache.pending_task_id,
      ]);
      if (['queued', 'running', 'waiting_tools'].includes(other?.status))
        return delay(worker, task, 'waiting_for_source');
      const unresolved = await one(
        pool,
        "SELECT id FROM provider_operations WHERE task_id=$1 AND provider='everyinfra' AND state IN ('dispatching','accepted','unconfirmed') LIMIT 1",
        [cache.pending_task_id],
      );
      if (other?.status === 'unconfirmed' || unresolved) {
        const e = new AppError(
          409,
          'write_unconfirmed',
          '同一来源请求正在核对，不会重复提交',
        );
        e.uncertain = true;
        throw e;
      }
    }
    await pool.query(
      'INSERT INTO inspiration_cache(cache_key,pending_task_id) VALUES($1,$2) ON CONFLICT(cache_key) DO UPDATE SET pending_task_id=$2',
      [input.cache_key, task.id],
    );
    let op = await fenced(pool, task, (db) =>
      one(
        db,
        "INSERT INTO provider_operations(id,task_id,owner_id,provider,operation_key,kind,input) VALUES($1,$2,$3,'everyinfra',$4,'inspiration',$5) ON CONFLICT(operation_key) DO UPDATE SET operation_key=EXCLUDED.operation_key RETURNING *",
        [
          randomUUID(),
          task.id,
          task.owner_id,
          'inspiration:' + task.id,
          { action: input.action, attempts: 0 },
        ],
      ),
    );
    if (op.state === 'done' && op.output?.result)
      return complete(worker, task, op.output.result, op.output);
    if (['dispatching', 'unconfirmed'].includes(op.state)) {
      // A response may have been lost. Reconcile the original request; never send again.
      const requestId = op.error?.request_id ?? op.output?.request_id;
      let lookup;
      if (requestId) {
        try {
          lookup = await provider.lookup(requestId);
        } catch {
          /* Leave uncertain when read scope is unavailable. */
        }
      }
      if (lookup?.job_id) {
        op = await one(
          pool,
          "UPDATE provider_operations SET state='accepted',output=$2 WHERE id=$1 RETURNING *",
          [
            op.id,
            { ...op.output, job_id: lookup.job_id, request_id: requestId },
          ],
        );
      } else {
        const e = new AppError(
          502,
          'write_unconfirmed',
          '来源请求尚未确认，已停止重复提交',
        );
        e.uncertain = true;
        e.requestId = requestId;
        throw e;
      }
    }
    let payload;
    if (op.state === 'pending') {
      // One global month bucket (Asia/Shanghai), charged attempts bounded even under concurrency.
      await fenced(pool, task, async (db, t) => {
        if (t.cancel_requested_at)
          throw new AppError(409, 'cancelled', '任务已取消');
        if (input.parent_task_id) {
          const parent = await one(
            db,
            'SELECT status,cancel_requested_at FROM tasks WHERE id=$1',
            [input.parent_task_id],
          );
          if (
            !parent ||
            parent.cancel_requested_at ||
            parent.status === 'cancelled'
          )
            throw new AppError(409, 'cancelled', '原对话已取消');
        }
        const user = await one(db, 'SELECT deleting FROM users WHERE id=$1', [
          task.owner_id,
        ]);
        if (user.deleting) throw new AppError(409, 'cancelled', '任务已取消');
        const month = await one(
          db,
          "SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM') AS month",
        );
        await db.query(
          'INSERT INTO inspiration_usage(month) VALUES($1) ON CONFLICT DO NOTHING',
          [month.month],
        );
        const usage = await one(
          db,
          'SELECT * FROM inspiration_usage WHERE month=$1 FOR UPDATE',
          [month.month],
        );
        const column = product
          ? 'taobao_search_count'
          : input.action === 'search'
            ? 'search_count'
            : 'note_count';
        const limit = product
          ? (config.productSearchLimit ?? 100)
          : input.action === 'search'
            ? (config.inspirationSearchLimit ?? 1000)
            : (config.inspirationNoteLimit ?? 200);
        if (usage[column] >= limit)
          throw new AppError(
            429,
            'inspiration_budget_exceeded',
            '本月灵感查询额度已用完，已有内容仍可浏览',
          );
        await db.query(
          `UPDATE inspiration_usage SET ${column}=${column}+1 WHERE month=$1`,
          [month.month],
        );
        await db.query(
          "UPDATE provider_operations SET state='dispatching',input=jsonb_set(input,'{attempts}',to_jsonb(($2)::int)),updated_at=now() WHERE id=$1",
          [op.id, (op.input.attempts ?? 0) + 1],
        );
        await db.query(
          "INSERT INTO usage_ledger(operation_id,owner_id,task_id,provider,reserved,unit) VALUES($1,$2,$3,'everyinfra',$4,'USD') ON CONFLICT(operation_id) DO NOTHING",
          [
            task.id,
            task.owner_id,
            task.id,
            product ? TAOBAO_SEARCH_PRICE_USD : UNIT_PRICE_USD,
          ],
        );
      });
      try {
        payload = await provider.submit(
          input.action,
          input.params,
          input.platform ?? 'xiaohongshu',
        );
        const receipt = sourceReceipt(payload);
        op = await fenced(pool, task, (db) =>
          one(
            db,
            "UPDATE provider_operations SET state='accepted',output=$2,error=NULL,updated_at=now() WHERE id=$1 RETURNING *",
            [op.id, receipt],
          ),
        );
        if (!receipt.job_id) {
          // Unexpected synchronous success is still a billable success: persist it before further work.
          let result;
          try {
            result = normalize(payload);
          } catch (error) {
            error.uncertain = true;
            error.requestId = receipt.request_id;
            throw error;
          }
          return complete(worker, task, result, {
            ...receipt,
            billing_state:
              receipt.billing?.charged === false ? 'not_applicable' : 'charged',
          });
        }
        return delay(worker, task, 'fetching_inspiration', 3);
      } catch (error) {
        if (error.code === 'lease_lost') throw error;
        const retry = error.safeRetry && (op.input.attempts ?? 0) < 2;
        await fenced(pool, task, (db) =>
          db.query(
            'UPDATE provider_operations SET state=$2,error=$3,updated_at=now() WHERE id=$1',
            [
              op.id,
              error.uncertain ? 'unconfirmed' : retry ? 'pending' : 'rejected',
              { code: error.code, request_id: error.requestId ?? null },
            ],
          ),
        );
        if (retry)
          return delay(
            worker,
            task,
            'source_backoff',
            error.retryAfter ??
              Math.min(300, 5 * 2 ** (op.input.attempts ?? 0)),
          );
        throw error;
      }
    }
    if (op.state === 'rejected')
      throw new AppError(
        502,
        op.error?.code ?? 'source_rejected',
        '来源请求未完成，请检查账号或输入',
      );
    if (op.state !== 'accepted' || !op.output?.job_id) {
      const e = new AppError(502, 'write_unconfirmed', '来源结果尚未确认');
      e.uncertain = true;
      throw e;
    }
    try {
      payload = await provider.job(op.output.job_id);
    } catch (error) {
      if (error.readRetry || error.safeRetry)
        return delay(worker, task, 'source_backoff', error.retryAfter ?? 30);
      error.uncertain = true;
      throw error;
    }
    if (['submitting', 'running', 'finalizing'].includes(payload.status))
      return delay(worker, task, 'fetching_inspiration', 10);
    if (payload.status === 'failed') {
      const refunded =
        payload.refund_state === 'refunded' ||
        payload.billing_state === 'not_applicable';
      await pool.query(
        "UPDATE provider_operations SET state='rejected',output=output || $2::jsonb WHERE id=$1",
        [
          op.id,
          {
            billing_state: payload.billing_state,
            refund_state: payload.refund_state,
          },
        ],
      );
      await pool.query(
        'UPDATE usage_ledger SET state=$2,settled=$3 WHERE operation_id=$1',
        [task.id, refunded ? 'released' : 'frozen', refunded ? 0 : null],
      );
      throw new AppError(
        502,
        'source_job_failed',
        '来源暂时无法提供内容，可稍后重新查询',
      );
    }
    if (payload.status !== 'succeeded') {
      const e = new AppError(
        502,
        'write_unconfirmed',
        '来源任务仍在核对，不会重新提交',
      );
      e.uncertain = true;
      e.requestId = op.output.request_id;
      throw e;
    }
    let result;
    try {
      result = normalize(payload);
    } catch (error) {
      error.uncertain = true;
      error.requestId = op.output.request_id;
      throw error;
    }
    return complete(worker, task, result, {
      ...op.output,
      billing: sourceReceipt(payload).billing ?? op.output.billing,
      billing_state: payload.billing_state,
      refund_state: payload.refund_state,
    });
  } finally {
    if (locked)
      await connection
        .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
          'inspiration:' + input.cache_key,
        ])
        .catch(() => {});
    connection.release();
  }
}
async function complete(worker, task, result, receipt) {
  const empty = !result.data.length;
  // Keep no image bytes: source URLs + attributed metadata only. Cache invalidation is bounded.
  const hours = empty ? 1 : task.input_snapshot.cache_hours;
  await fenced(worker.pool, task, async (db, current) => {
    await db.query(
      "UPDATE provider_operations SET state='done',output=$2,updated_at=now() WHERE operation_key=$1",
      ['inspiration:' + task.id, { ...receipt, result }],
    );
    const user = await one(db, 'SELECT deleting FROM users WHERE id=$1', [
      task.owner_id,
    ]);
    if (!current.cancel_requested_at && !user.deleting)
      await db.query(
        "UPDATE inspiration_cache SET data=$2,expires_at=now()+($3*interval '1 hour'),pending_task_id=NULL,updated_at=now() WHERE cache_key=$1",
        [task.input_snapshot.cache_key, result, hours],
      );
    const free =
      receipt.billing_state === 'not_applicable' ||
      receipt.refund_state === 'refunded' ||
      receipt.refund?.status === 'succeeded';
    const settled = free
      ? 0
      : typeof receipt.billing?.charged_usd === 'number'
        ? receipt.billing.charged_usd
        : null;
    await db.query(
      'UPDATE usage_ledger SET state=$2,settled=$3 WHERE operation_id=$1',
      [
        task.id,
        free
          ? 'released'
          : receipt.billing_state === 'charged'
            ? 'completed'
            : 'frozen',
        settled,
      ],
    );
  });
  return worker.update(
    task,
    { status: 'succeeded', stage: null, result },
    'inspiration.ready',
  );
}
