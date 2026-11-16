import test from 'node:test';
import assert from 'node:assert/strict';
import { QoderClient, decodeSSE } from './qoder-client.mjs';
import { executeReadOnlyTool, pendingCustomCalls, taskState } from './muse-tools.mjs';

const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('Session binds a pinned agent, explicit budget and one read-only user memory', async () => {
  let observed;
  const client = new QoderClient({ accessToken: 'fake-for-test', fetchImpl: async (url, init) => { observed = { url, ...init }; return json({ id: 'sess_test' }); } });
  await client.createSession({ agentId: 'agent_test', agentVersion: 2, environmentId: 'env_test', memoryStoreId: 'memstore_user', taskId: 'task_1', maxCreditCost: '10.00' });
  const payload = JSON.parse(observed.body);
  assert.equal(observed.url, 'https://api.qoder.com.cn/api/v1/cloud/sessions');
  assert.equal(payload.agent.version, 2);
  assert.equal(payload.resources[0].access, 'read_only');
  assert.equal(payload.budget.max_credit_cost, '10.00');
  assert.equal(observed.redirect, 'error');
});

test('Stream is established before user.message; tool results use call event ID', async () => {
  const calls = [];
  const client = new QoderClient({ accessToken: 'fake-for-test', fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith('/stream')) return new Response(': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return json({ data: [{ id: 'evt_received' }] });
  } });
  const stream = await client.connectEvents('sess_test', { lastEventId: 'evt_checkpoint' });
  await client.sendMessage('sess_test', '帮我搭配');
  await client.sendToolResult('sess_test', 'evt_call', { garment_ids: ['g1'] });
  for await (const frame of stream.events) assert.fail('Heartbeat is not an event');
  stream.close();
  assert.equal(calls[0].headers['Last-Event-ID'], 'evt_checkpoint');
  assert.equal(JSON.parse(calls[1].body).events[0].content[0].text, '帮我搭配');
  assert.equal(JSON.parse(calls[2].body).events[0].custom_tool_use_id, 'evt_call');
});

test('Styling works before Memory rollout and cancellation reaches the cloud endpoint', async () => {
  const calls = [];
  const client = new QoderClient({ accessToken: 'fake-for-test', fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    return json({ id: 'sess_test' });
  } });
  await client.createSession({ agentId: 'agent_test', agentVersion: 1, environmentId: 'env_test', taskId: 'task_1', maxCreditCost: '1.00' });
  assert.equal('resources' in JSON.parse(calls[0].body), false);
  await client.cancelSession('sess_test');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://api.qoder.com.cn/api/v1/cloud/sessions/sess_test/cancel');
});

test('Response loss after a write remains unconfirmed and is never auto-retried', async () => {
  let attempts = 0;
  const client = new QoderClient({ accessToken: 'fake-for-test', fetchImpl: async () => { attempts++; throw new Error('connection lost'); } });
  await assert.rejects(() => client.sendMessage('sess_test', 'hello'), err => err.code === 'write_unconfirmed' && err.uncertain);
  assert.equal(attempts, 1);
});

test('SSE supports UTF-8 split at every byte, CRLF and multiline data', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\nid: evt_test\r\nevent: agent.message\r\ndata: {"id":"evt_test",\r\ndata: "type":"agent.message","content":[{"type":"text","text":"你好"}]}\r\n\r\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const frames = [];
  for await (const frame of decodeSSE(body)) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data.content[0].text, '你好');
});

test('Truncated SSE does not become a final result', async () => {
  const body = new Response('id: evt_test\ndata: {"type":"agent.message"}').body;
  await assert.rejects(async () => { for await (const ignored of decodeSSE(body)) assert.fail(String(ignored)); }, /truncated_sse_frame/);
  assert.equal(taskState({ type: 'agent.message' }), null);
  assert.equal(taskState({ type: 'session.thread_status_idle', stop_reason: { type: 'end_turn' } }), null);
  assert.equal(taskState({ type: 'session.status_idle', stop_reason: { type: 'requires_action' } }), 'waiting_for_tools');
  assert.equal(taskState({ type: 'session.status_idle', stop_reason: { type: 'unknown' } }), 'unknown');
});

test('Leading heartbeat cannot hide a truncated SSE event at EOF', async () => {
  const body = new Response(': heartbeat\nid: evt_test\ndata: {"type":"session.status_idle"}').body;
  await assert.rejects(async () => { for await (const ignored of decodeSSE(body)) assert.fail(String(ignored)); }, /truncated_sse_frame/);
  for await (const ignored of decodeSSE(new Response(': heartbeat\n: another heartbeat').body)) assert.fail(String(ignored));
});

test('Tools use trusted task owner; model cannot select another user or arbitrary tool', async () => {
  const context = { userId: 'u1', taskId: 't1' };
  let calledOwner;
  const repository = { async listGarments(owner) { calledOwner = owner; return [{ id: 'g1', name: '针织衫', category: 'top', privateNote: 'secret' }]; }, async getGarments() { return []; } };
  const result = await executeReadOnlyTool({ name: 'read_wardrobe', input: {} }, context, repository);
  assert.equal(calledOwner, 'u1');
  assert.equal(result.garments[0].privateNote, undefined);
  await assert.rejects(() => executeReadOnlyTool({ name: 'read_wardrobe', input: { user_id: 'u2' } }, context, repository));
  await assert.rejects(() => executeReadOnlyTool({ name: 'delete_all', input: {} }, context, repository));
  await assert.rejects(() => executeReadOnlyTool({ name: 'propose_outfit', input: { garment_ids: ['other-user-item'], reason: 'test' } }, context, repository), /unavailable/);
});

test('Execute only latest pending call IDs, never on message arrival alone', () => {
  const call = { id: 'evt_call', type: 'agent.custom_tool_use', name: 'read_wardrobe', input: {} };
  const events = new Map([[call.id, call]]);
  assert.deepEqual(pendingCustomCalls(call, events), []);
  const state = { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['evt_call'] } };
  assert.deepEqual(pendingCustomCalls(state, events), [call]);
  assert.throws(() => pendingCustomCalls(state, new Map()), /reconcile/);
});

test('Dream receives one store and explicit same-owner session scope; rejects empty scope', async () => {
  let payload;
  const client = new QoderClient({ accessToken: 'fake-for-test', fetchImpl: async (url, init) => { payload = JSON.parse(init.body); return json({ id: 'drm_test' }); } });
  assert.throws(() => client.createDream('memstore_user', []));
  await client.createDream('memstore_user', ['sess_user']);
  assert.deepEqual(payload.inputs, [{ type: 'memory_store', memory_store_id: 'memstore_user' }, { type: 'sessions', session_ids: ['sess_user'] }]);
});
