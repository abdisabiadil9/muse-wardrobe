import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createApp } from '../../apps/api/app.mjs';
import { Worker } from '../../apps/worker/runtime.mjs';
import {
  migrate,
  one,
  all,
  claimTask,
  fenced,
  digest,
} from '../../packages/db/index.mjs';
import {
  syncMemoryJobs,
  reconcileDream,
} from '../../packages/qoder/memory.mjs';

const database = process.env.TEST_DATABASE_URL;
const enabled = Boolean(database);
let admin, pool, app, folder, picture, taskSchema;
const schema = 'test_' + randomUUID().replaceAll('-', '');
const origin = 'http://localhost:5179';
const config = {
  devAuth: true,
  allowTestIdentityHeader: true,
  appOrigin: origin,
  sessionSecret: 'test-only-secret-at-least-32-characters',
  stylingEnabled: true,
  tryonEnabled: true,
  memoryEnabled: true,
  arkModel: 'test-model',
  dailyTaskLimit: 100,
};
before(async () => {
  if (!enabled) return;
  admin = new pg.Pool({ connectionString: database });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({
    connectionString: database,
    options: `-c search_path=${schema}`,
  });
  await migrate(pool);
  folder = await mkdtemp(join(tmpdir(), 'muse-backend-test-'));
  app = await createApp({ pool, ...config, mediaRoot: folder });
  picture = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#ddeeff' },
  })
    .png()
    .toBuffer();
  const contract = JSON.parse(
    await readFile(
      new URL('../../docs/contracts/openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  taskSchema = ajv.compile({
    $ref: '#/components/schemas/Task',
    components: contract.components,
  });
});
after(async () => {
  if (!enabled) return;
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  await rm(folder, { recursive: true, force: true });
});
const check = (name, fn) => test(name, { skip: !enabled }, fn);
async function user() {
  const id = randomUUID(),
    r = await app.inject({
      url: '/api/v1/me',
      headers: { 'x-test-user-id': id },
    });
  assert.equal(r.statusCode, 200, r.body);
  return {
    id,
    cookie: r.headers['set-cookie'].split(';')[0],
    csrf: r.json().csrf_token,
  };
}
function request(u, method, url, body, key) {
  return app.inject({
    method,
    url: '/api/v1' + url,
    headers: {
      cookie: u.cookie,
      origin,
      'x-csrf-token': u.csrf,
      ...(key ? { 'idempotency-key': key } : {}),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}
async function asset(u, kind = 'garment') {
  const up = await request(
    u,
    'POST',
    '/media/uploads',
    { kind, mime: 'image/png', bytes: picture.length },
    randomUUID(),
  );
  assert.equal(up.statusCode, 201, up.body);
  const b = up.json();
  const sent = await app.inject({
    method: 'PUT',
    url: b.upload_url,
    headers: { cookie: u.cookie, origin, 'content-type': 'image/png' },
    payload: picture,
  });
  assert.equal(sent.statusCode, 204, sent.body);
  const ready = await request(
    u,
    'POST',
    `/media/${b.asset_id}/complete`,
    { sha256: digest(picture) },
    randomUUID(),
  );
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().status, 'ready');
  return ready.json();
}
async function garment(u, category = 'top') {
  const a = await asset(u);
  const r = await request(
    u,
    'POST',
    '/garments',
    { name: '测试衣物', category, image_asset_id: a.id, source: 'upload' },
    randomUUID(),
  );
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function draft(u, garments) {
  const get = await request(u, 'GET', '/outfit-drafts/daily');
  const d = get.json();
  const slots = Object.fromEntries(
    garments.map((g) => [
      g.category,
      {
        source: 'wardrobe',
        ref_id: g.id,
        asset_id: g.image_asset_id,
        locked: false,
      },
    ]),
  );
  const r = await request(u, 'PATCH', '/outfit-drafts/daily', {
    expected_revision: d.revision,
    slots,
    canvas_layout: {},
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function stylingTask(u, d) {
  const r = await request(
    u,
    'POST',
    '/styling-tasks',
    {
      draft_id: d.id,
      draft_revision: d.revision,
      intent: 'style',
      occasion: '周末',
    },
    randomUUID(),
  );
  assert.equal(r.statusCode, 202, r.body);
  return r.json().task_id;
}
function worker(qoder, seedream) {
  return new Worker({
    pool,
    media: app.media,
    qoder,
    seedream,
    config: {
      agentId: 'agent_test',
      agentVersion: 1,
      environmentId: 'env_test',
      maxCreditCost: '1.00',
      turnTimeoutMs: 3000,
    },
  });
}
function validateTask(value) {
  assert.equal(taskSchema(value), true, JSON.stringify(taskSchema.errors));
}

check(
  'native agent event read-through preserves links, isolates owners and advances hidden-event cursors',
  async () => {
    const a = await user(),
      b = await user();
    const d = (await request(a, 'GET', '/outfit-drafts/daily')).json();
    const task = await stylingTask(a, d);
    await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [task]);
    const path = `/tasks/${task}/agent-events`;
    assert.deepEqual((await request(a, 'GET', path)).json(), {
      data: [],
      next_cursor: null,
    });
    assert.equal((await request(b, 'GET', path)).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/v1${path}` })).statusCode, 401);
    await pool.query(
      'INSERT INTO agent_sessions(task_id,owner_id,qoder_session_id,agent_version) VALUES($1,$2,$3,1)',
      [task, a.id, 'sess_' + task],
    );
    const events = [
      {
        id: 'evt_01',
        type: 'user.message',
        content: [{ type: 'text', text: '周末怎么穿' }],
      },
      { id: 'evt_02', type: 'agent.thinking', text: 'hidden reasoning' },
      {
        id: 'evt_03',
        type: 'agent.custom_tool_use',
        name: 'read_wardrobe',
        input: { category: 'top', api_key: 'private-key' },
        credentials: 'private-auth',
      },
      {
        id: 'evt_04',
        type: 'user.custom_tool_result',
        custom_tool_use_id: 'evt_03',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              garments: [{ name: '衬衫', token: 'private-token' }],
            }),
          },
        ],
        is_error: false,
      },
      {
        id: 'evt_05',
        type: 'agent.tool_use',
        name: 'Read',
        input: { file_path: '/data/.qoder/awareness/preferences/profile.md' },
      },
      {
        id: 'evt_06',
        type: 'agent.tool_result',
        tool_use_id: 'evt_05',
        content: [{ type: 'text', text: 'private memory contents' }],
        is_error: false,
      },
      {
        id: 'evt_07',
        type: 'agent.message',
        content: [
          { type: 'thinking', text: 'hidden block' },
          { type: 'text', text: '建议穿衬衫' },
        ],
        raw_reasoning: 'private thoughts',
      },
      {
        id: 'evt_08',
        type: 'session.status_idle',
        stop_reason: { type: 'end_turn', debug_token: 'private-debug' },
      },
      {
        id: 'evt_09',
        type: 'future.private_event',
        credentials: 'private-key',
      },
    ];
    for (const [i, event] of events.entries())
      await pool.query(
        "INSERT INTO agent_events(session_id,event_id,payload,received_at) VALUES($1,$2,$3,'2026-11-17T01:00:00Z'::timestamptz+($4*interval '1 microsecond'))",
        ['sess_' + task, event.id, event, i],
      );
    const pages = [];
    let cursor;
    for (let i = 0; i < 3; i++) {
      const response = await request(
        a,
        'GET',
        path + '?limit=3' + (cursor ? `&after=${cursor}` : ''),
      );
      assert.equal(response.statusCode, 200, response.body);
      pages.push(...response.json().data);
      cursor = response.json().next_cursor;
    }
    assert.equal(cursor, 'evt_09');
    assert.deepEqual(
      pages.map((e) => e.id),
      ['evt_01', 'evt_03', 'evt_04', 'evt_05', 'evt_06', 'evt_07', 'evt_08'],
    );
    assert.equal(pages[2].custom_tool_use_id, 'evt_03');
    assert.equal(pages[4].tool_use_id, 'evt_05');
    assert.equal(pages[4].content, undefined);
    assert.deepEqual(pages[5].content, [{ type: 'text', text: '建议穿衬衫' }]);
    assert.deepEqual(pages[6].stop_reason, { type: 'end_turn' });
    assert.doesNotMatch(
      JSON.stringify(pages),
      /private-|hidden|raw_reasoning|api_key|file_path/,
    );
    assert.deepEqual(
      (await request(a, 'GET', path + '?after=' + cursor)).json(),
      { data: [], next_cursor: cursor },
    );
    assert.deepEqual(
      (await request(a, 'GET', path + '?after=evt_02&limit=1'))
        .json()
        .data.map((e) => e.id),
      ['evt_03'],
    );
    for (const query of [
      '?after=evt_other_session',
      '?after=not-an-event',
      '?limit=0',
      '?limit=101',
      '?limit=1.5',
      '?limit=abc',
    ])
      assert.equal(
        (await request(a, 'GET', path + query)).statusCode,
        400,
        query,
      );
    // Cursor checks are scoped to the bound session, even when another event exists.
    await pool.query(
      'INSERT INTO agent_events(session_id,event_id,payload) VALUES($1,$2,$3)',
      [
        'sess_other',
        'evt_foreign',
        { id: 'evt_foreign', type: 'agent.message', content: [] },
      ],
    );
    assert.equal(
      (await request(a, 'GET', path + '?after=evt_foreign')).statusCode,
      400,
    );
    assert.equal(
      (
        await one(
          pool,
          'SELECT count(*)::int AS n FROM provider_operations WHERE task_id=$1',
          [task],
        )
      ).n,
      0,
    );
  },
);

check(
  'private media, owner isolation, CSRF and revision conflicts use real PostgreSQL',
  async () => {
    const a = await user(),
      b = await user(),
      g = await garment(a),
      d = await draft(a, [g]);
    const forbidden = await request(b, 'GET', `/garments/${g.id}`);
    assert.equal(forbidden.statusCode, 404);
    assert.equal(
      (await request(b, 'GET', `/media/${g.image_asset_id}`)).statusCode,
      404,
    );
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/v1/outfit-drafts/daily',
      headers: { cookie: a.cookie, origin },
      payload: {
        expected_revision: d.revision,
        slots: d.slots,
        canvas_layout: {},
      },
    });
    assert.equal(bad.statusCode, 403);
    const conflict = await request(a, 'PATCH', '/outfit-drafts/daily', {
      expected_revision: d.revision - 1,
      slots: d.slots,
      canvas_layout: {},
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.details.current_revision, d.revision);
    const image = await request(a, 'GET', `/media/${g.image_asset_id}`);
    const bytes = await app.inject({
      url: image.json().download_url,
      headers: { cookie: a.cookie },
    });
    assert.equal(bytes.statusCode, 200);
    assert.equal(bytes.headers['content-type'], 'image/png');
    const unauth = await app.inject({ url: image.json().download_url });
    assert.equal(unauth.statusCode, 401);
  },
);

check(
  'concurrent idempotency returns one saved outfit; changed body conflicts',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      key = randomUUID(),
      body = { draft_id: d.id, draft_revision: d.revision };
    const results = await Promise.all([
      request(u, 'POST', '/outfits', body, key),
      request(u, 'POST', '/outfits', body, key),
    ]);
    assert.equal(results[0].statusCode, 201, results[0].body);
    assert.equal(results[0].json().id, results[1].json().id);
    assert.equal(
      (
        await request(
          u,
          'POST',
          '/outfits',
          { ...body, worn_date: '2026-11-16' },
          key,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await one(
          pool,
          'SELECT count(*)::int AS n FROM outfit_versions WHERE owner_id=$1',
          [u.id],
        )
      ).n,
      1,
    );
  },
);

check(
  'task lease fencing rejects the stale worker after a reclaim',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      id = await stylingTask(u, d);
    const first = await claimTask(pool);
    assert.equal(first.id, id);
    await pool.query(
      "UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    const second = await claimTask(pool);
    assert.equal(second.id, id);
    assert.notEqual(first.lease_token, second.lease_token);
    await assert.rejects(
      () =>
        fenced(pool, first, (db) =>
          db.query("UPDATE tasks SET status='succeeded' WHERE id=$1", [id]),
        ),
      (e) => e.code === 'lease_lost',
    );
    await fenced(pool, second, (db) =>
      db.query(
        "UPDATE tasks SET status='cancelled',lease_until=NULL WHERE id=$1",
        [id],
      ),
    );
  },
);

check(
  'Qoder tools persist a proposal and reconcile lost result response without duplicate execution',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      id = await stylingTask(u, d);
    const q = new FakeQoder([g.id], { loseToolResult: true });
    await worker(q).runOnce();
    const result = (await request(u, 'GET', `/tasks/${id}`)).json();
    validateTask(result);
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.equal(result.result.slots.top.ref_id, g.id);
    assert.equal(
      q.toolResults.filter((x) => x.call === 'evt_proposal').length,
      1,
    );
    const calls = await all(
      pool,
      'SELECT * FROM tool_calls WHERE owner_id=$1',
      [u.id],
    );
    assert.equal(calls.length, 2);
    assert(calls.every((c) => c.state === 'returned'));
    assert.equal(
      (await one(pool, 'SELECT slots FROM outfit_drafts WHERE id=$1', [d.id]))
        .slots.top.ref_id,
      g.id,
    );
  },
);

check(
  'unknown Session creation remains unconfirmed and is never blindly duplicated',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      id = await stylingTask(u, d);
    let count = 0;
    const q = {
      async createSession() {
        count++;
        const e = new Error('lost');
        e.uncertain = true;
        e.code = 'write_unconfirmed';
        throw e;
      },
      async listSessions() {
        return { data: [] };
      },
    };
    await worker(q).runOnce();
    await worker(q).runOnce();
    assert.equal(count, 1);
    const t = (await request(u, 'GET', `/tasks/${id}`)).json();
    assert.equal(t.status, 'unconfirmed');
    validateTask(t);
  },
);

check(
  'Qoder proposal cannot use another user garment and end_turn without candidate fails',
  async () => {
    const a = await user(),
      b = await user(),
      ga = await garment(a),
      gb = await garment(b),
      d = await draft(a, [ga]),
      id = await stylingTask(a, d);
    const q = new FakeQoder([gb.id]);
    await worker(q).runOnce();
    const t = (await request(a, 'GET', `/tasks/${id}`)).json();
    assert.equal(t.status, 'failed');
    assert.equal(t.result, null);
    assert.equal(q.toolResults.at(-1).isError, true);
    validateTask(t);
  },
);

check(
  'tryon is immutable, checkpoints output, and retries only download after transient failure',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      person = await asset(u, 'person');
    let calls = 0,
      downloads = 0;
    const r = await request(
      u,
      'POST',
      '/tryon-tasks',
      {
        draft_id: d.id,
        draft_revision: d.revision,
        person_asset_id: person.id,
        consent_version: 'tryon-photo-v1',
        mode: 'single',
        target_slot: 'top',
      },
      randomUUID(),
    );
    assert.equal(r.statusCode, 202, r.body);
    const id = r.json().task_id;
    const adapter = {
      async generate(input) {
        calls++;
        assert.equal(input.snapshot.draft_revision, d.revision);
        return {
          model: 'test-model',
          prompt_version: 'test-v1',
          b64_json: picture.toString('base64'),
        };
      },
      async downloadResult() {
        downloads++;
        if (downloads === 1) {
          const e = new Error('download failed');
          e.outcome = 'download_failed';
          throw e;
        }
        return { bytes: picture, mime: 'image/png' };
      },
    };
    const w = worker(null, adapter);
    await w.runOnce();
    assert.equal(
      (await one(pool, 'SELECT stage FROM tasks WHERE id=$1', [id])).stage,
      'persisting',
    );
    await pool.query('UPDATE tasks SET next_run_at=now() WHERE id=$1', [id]);
    await w.runOnce();
    assert.equal(calls, 1);
    assert.equal(downloads, 2);
    const t = (await request(u, 'GET', `/tasks/${id}`)).json();
    validateTask(t);
    assert.equal(t.status, 'succeeded', JSON.stringify(t));
    assert.equal(t.result.mode, 'single');
    assert.equal(t.result.person_asset_id, person.id);
    assert.equal(t.result.slots.top.ref_id, g.id);
    assert.equal(t.result.result_asset.status, 'ready');
    assert.equal(
      (await request(u, 'DELETE', `/media/${person.id}`)).statusCode,
      204,
    );
    const deleted = (
      await request(u, 'GET', `/media/${t.result.result_asset.id}`)
    ).json();
    assert.equal(deleted.status, 'deleting');
    assert.equal(deleted.download_url, undefined);
    const download = await app.inject({
      url: t.result.result_asset.download_url,
      headers: { cookie: u.cookie },
    });
    assert.equal(download.statusCode, 422);
  },
);

check(
  'tryon POST response loss freezes the task without a second generation',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      person = await asset(u, 'person');
    const r = await request(
      u,
      'POST',
      '/tryon-tasks',
      {
        draft_id: d.id,
        draft_revision: d.revision,
        person_asset_id: person.id,
        consent_version: 'tryon-photo-v1',
        mode: 'outfit',
      },
      randomUUID(),
    );
    let calls = 0;
    const adapter = {
      async generate() {
        calls++;
        const e = new Error('unknown');
        e.outcome = 'unknown';
        e.code = 'generation_unknown';
        throw e;
      },
    };
    const w = worker(null, adapter);
    await w.runOnce();
    await w.runOnce();
    assert.equal(calls, 1);
    const t = (await request(u, 'GET', `/tasks/${r.json().task_id}`)).json();
    assert.equal(t.status, 'unconfirmed');
    validateTask(t);
  },
);

check(
  'Memory sync keeps consent and Dream promotion replays current feedback before switching store',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]);
    const out = (
      await request(
        u,
        'POST',
        '/outfits',
        { draft_id: d.id, draft_revision: d.revision },
        randomUUID(),
      )
    ).json();
    await pool.query(
      'INSERT INTO memory_bindings(owner_id,active_store_id) VALUES($1,$2)',
      [u.id, 'memstore_original'],
    );
    const f = (
      await request(
        u,
        'POST',
        '/wear-feedback',
        {
          outfit_version_id: out.id,
          actually_worn: true,
          comment: '袖口偏紧',
          consent_to_memory: true,
        },
        randomUUID(),
      )
    ).json();
    assert.equal(f.memory_sync_status, 'queued');
    const q = new FakeMemory();
    await syncMemoryJobs({ pool, client: q });
    assert(
      [...q.stores.get('memstore_original').values()].some((m) =>
        m.content.includes('袖口偏紧'),
      ),
    );
    const taskId = await stylingTask(u, d);
    await pool.query("UPDATE tasks SET status='succeeded' WHERE id=$1", [
      taskId,
    ]);
    await pool.query(
      'INSERT INTO agent_sessions(task_id,owner_id,qoder_session_id,agent_version,memory_store_id) VALUES($1,$2,$3,1,$4)',
      [taskId, u.id, 'sess_memory', 'memstore_original'],
    );
    const jobId = randomUUID();
    await pool.query(
      "INSERT INTO dream_jobs(id,owner_id,input_store_id,input_generation,feedback_watermark,session_ids,provider_id,status) VALUES($1,$2,'memstore_original',0,0,$3,'drm_test','running')",
      [jobId, u.id, JSON.stringify(['sess_memory'])],
    );
    await request(u, 'DELETE', `/wear-feedback/${f.id}`);
    await request(u, 'PATCH', '/preferences', {
      expected_revision: 0,
      preferred_styles: ['简洁'],
    });
    q.stores.set('memstore_clone', new Map(q.stores.get('memstore_original')));
    const result = await reconcileDream({
      pool,
      client: q,
      jobId,
      verifyIsolation: true,
    });
    assert.equal(result.status, 'promoted');
    const binding = await one(
      pool,
      'SELECT * FROM memory_bindings WHERE owner_id=$1',
      [u.id],
    );
    assert.equal(binding.generation, 1);
    assert.equal(binding.active_store_id, 'memstore_clone');
    assert(
      ![...q.stores.get('memstore_clone').values()].some((m) =>
        m.content.includes('袖口偏紧'),
      ),
    );
    assert(
      [...q.stores.get('memstore_clone').values()].some((m) =>
        m.content.includes('简洁'),
      ),
    );
    assert.equal(
      (await reconcileDream({ pool, client: q, jobId, verifyIsolation: true }))
        .status,
      'promoted',
    );
    assert.equal(
      (await one(pool, 'SELECT status FROM dream_jobs WHERE id=$1', [jobId]))
        .status,
      'promoted',
    );
  },
);

check(
  'a cancellation after the result file is written cannot publish or retain the generated asset',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      person = await asset(u, 'person');
    const r = await request(
      u,
      'POST',
      '/tryon-tasks',
      {
        draft_id: d.id,
        draft_revision: d.revision,
        person_asset_id: person.id,
        consent_version: 'tryon-photo-v1',
        mode: 'outfit',
      },
      randomUUID(),
    );
    const id = r.json().task_id;
    const media = Object.create(app.media);
    media.put = async (...args) => {
      const value = await app.media.put(...args);
      const cancel = await request(
        u,
        'POST',
        `/tasks/${id}/cancel`,
        undefined,
        randomUUID(),
      );
      assert.equal(cancel.statusCode, 202, cancel.body);
      return value;
    };
    const w = new Worker({
      pool,
      media,
      seedream: {
        async generate() {
          return { model: 'test-model' };
        },
        async downloadResult() {
          return { bytes: picture, mime: 'image/png' };
        },
      },
    });
    await w.runOnce();
    const t = (await request(u, 'GET', `/tasks/${id}`)).json();
    assert.equal(t.status, 'cancelled');
    assert.equal(t.result, null);
    assert.equal(
      (
        await one(
          pool,
          "SELECT count(*)::int AS n FROM media_assets WHERE owner_id=$1 AND kind='tryon_result'",
          [u.id],
        )
      ).n,
      0,
    );
  },
);

check(
  'invalid generated response survives a crash as unconfirmed and never re-dispatches',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      person = await asset(u, 'person');
    const r = await request(
      u,
      'POST',
      '/tryon-tasks',
      {
        draft_id: d.id,
        draft_revision: d.revision,
        person_asset_id: person.id,
        consent_version: 'tryon-photo-v1',
        mode: 'outfit',
      },
      randomUUID(),
    );
    const id = r.json().task_id;
    const claimed = await claimTask(pool);
    let sends = 0;
    const w = worker();
    await assert.rejects(() =>
      w.operation(
        claimed,
        `generation:${id}`,
        'ark',
        'image_generation',
        {},
        async () => {
          sends++;
          const e = new Error('invalid 200');
          e.outcome = 'invalid_response';
          e.code = 'invalid_response';
          throw e;
        },
      ),
    );
    assert.equal(
      (
        await one(
          pool,
          'SELECT state FROM provider_operations WHERE task_id=$1',
          [id],
        )
      ).state,
      'unconfirmed',
    );
    await pool.query(
      "UPDATE tasks SET lease_until=now()-interval '1 second',next_run_at=now() WHERE id=$1",
      [id],
    );
    const recovery = worker(null, {
      async generate() {
        sends++;
        throw new Error('must not dispatch');
      },
    });
    await recovery.runOnce();
    assert.equal(sends, 1);
    assert.equal(
      (await one(pool, 'SELECT status FROM tasks WHERE id=$1', [id])).status,
      'unconfirmed',
    );
  },
);

check(
  'feedback deletion waits for an in-flight memory write then enqueues a durable deletion',
  async () => {
    await pool.query("UPDATE memory_sync_jobs SET state='done'");
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]);
    const outfit = (
      await request(
        u,
        'POST',
        '/outfits',
        { draft_id: d.id, draft_revision: d.revision },
        randomUUID(),
      )
    ).json();
    await pool.query(
      "INSERT INTO memory_bindings(owner_id,active_store_id) VALUES($1,'memstore_race')",
      [u.id],
    );
    const feedback = (
      await request(
        u,
        'POST',
        '/wear-feedback',
        {
          outfit_version_id: outfit.id,
          actually_worn: true,
          comment: 'race-sensitive-feedback',
          consent_to_memory: true,
        },
        randomUUID(),
      )
    ).json();
    const q = new FakeMemory();
    let enteredResolve, releaseResolve;
    const entered = new Promise((r) => (enteredResolve = r)),
      release = new Promise((r) => (releaseResolve = r));
    const create = q.createMemory.bind(q);
    q.createMemory = async (...args) => {
      enteredResolve();
      await release;
      return create(...args);
    };
    const syncing = syncMemoryJobs({ pool, client: q });
    await entered;
    let deletionDone = false;
    const deleting = request(u, 'DELETE', `/wear-feedback/${feedback.id}`).then(
      (r) => {
        deletionDone = true;
        return r;
      },
    );
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(deletionDone, false);
    releaseResolve();
    await syncing;
    assert.equal((await deleting).statusCode, 204);
    assert.equal(
      (
        await one(
          pool,
          'SELECT state FROM memory_sync_jobs WHERE owner_id=$1',
          [u.id],
        )
      ).state,
      'queued',
    );
    await syncMemoryJobs({ pool, client: q });
    assert.equal(
      [...q.store('memstore_race').values()].some((m) =>
        m.content.includes('race-sensitive-feedback'),
      ),
      false,
    );
  },
);

check(
  'frozen accounts cannot resume an old needs_input task or read its data',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      id = await stylingTask(u, d);
    await pool.query(
      "UPDATE tasks SET status='needs_input',question='test' WHERE id=$1",
      [id],
    );
    const deletion = await request(u, 'DELETE', '/me', undefined, randomUUID());
    assert.equal(deletion.statusCode, 202, deletion.body);
    assert.equal(
      (
        await request(
          u,
          'POST',
          `/tasks/${id}/messages`,
          { message: 'resume' },
          randomUUID(),
        )
      ).statusCode,
      409,
    );
    assert.equal((await request(u, 'GET', `/tasks/${id}`)).statusCode, 409);
    assert.equal(
      (await request(u, 'GET', `/tasks/${deletion.json().task_id}`)).statusCode,
      200,
    );
    await pool.query("UPDATE tasks SET status='cancelled' WHERE owner_id=$1", [
      u.id,
    ]);
  },
);

check(
  'a queued generation cannot silently switch its pinned model',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      person = await asset(u, 'person');
    const r = await request(
      u,
      'POST',
      '/tryon-tasks',
      {
        draft_id: d.id,
        draft_revision: d.revision,
        person_asset_id: person.id,
        consent_version: 'tryon-photo-v1',
        mode: 'outfit',
      },
      randomUUID(),
    );
    let calls = 0;
    await worker(null, {
      model: 'changed-model',
      async generate() {
        calls++;
      },
    }).runOnce();
    assert.equal(calls, 0);
    const t = (await request(u, 'GET', `/tasks/${r.json().task_id}`)).json();
    assert.equal(t.status, 'failed');
    assert.equal(t.error.code, 'model_version_changed');
  },
);

check(
  'Worker resumes paginated Qoder history after EOF without recreating Session or replaying user turn',
  async () => {
    const u = await user(),
      g = await garment(u),
      d = await draft(u, [g]),
      id = await stylingTask(u, d);
    const q = new FakeQoder([g.id], { pageSize: 2 });
    let connections = 0,
      sessions = 0,
      messages = 0;
    const connect = q.connectEvents.bind(q),
      create = q.createSession.bind(q),
      send = q.sendMessage.bind(q);
    q.connectEvents = async (...args) => {
      connections++;
      return connections === 1
        ? { events: (async function* () {})(), close() {} }
        : connect(...args);
    };
    q.createSession = async (...args) => {
      sessions++;
      return create(...args);
    };
    q.sendMessage = async (...args) => {
      messages++;
      return send(...args);
    };
    const w = worker(q);
    await w.runOnce();
    assert.equal(
      (await one(pool, 'SELECT stage FROM tasks WHERE id=$1', [id])).stage,
      'recovering',
    );
    await pool.query('UPDATE tasks SET next_run_at=now() WHERE id=$1', [id]);
    await w.runOnce();
    const t = (await request(u, 'GET', `/tasks/${id}`)).json();
    assert.equal(t.status, 'succeeded', JSON.stringify(t));
    assert.equal(sessions, 1);
    assert.equal(messages, 1);
    assert.equal(
      (
        await one(
          pool,
          'SELECT count(*)::int AS n FROM tool_calls WHERE owner_id=$1',
          [u.id],
        )
      ).n,
      2,
    );
  },
);

class FakeQoder {
  constructor(ids, options = {}) {
    this.ids = ids;
    this.options = options;
    this.events = [];
    this.queue = [];
    this.toolResults = [];
    this.closed = false;
    this.wake = null;
    this.n = 0;
  }
  push(event) {
    this.events.push(event);
    this.queue.push(event);
    this.wake?.();
    this.wake = null;
  }
  async createSession() {
    return { id: 'sess_' + randomUUID().replaceAll('-', '') };
  }
  async listEvents(_session, { page } = {}) {
    if (!this.options.pageSize) return { data: [...this.events] };
    const start = Number(page ?? 0),
      end = start + this.options.pageSize;
    return {
      data: this.events.slice(start, end),
      ...(end < this.events.length ? { next_page: String(end) } : {}),
    };
  }
  async connectEvents() {
    const self = this;
    return {
      events: (async function* () {
        while (!self.closed) {
          if (!self.queue.length) {
            await new Promise((r) => {
              self.wake = r;
            });
            if (self.closed) return;
          }
          while (self.queue.length) yield { data: self.queue.shift() };
        }
      })(),
      close() {
        self.closed = true;
        self.wake?.();
      },
    };
  }
  async sendMessage(_session, text) {
    this.push({
      id: 'evt_user',
      type: 'user.message',
      content: [{ type: 'text', text }],
    });
    this.push({
      id: 'evt_wardrobe',
      type: 'agent.custom_tool_use',
      name: 'read_wardrobe',
      input: {},
    });
    this.push({
      id: 'evt_idle_wardrobe',
      type: 'session.status_idle',
      stop_reason: { type: 'requires_action', event_ids: ['evt_wardrobe'] },
    });
    return { data: [{ id: 'evt_user' }] };
  }
  async sendToolResult(_session, call, result, isError) {
    this.toolResults.push({ call, result, isError });
    this.push({
      id: 'evt_result_' + ++this.n,
      type: 'user.custom_tool_result',
      custom_tool_use_id: call,
    });
    if (call === 'evt_wardrobe') {
      this.push({
        id: 'evt_proposal',
        type: 'agent.custom_tool_use',
        name: 'propose_outfit',
        input: { garment_ids: this.ids, reason: '适合周末' },
      });
      this.push({
        id: 'evt_idle_proposal',
        type: 'session.status_idle',
        stop_reason: { type: 'requires_action', event_ids: ['evt_proposal'] },
      });
    } else
      this.push({
        id: 'evt_ended',
        type: 'session.status_idle',
        stop_reason: { type: 'end_turn' },
      });
    if (this.options.loseToolResult && call === 'evt_proposal') {
      const e = new Error('response lost');
      e.uncertain = true;
      e.code = 'write_unconfirmed';
      throw e;
    }
    return { data: [{ id: 'evt_result_' + this.n }] };
  }
  async cancelSession() {
    this.push({
      id: 'evt_cancelled',
      type: 'session.status_idle',
      stop_reason: { type: 'end_turn' },
    });
    return {};
  }
}
class FakeMemory {
  constructor() {
    this.stores = new Map();
    this.n = 0;
  }
  store(id) {
    if (!this.stores.has(id)) this.stores.set(id, new Map());
    return this.stores.get(id);
  }
  async listMemories(id) {
    return {
      data: [...this.store(id).values()].map(({ id, path }) => ({ id, path })),
    };
  }
  async createMemory(store, { path, content }) {
    const id = 'mem_' + ++this.n,
      m = { id, path, content, content_sha256: digest(content) };
    this.store(store).set(id, m);
    return m;
  }
  async getMemory(store, id) {
    return this.store(store).get(id);
  }
  async updateMemory(store, id, content) {
    const m = {
      ...this.store(store).get(id),
      content,
      content_sha256: digest(content),
    };
    this.store(store).set(id, m);
    return m;
  }
  async deleteMemory(store, id) {
    this.store(store).delete(id);
  }
  async listMemoryVersions() {
    return { data: [] };
  }
  async getDream() {
    return {
      status: 'succeeded',
      outputs: [{ type: 'memory_store', memory_store_id: 'memstore_clone' }],
    };
  }
}
