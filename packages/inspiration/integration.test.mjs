import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createApp } from '../../apps/api/app.mjs';
import { Worker } from '../../apps/worker/runtime.mjs';
import { migrate, one, claimTask } from '../db/index.mjs';
import { AppError } from '../domain/index.mjs';
import { publicAgentEvent } from '../qoder/public-events.mjs';
import { productInput } from '../products/domain.mjs';
import { enqueueInspiration } from './enqueue.mjs';
import { transaction } from '../db/index.mjs';

const database = process.env.TEST_DATABASE_URL,
  enabled = Boolean(database);
const schema = 'test_inspiration_' + randomUUID().replaceAll('-', '');
const origin = 'http://localhost:5179';
const config = {
  devAuth: true,
  allowTestIdentityHeader: true,
  appOrigin: origin,
  sessionSecret: 'fixture-secret-at-least-32-characters',
  inspirationEnabled: true,
  inspirationDailyLimit: 20,
};
let pool, admin, app, validateTask;
before(async () => {
  if (!enabled) return;
  admin = new pg.Pool({ connectionString: database });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({
    connectionString: database,
    options: `-c search_path=${schema}`,
  });
  await migrate(pool);
  app = await createApp({ pool, ...config });
  const contract = JSON.parse(
    await readFile(
      new URL('../../docs/contracts/openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  validateTask = ajv.compile({
    $ref: '#/components/schemas/Task',
    components: contract.components,
  });
});
beforeEach(async () => {
  if (enabled)
    await pool.query(
      'TRUNCATE users,inspiration_cache,inspiration_usage,usage_ledger CASCADE',
    );
});
after(async () => {
  if (!enabled) return;
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
const check = (name, fn) => test(name, { skip: !enabled }, fn);
async function user() {
  const r = await app.inject({
    url: '/api/v1/me',
    headers: { 'x-test-user-id': randomUUID() },
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    id: r.json().id,
    cookie: r.headers['set-cookie'].split(';')[0],
    csrf: r.json().csrf_token,
  };
}
function request(u, method, path, body, key = randomUUID()) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: {
      cookie: u.cookie,
      origin,
      'x-csrf-token': u.csrf,
      'idempotency-key': key,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}
async function start(u, body = { action: 'search', style_id: 'city' }, key) {
  const r = await request(u, 'POST', '/inspiration-tasks', body, key);
  assert.equal(r.statusCode, 202, r.body);
  return r.json().task_id;
}
const note = {
  id: 'abcdef0123456789abcdef01',
  title: '公开穿搭参考',
  text: '奶油白上装配蓝色牛仔裤',
  images: ['https://sns-img.xhscdn.com/fixture.webp'],
  author_name: '测试作者',
  tags: ['简约'],
};
function fixture(overrides = {}) {
  const calls = { submit: 0, job: 0, lookup: 0 };
  const provider = {
    submit: async () => {
      calls.submit++;
      return {
        http_status: 202,
        job_id: 'job_fixture',
        request_id: 'req_fixture',
      };
    },
    job: async () => {
      calls.job++;
      return {
        status: 'succeeded',
        results: [note],
        billing_state: 'charged',
        billing: { charged: true, charged_usd: 0.005556, units: 1 },
        refund_state: 'not_applicable',
      };
    },
    lookup: async () => {
      calls.lookup++;
      return { job_id: 'job_fixture' };
    },
    ...overrides,
  };
  return {
    calls,
    provider,
    worker: new Worker({ pool, config, inspiration: provider }),
  };
}
async function tick(worker) {
  await pool.query(
    "UPDATE tasks SET next_run_at=now() WHERE id=(SELECT id FROM tasks WHERE status='queued' ORDER BY next_run_at,created_at LIMIT 1)",
  );
  assert.equal(await worker.runOnce(), true);
}
const task = (id) => one(pool, 'SELECT * FROM tasks WHERE id=$1', [id]);

check(
  'read-only browsing, authenticated tasks, idempotency and async recovery without resubmission',
  async () => {
    const u = await user(),
      f = fixture();
    assert.equal(
      (await request(u, 'GET', '/style-library')).json().data.length,
      12,
    );
    assert.deepEqual(
      (await request(u, 'GET', '/inspirations?style_id=city')).json().data,
      [],
    );
    assert.equal(f.calls.submit, 0);
    const key = randomUUID(),
      id = await start(u, undefined, key);
    assert.equal(await start(u, undefined, key), id);
    await tick(f.worker);
    assert.equal((await task(id)).status, 'queued');
    assert.equal((await task(id)).result, null);
    // A fresh worker only polls the already persisted provider job.
    await tick(new Worker({ pool, config, inspiration: f.provider }));
    const response = (await request(u, 'GET', '/tasks/' + id)).json();
    assert.equal(response.status, 'succeeded');
    assert.equal(response.result.data[0].images.length, 1);
    assert.ok(validateTask(response), JSON.stringify(validateTask.errors));
    assert.equal(f.calls.submit, 1);
    assert.equal(f.calls.job, 1);
    const ledger = await one(
      pool,
      'SELECT * FROM usage_ledger WHERE task_id=$1',
      [id],
    );
    assert.equal(ledger.state, 'completed');
    assert.equal(Number(ledger.settled), 0.005556);
    const second = await start(u);
    assert.equal((await task(second)).status, 'succeeded');
    assert.equal((await task(second)).result.cached, true);
    assert.equal(f.calls.submit, 1);
    const stranger = await user();
    assert.equal(
      (await request(stranger, 'GET', '/tasks/' + id)).statusCode,
      404,
    );
    const noCSRF = await app.inject({
      method: 'POST',
      url: '/api/v1/inspiration-tasks',
      headers: { cookie: u.cookie, origin },
      payload: { action: 'search', style_id: 'city' },
    });
    assert.equal(noCSRF.statusCode, 403);
  },
);
check(
  'concurrent editorial queries share one source job; custom queries remain private',
  async () => {
    const a = await user(),
      b = await user(),
      f = fixture();
    const [x, y] = await Promise.all([start(a), start(b)]);
    await Promise.all([
      f.worker.runOnce(),
      new Worker({ pool, config, inspiration: f.provider }).runOnce(),
    ]);
    for (let n = 0; n < 5; n++) {
      if (
        (await task(x)).status === 'succeeded' &&
        (await task(y)).status === 'succeeded'
      )
        break;
      await tick(f.worker);
    }
    assert.equal((await task(x)).status, 'succeeded');
    assert.equal((await task(y)).status, 'succeeded');
    assert.equal(f.calls.submit, 1);
    const custom = {
      action: 'search',
      style_id: 'city',
      keyword: '仅属于我的查询',
    };
    const c = await start(a, custom);
    await tick(f.worker);
    await tick(f.worker);
    assert.equal((await task(c)).status, 'succeeded');
    const d = await start(b, custom);
    assert.equal((await task(d)).status, 'queued');
    await tick(f.worker);
    await tick(f.worker);
    assert.equal(f.calls.submit, 3);
    assert.equal(
      (await request(b, 'GET', '/inspirations?style_id=city')).json().data[0]
        .title,
      note.title,
    );
  },
);
check(
  'monthly cap is atomic across workers and shared caches still work after cap',
  async () => {
    const a = await user(),
      b = await user(),
      f = fixture();
    const ids = await Promise.all([
      start(a, { action: 'search', style_id: 'city' }),
      start(b, { action: 'search', style_id: 'college' }),
    ]);
    const capped = { ...config, inspirationSearchLimit: 1 };
    await Promise.all([
      new Worker({ pool, config: capped, inspiration: f.provider }).runOnce(),
      new Worker({ pool, config: capped, inspiration: f.provider }).runOnce(),
    ]);
    assert.equal(f.calls.submit, 1);
    assert.equal(
      Number(
        (await one(pool, 'SELECT search_count FROM inspiration_usage'))
          .search_count,
      ),
      1,
    );
    const failed = (await Promise.all(ids.map(task))).find(
      (t) => t.status === 'failed',
    );
    assert.equal(failed.error.code, 'inspiration_budget_exceeded');
  },
);
check(
  'unknown submission reconciles by request id without a second POST; no-id result remains frozen',
  async () => {
    const u = await user();
    let submits = 0;
    const f = fixture({
      submit: async () => {
        submits++;
        const e = new AppError(502, 'write_unconfirmed', '未确认');
        e.uncertain = true;
        e.requestId = 'req_unknown';
        throw e;
      },
    });
    const id = await start(u);
    await tick(f.worker);
    assert.equal((await task(id)).status, 'unconfirmed');
    assert.equal(await start(u), id);
    const recovered = await request(
      u,
      'POST',
      `/inspiration-tasks/${id}/reconcile`,
      {},
    );
    assert.equal(recovered.statusCode, 202, recovered.body);
    await tick(f.worker);
    assert.equal((await task(id)).status, 'succeeded');
    assert.equal(submits, 1);
    assert.equal(f.calls.lookup, 1);
    const unknown = fixture({
      submit: async () => {
        const e = new AppError(502, 'write_unconfirmed', '未知');
        e.uncertain = true;
        throw e;
      },
    });
    const id2 = await start(u, { action: 'search', style_id: 'french' });
    await tick(unknown.worker);
    assert.equal((await task(id2)).status, 'unconfirmed');
    assert.equal(
      (await request(u, 'POST', `/inspiration-tasks/${id2}/reconcile`, {}))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await one(pool, 'SELECT state FROM usage_ledger WHERE task_id=$1', [
          id2,
        ])
      ).state,
      'frozen',
    );
  },
);
check(
  'known retry waits for Retry-After and is bounded to three submissions',
  async () => {
    const u = await user();
    let submissions = 0;
    const f = fixture({
      submit: async () => {
        submissions++;
        const e = new AppError(502, 'everyinfra_busy', '来源繁忙');
        e.safeRetry = true;
        e.retryAfter = 23;
        throw e;
      },
    });
    const id = await start(u);
    const before = Date.now();
    await f.worker.runOnce();
    assert.ok(
      new Date((await task(id)).next_run_at).getTime() >= before + 22500,
    );
    assert.equal((await task(id)).stage, 'source_backoff');
    await tick(f.worker);
    await tick(f.worker);
    assert.equal(submissions, 3);
    assert.equal((await task(id)).status, 'failed');
  },
);
check(
  'refunded failures release estimates; missing result structure remains unconfirmed',
  async () => {
    const u = await user();
    const f = fixture({
      job: async () => ({
        status: 'failed',
        billing_state: 'not_applicable',
        refund_state: 'refunded',
      }),
    });
    const id = await start(u);
    await tick(f.worker);
    await tick(f.worker);
    assert.equal((await task(id)).status, 'failed');
    assert.equal(
      (await one(pool, 'SELECT state FROM usage_ledger WHERE task_id=$1', [id]))
        .state,
      'released',
    );
    const bad = fixture({
      job: async () => ({ status: 'succeeded', billing_state: 'charged' }),
    });
    const id2 = await start(u, { action: 'search', style_id: 'college' });
    await tick(bad.worker);
    await tick(bad.worker);
    assert.equal((await task(id2)).status, 'unconfirmed');
  },
);
check(
  'cancelled accepted source job blocks automatic duplicate charges',
  async () => {
    const a = await user(),
      b = await user(),
      f = fixture();
    const id = await start(a);
    await tick(f.worker);
    await pool.query('UPDATE tasks SET cancel_requested_at=now() WHERE id=$1', [
      id,
    ]);
    await tick(f.worker);
    assert.equal((await task(id)).status, 'cancelled');
    const waiting = await start(b);
    await tick(f.worker);
    assert.equal((await task(waiting)).status, 'unconfirmed');
    assert.equal(f.calls.submit, 1);
  },
);
check(
  'note import stays on demand, preserves signed URL and reuses owner cache',
  async () => {
    const u = await user();
    let params;
    const f = fixture({
      submit: async (action, input) => {
        assert.equal(action, 'note');
        params = input;
        return { http_status: 202, job_id: 'job_note', request_id: 'req_note' };
      },
      job: async () => ({
        status: 'succeeded',
        results: note,
        billing_state: 'charged',
      }),
    });
    const url = `https://www.xiaohongshu.com/explore/${note.id}?xsec_token=required`;
    const id = await start(u, { action: 'note', style_id: 'city', url });
    await tick(f.worker);
    await tick(f.worker);
    assert.equal(params.url, url);
    assert.equal((await task(id)).result.data[0].is_summary, false);
    const cached = await start(u, { action: 'note', style_id: 'city', url });
    assert.equal((await task(cached)).status, 'succeeded');
  },
);

check(
  'Agent Custom Tool persists a child task, resumes with images, and repeated events never charge twice',
  async () => {
    const u = await user(),
      parentId = randomUUID(),
      session = { qoder_session_id: 'sess_inspiration_fixture' };
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling','{}')",
      [parentId, u.id],
    );
    const parent = await claimTask(pool);
    await pool.query(
      "UPDATE tasks SET next_run_at=now()+interval '1 hour' WHERE id=$1",
      [parentId],
    );
    const f = fixture();
    const sent = [];
    f.worker.qoder = {
      sendToolResult: async (...args) => {
        sent.push(args);
        return { id: 'evt_returned' };
      },
    };
    const call = {
      id: 'evt_search',
      name: 'search_inspirations',
      input: { style_id: 'city' },
    };
    assert.equal(await f.worker.tool(parent, session, call), false);
    assert.equal(await f.worker.tool(parent, session, call), false);
    assert.equal(
      (
        await one(
          pool,
          "SELECT count(*)::int AS n FROM tasks WHERE type='inspiration'",
        )
      ).n,
      1,
    );
    await tick(f.worker);
    await tick(f.worker);
    await f.worker.tool(parent, session, call);
    await f.worker.tool(parent, session, call);
    assert.equal(sent.length, 1);
    assert.equal(f.calls.submit, 1);
    assert.equal(sent[0][1], 'evt_search');
    assert.equal(sent[0][2].kind, 'inspiration_result');
    assert.equal(sent[0][2].data[0].images.length, 1);
    const publicResult = publicAgentEvent(
      {
        id: 'evt_result',
        type: 'user.custom_tool_result',
        custom_tool_use_id: call.id,
        content: [{ type: 'text', text: JSON.stringify(sent[0][2]) }],
      },
      call.name,
    );
    assert.equal(
      JSON.parse(publicResult.content[0].text).data[0].images[0],
      note.images[0],
    );
    const fromUI = await start(u);
    assert.equal((await task(fromUI)).result.cached, true);
    assert.equal(f.calls.submit, 1);
    await f.worker.tool(parent, session, {
      id: 'evt_bad',
      name: 'search_inspirations',
      input: { style_id: 'city', user_id: randomUUID() },
    });
    assert.equal(sent.at(-1)[3], true);
    assert.equal(sent.at(-1)[2].error.code, 'invalid_tool_input');
  },
);
check(
  'Agent style lookup works without data provider; missing source key reports a truthful tool error',
  async () => {
    const u = await user(),
      parentId = randomUUID(),
      session = { qoder_session_id: 'sess_no_source' };
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling','{}')",
      [parentId, u.id],
    );
    const parent = await claimTask(pool),
      sent = [];
    const w = new Worker({
      pool,
      config: { ...config, inspirationEnabled: false },
      qoder: {
        sendToolResult: async (...args) => {
          sent.push(args);
          return { id: 'evt_return' };
        },
      },
    });
    await w.tool(parent, session, {
      id: 'evt_style',
      name: 'get_style_definition',
      input: { style_id: 'french' },
    });
    assert.equal(sent[0][2].data[0].id, 'french');
    assert.equal(sent[0][3], false);
    await w.tool(parent, session, {
      id: 'evt_search',
      name: 'search_inspirations',
      input: { style_id: 'french' },
    });
    assert.equal(sent[1][3], true);
    assert.equal(sent[1][2].error.code, 'inspiration_unconfigured');
    assert.equal(
      (
        await one(
          pool,
          "SELECT count(*)::int AS n FROM tasks WHERE type='inspiration'",
        )
      ).n,
      0,
    );
  },
);

check(
  'Agent loop yields for slow source work, then completes a research-only turn without inventing an outfit',
  async () => {
    const u = await user(),
      id = randomUUID();
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling',$3)",
      [
        id,
        u.id,
        { message: '找法式穿搭图片', draft: { scene: 'daily', slots: {} } },
      ],
    );
    await pool.query(
      'INSERT INTO agent_sessions(task_id,owner_id,qoder_session_id,agent_version) VALUES($1,$2,$3,1)',
      [id, u.id, 'sess_loop'],
    );
    const history = [
      {
        id: 'evt_user',
        type: 'user.message',
        content: [{ type: 'text', text: '找法式穿搭图片' }],
      },
      {
        id: 'evt_search',
        type: 'agent.custom_tool_use',
        name: 'search_inspirations',
        input: { style_id: 'french' },
      },
      {
        id: 'evt_wait',
        type: 'session.status_idle',
        stop_reason: { type: 'requires_action', event_ids: ['evt_search'] },
      },
    ];
    let returns = 0;
    const f = fixture();
    f.worker.qoder = {
      connectEvents: async () => ({
        events: (async function* () {})(),
        close() {},
      }),
      sendToolResult: async (_session, callId, result) => {
        returns++;
        history.push(
          {
            id: 'evt_result',
            type: 'user.custom_tool_result',
            custom_tool_use_id: callId,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          },
          {
            id: 'evt_end',
            type: 'session.status_idle',
            stop_reason: { type: 'end_turn' },
          },
        );
        return { id: 'evt_result' };
      },
    };
    f.worker.history = async () => history;
    await f.worker.runOnce();
    assert.equal((await task(id)).stage, 'finding_inspiration');
    assert.equal(f.calls.submit, 0);
    for (let n = 0; n < 12 && (await task(id)).status !== 'succeeded'; n++) {
      await pool.query(
        "WITH due AS (SELECT min(next_run_at) AS at FROM tasks WHERE status IN ('queued','waiting_tools','running')) UPDATE tasks SET next_run_at=next_run_at-GREATEST((SELECT at FROM due)-now(),interval '0') WHERE status IN ('queued','waiting_tools','running')",
      );
      await f.worker.runOnce();
    }
    const result = await task(id);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.result.kind, 'inspiration_result');
    assert.equal(result.candidate, null);
    assert.equal(returns, 1);
    assert.equal(f.calls.submit, 1);
  },
);
check(
  'cancelling an Agent turn before source dispatch also cancels its queued source task',
  async () => {
    const u = await user(),
      id = randomUUID(),
      session = { qoder_session_id: 'sess_cancel_source' };
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling','{}')",
      [id, u.id],
    );
    const parent = await claimTask(pool),
      f = fixture();
    assert.equal(
      await f.worker.tool(parent, session, {
        id: 'evt_search',
        name: 'search_inspirations',
        input: { style_id: 'city' },
      }),
      false,
    );
    await pool.query(
      "UPDATE tasks SET status='cancelled',cancel_requested_at=now() WHERE id=$1",
      [id],
    );
    await f.worker.runOnce();
    assert.equal(f.calls.submit, 0);
    assert.equal(
      (await one(pool, "SELECT status FROM tasks WHERE type='inspiration'"))
        .status,
      'cancelled',
    );
  },
);

check(
  'Agent turn enforces a three-query budget before dispatch and cached page requests do not consume daily source quota',
  async () => {
    const u = await user(),
      id = randomUUID(),
      session = { qoder_session_id: 'sess_budget' },
      sent = [];
    const f = fixture();
    await start(u);
    await tick(f.worker);
    await tick(f.worker);
    for (let n = 0; n < 21; n++)
      assert.equal((await task(await start(u))).status, 'succeeded');
    assert.equal(
      (await task(await start(u, { action: 'search', style_id: 'soft' })))
        .status,
      'queued',
    );
    await pool.query(
      "UPDATE tasks SET status='cancelled' WHERE status='queued'",
    );
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling','{}')",
      [id, u.id],
    );
    const parent = await claimTask(pool);
    f.worker.qoder = {
      sendToolResult: async (...args) => {
        sent.push(args);
        return { id: 'evt_result' };
      },
    };
    for (const [i, style_id] of ['french', 'denim', 'sport'].entries())
      assert.equal(
        await f.worker.tool(parent, session, {
          id: 'evt_search_' + i,
          name: 'search_inspirations',
          input: { style_id },
        }),
        false,
      );
    await f.worker.tool(parent, session, {
      id: 'evt_search_four',
      name: 'search_inspirations',
      input: { style_id: 'earth' },
    });
    assert.equal(sent.at(-1)[2].error.code, 'inspiration_turn_limit');
    assert.equal(f.calls.submit, 1);
  },
);

check(
  'Taobao Custom Tool returns products with images and correct per-call cost, separately capped and cached',
  async () => {
    const u = await user(),
      id = randomUUID(),
      session = { qoder_session_id: 'sess_taobao' },
      sent = [];
    await pool.query(
      "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'styling','{}')",
      [id, u.id],
    );
    const parent = await claimTask(pool);
    await pool.query(
      "UPDATE tasks SET next_run_at=now()+interval '1 hour' WHERE id=$1",
      [id],
    );
    const f = fixture({
      submit: async (action, params, platform) => {
        assert.equal(platform, 'taobao');
        assert.equal(action, 'search');
        assert.deepEqual(params, { keyword: '白色衬衫', limit: 5 });
        return {
          http_status: 202,
          job_id: 'job_product',
          request_id: 'req_product',
        };
      },
      job: async () => ({
        status: 'succeeded',
        results: [
          {
            id: '637637661300',
            title: '白衬衫',
            price: 49.9,
            currency: 'CNY',
            price_basis: 'page',
            image_url: 'https://img.alicdn.com/fixture.jpg',
          },
        ],
        billing_state: 'charged',
        billing: { charged_usd: 0.0135 },
      }),
    });
    f.worker.config = { ...config, productSearchLimit: 1 };
    f.worker.qoder = {
      sendToolResult: async (...args) => {
        sent.push(args);
        return { id: 'evt_result' };
      },
    };
    const call = {
      id: 'evt_product',
      name: 'search_products',
      input: { keyword: '白色衬衫' },
    };
    assert.equal(await f.worker.tool(parent, session, call), false);
    await tick(f.worker);
    await tick(f.worker);
    await f.worker.tool(parent, session, call);
    await f.worker.tool(parent, session, call);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][2].kind, 'product_search_result');
    assert.equal(sent[0][2].data[0].price_basis, 'page');
    assert.equal(sent[0][2].data[0].owned, false);
    const source = await one(
      pool,
      "SELECT * FROM tasks WHERE type='inspiration'",
    );
    assert.ok(
      validateTask((await request(u, 'GET', '/tasks/' + source.id)).json()),
      JSON.stringify(validateTask.errors),
    );
    const usage = await one(pool, 'SELECT * FROM inspiration_usage');
    assert.equal(usage.taobao_search_count, 1);
    assert.equal(usage.search_count, 0);
    const ledger = await one(
      pool,
      'SELECT * FROM usage_ledger WHERE task_id=$1',
      [source.id],
    );
    assert.equal(Number(ledger.reserved), 0.0135);
    assert.equal(Number(ledger.settled), 0.0135);
    const cached = await transaction(pool, (db) =>
      enqueueInspiration(db, productInput(call.input, u.id), u.id, config),
    );
    assert.equal(cached.status, 'succeeded');
    const another = await transaction(pool, (db) =>
      enqueueInspiration(
        db,
        productInput({ keyword: '蓝衬衫' }, u.id),
        u.id,
        config,
      ),
    );
    await tick(f.worker);
    assert.equal(
      (await task(another.task_id)).error.code,
      'inspiration_budget_exceeded',
    );
  },
);
