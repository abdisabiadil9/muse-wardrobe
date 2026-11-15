// No account, SDK, camera, or paid network calls. Tests the integration boundary.
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const contractSource = stripTypeScriptTypes(await readFile(new URL('../src/integrations/contracts.ts', import.meta.url), 'utf8'));
const adapterSource = stripTypeScriptTypes(await readFile(new URL('../src/integrations/decart.ts', import.meta.url), 'utf8'))
  .replace("'./contracts'", JSON.stringify(encode(contractSource)));
const { startDecartTryOn } = await import(encode(adapterSource));
const garment = { garmentId: 'garment_1', prompt: 'Cream sweater', image: '/cream.jpg' };

function harness() {
  const state = { captures: 0, stopped: 0, disconnected: 0, conditions: [], requests: [] };
  return {
    state,
    options: {
      enabled: true, draftId: 'draft_1', garment,
      capture: async () => { state.captures++; return { getTracks: () => [{ stop: () => state.stopped++ }] }; },
      fetcher: async (url, options) => {
        state.requests.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ apiKey: 'ek_test_token' }), { status: 200 });
      },
      sdk: { connect: async (_stream, options) => {
        await options.apiKeyProvider();
        state.conditions.push(options.initialState);
        return { set: async next => state.conditions.push(next), disconnect: () => state.disconnected++ };
      } },
      onRemoteStream: () => {},
    },
  };
}

test('disabled cloud mode cannot request camera or a token', async () => {
  const { state, options } = harness();
  await assert.rejects(startDecartTryOn({ ...options, enabled: false }), /NOT_CONFIGURED/);
  assert.equal(state.captures, 0);
  assert.equal(state.requests.length, 0);
});

test('token failure releases camera before surfacing the error', async () => {
  const { state, options } = harness();
  await assert.rejects(startDecartTryOn({ ...options, fetcher: async () => new Response('', { status: 503 }) }), /TOKEN_503/);
  assert.equal(state.stopped, 1);
});

test('garment changes preserve paired reference state; repeated stop cleans up once', async () => {
  const { state, options } = harness();
  const session = await startDecartTryOn(options);
  await session.setGarment({ garmentId: 'garment_2', prompt: 'Olive jacket', image: '/olive.jpg' });
  assert.deepEqual(state.conditions.at(-1), { prompt: 'Olive jacket', image: '/olive.jpg' });
  assert.deepEqual(state.requests[0].body, { draftId: 'draft_1', garmentId: 'garment_1' });
  session.stop(); session.stop();
  assert.equal(state.stopped, 1);
  assert.equal(state.disconnected, 1);
  await assert.rejects(session.setGarment(garment), /SESSION_CLOSED/);
});

test('cancelling while camera permission is pending stops any late camera stream', async () => {
  const { state, options } = harness();
  const controller = new AbortController();
  let grant;
  const pending = startDecartTryOn({ ...options, signal: controller.signal,
    capture: () => new Promise(resolve => { grant = resolve; }),
  });
  controller.abort();
  grant({ getTracks: () => [{ stop: () => state.stopped++ }] });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(state.stopped, 1);
  assert.equal(state.requests.length, 0);
});
