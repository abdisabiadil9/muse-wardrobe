import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createApi, ApiError } from './api/client.ts';
import {
  draftSlots,
  toOutfit,
  validateProposal,
  tryonRequest,
  draftBody,
  draftContent,
} from './api/viewModels.ts';
const wardrobe = [
  { id: 'coat-1', category: 'coat', image_asset_id: 'asset-1' },
  { id: 'top-1', category: 'top', image_asset_id: 'asset-2' },
  { id: 'top-2', category: 'top', image_asset_id: 'asset-3' },
];
const selected = {
  coat: {
    source: 'wardrobe',
    ref_id: 'coat-1',
    asset_id: 'asset-1',
    locked: true,
  },
  top: {
    source: 'wardrobe',
    ref_id: 'top-1',
    asset_id: 'asset-2',
    locked: false,
  },
};
const draft = () => ({
  id: 'draft-1',
  scene: 'daily',
  revision: 4,
  slots: structuredClone(selected),
  canvas_layout: {},
  updated_at: '2026-11-16T00:00:00Z',
});
const proposal = () => ({
  kind: 'outfit_proposal',
  draft_revision: 4,
  slots: structuredClone(selected),
  garment_ids: ['coat-1', 'top-1'],
});

test('legacy canvas positions serialize against the real draft contract without losing layout', async () => {
  const contract = JSON.parse(
    await readFile(
      new URL('../docs/contracts/openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile({
    ...contract.paths['/outfit-drafts/{scene}'].patch.requestBody.content[
      'application/json'
    ].schema,
    components: contract.components,
  });
  const original = {
    ...draft(),
    slots: {},
    canvas_layout: {
      coat: { x: 28, y: 33, width: 47, rotation: -8 },
      bag: { x: 29, y: 64, width: 28, rotation: -9, z_index: 7 },
    },
  };
  const before = structuredClone(original);
  assert.equal(
    validate({
      expected_revision: 4,
      slots: {},
      canvas_layout: original.canvas_layout,
    }),
    false,
  );
  const body = draftBody(original);
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  assert.equal(body.canvas_layout.bag.z_index, 7);
  assert.deepEqual(body.canvas_layout.coat, {
    ...original.canvas_layout.coat,
    z_index: 0,
  });
  assert.deepEqual(original, before);
  assert.equal(
    draftContent(original),
    draftContent({ ...original, canvas_layout: body.canvas_layout }),
  );
});

test('empty API slots stay empty and never become demonstration wardrobe IDs', () => {
  assert.deepEqual(toOutfit({}), {
    coat: '',
    top: '',
    bottom: '',
    shoes: '',
    bag: '',
  });
  assert.deepEqual(draftSlots(toOutfit({}), [], {}), {});
});
test('changing one garment retains other selections and lock flags', () => {
  const outfit = { ...toOutfit(selected), top: 'top-2' };
  const next = draftSlots(outfit, wardrobe, selected);
  assert.equal(next.coat.ref_id, 'coat-1');
  assert.equal(next.coat.locked, true);
  assert.equal(next.top.ref_id, 'top-2');
  assert.equal(next.top.locked, false);
  assert.throws(
    () => draftSlots({ ...outfit, bottom: 'top-1' }, wardrobe, selected),
    /不可用/,
  );
});
test('candidate validation prevents stale revisions, unknown items and changes to locked clothing', () => {
  assert.deepEqual(validateProposal(proposal(), draft(), wardrobe), selected);
  assert.throws(
    () =>
      validateProposal({ ...proposal(), draft_revision: 3 }, draft(), wardrobe),
    /变化/,
  );
  assert.throws(
    () =>
      validateProposal(
        { ...proposal(), slots: { top: selected.top } },
        draft(),
        wardrobe,
      ),
    /固定/,
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...proposal(),
          slots: {
            ...selected,
            top: { ...selected.top, ref_id: 'other-owner' },
          },
        },
        draft(),
        wardrobe,
      ),
    /不可用/,
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...proposal(),
          slots: { ...selected, top: { ...selected.top, source: 'product' } },
        },
        draft(),
        wardrobe,
      ),
    /不可用/,
  );
});
test('single try-on identifies only selected slot without mutating draft; outfit sends original person snapshot', () => {
  const d = draft(),
    before = structuredClone(d);
  const single = tryonRequest(d, 'original-person', 'single', 'top');
  assert.equal(single.target_slot, 'top');
  assert.equal(single.person_asset_id, 'original-person');
  assert.deepEqual(d, before);
  const full = tryonRequest(
    { ...d, revision: 5 },
    'original-person',
    'outfit',
    'top',
  );
  assert.equal(full.draft_revision, 5);
  assert.equal(full.person_asset_id, 'original-person');
  assert.equal('target_slot' in full, false);
  assert.throws(() => tryonRequest(d, 'person', 'single', 'shoes'), /请选择/);
  assert.throws(
    () => tryonRequest({ ...d, slots: {} }, 'person', 'outfit'),
    /先选择/,
  );
});
test('writes carry session credentials, CSRF and stable idempotency key', async () => {
  const calls = [];
  const api = createApi(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ task_id: 'one' }), { status: 202 });
  });
  api.setCsrf('test-csrf');
  await api.post('/styling-tasks', { draft_id: 'one' }, 'retry-same-key');
  await api.post('/styling-tasks', { draft_id: 'one' }, 'retry-same-key');
  assert.equal(calls[0].url, '/api/v1/styling-tasks');
  assert.equal(calls[0].options.credentials, 'same-origin');
  for (const call of calls) {
    assert.equal(call.options.headers.get('X-CSRF-Token'), 'test-csrf');
    assert.equal(call.options.headers.get('Idempotency-Key'), 'retry-same-key');
  }
  assert.equal(calls[0].options.body, calls[1].options.body);
});
test('network uncertainty is distinct from a rejected request and does not retry automatically', async () => {
  let calls = 0;
  const api = createApi(async () => {
    calls++;
    throw new Error('connection lost');
  });
  await assert.rejects(
    api.post('/tryon-tasks', {}, 'same-key'),
    (error) =>
      error instanceof ApiError &&
      error.status === 0 &&
      error.detail.code === 'NETWORK_UNKNOWN',
  );
  assert.equal(calls, 1);
  const rejected = createApi(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'STALE',
            message: '搭配版本变化',
            retryable: false,
            request_id: 'r1',
          },
        }),
        { status: 409 },
      ),
  );
  await assert.rejects(
    rejected.patch('/outfit-drafts/daily', {}),
    (error) => error.status === 409 && error.detail.request_id === 'r1',
  );
});
test('SSE resumes from application sequence, ignores heartbeat and duplicate events across chunks', async () => {
  let header;
  const chunks = [
    ': heartbeat\n\nid: 4\nevent: task.updated\ndata: {}\n\nid: 5\r',
    '\nevent: task.updated\r\ndata: {}\r\n\r\nid: 5\n\ndata: {}\n\nid: 6\n',
    'event: tryon.completed\ndata: {}\n\n',
  ];
  const api = createApi(async (_url, options) => {
    header = options.headers;
    return new Response(
      new ReadableStream({
        start(controller) {
          chunks.forEach((s) =>
            controller.enqueue(new TextEncoder().encode(s)),
          );
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  const seq = [];
  await api.stream('task-1', 4, new AbortController().signal, (n) =>
    seq.push(n),
  );
  assert.equal(header['Last-Event-ID'], '4');
  assert.deepEqual(seq, [5, 6]);
});

test('private photo upload follows ticket method, completes checksum, and never sends base64 in API JSON', async () => {
  const previousLocation = globalThis.location;
  globalThis.location = { origin: 'http://localhost:5179' };
  const calls = [];
  const api = createApi(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/v1/media/uploads')
      return new Response(
        JSON.stringify({
          asset_id: 'asset-photo',
          upload_url: '/api/v1/media/asset-photo/content?token=upload-only',
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          expires_at: '2026-11-16T23:00:00Z',
        }),
      );
    if (String(url).includes('/content?'))
      return new Response(null, { status: 204 });
    return new Response(
      JSON.stringify({
        id: 'asset-photo',
        kind: 'person',
        status: 'ready',
        download_url: '/api/v1/media/asset-photo/content?token=read-only',
      }),
    );
  });
  try {
    api.setCsrf('csrf');
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: 'image/png',
    });
    const asset = await api.upload(blob, 'person');
    assert.equal(asset.status, 'ready');
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      kind: 'person',
      mime: 'image/png',
      bytes: 4,
    });
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[1].options.body, blob);
    assert.equal(calls[1].options.credentials, 'same-origin');
    assert.match(JSON.parse(calls[2].options.body).sha256, /^[a-f0-9]{64}$/);
    assert.equal(calls[2].url, '/api/v1/media/asset-photo/complete');
  } finally {
    globalThis.location = previousLocation;
  }
});
test('successful HTTP response with missing JSON remains uncertain rather than a safe failure', async () => {
  const api = createApi(
    async () => new Response('lost acknowledgment', { status: 200 }),
  );
  await assert.rejects(
    api.post('/tryon-tasks', {}, 'same-key'),
    (error) =>
      error.status === 0 && error.detail.code === 'INVALID_RESPONSE_UNKNOWN',
  );
});

test('LAN HTTP upload uses a correct SHA256 fallback without SubtleCrypto', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const original = globalThis.crypto;
  const previousLocation = globalThis.location;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: original.getRandomValues.bind(original) },
  });
  globalThis.location = { origin: 'http://192.168.1.12:5179' };
  let checksum;
  const api = createApi(async (url, options = {}) => {
    if (url === '/api/v1/media/uploads')
      return new Response(
        JSON.stringify({
          asset_id: 'asset-lan',
          upload_url: '/api/v1/media/asset-lan/content?token=temporary',
          method: 'PUT',
          expires_at: '2026-11-16T23:00:00Z',
        }),
      );
    if (String(url).includes('/content?'))
      return new Response(null, { status: 204 });
    checksum = JSON.parse(options.body).sha256;
    return new Response(
      JSON.stringify({ id: 'asset-lan', kind: 'person', status: 'ready' }),
    );
  });
  try {
    await api.upload(new Blob(['abc'], { type: 'image/png' }), 'person');
    assert.equal(
      checksum,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    globalThis.location = previousLocation;
  }
});
