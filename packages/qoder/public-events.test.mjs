import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAgentEvent } from './public-events.mjs';

test('public native events hide internal envelopes, reasoning and unknown tools', () => {
  assert.equal(publicAgentEvent({ id: 'evt_unknown', type: '__proto__' }), null);
  assert.equal(
    publicAgentEvent({
      id: 'evt_hidden',
      type: 'agent.thinking',
      thinking: 'private',
    }),
    null,
  );
  assert.equal(
    publicAgentEvent({ id: 'evt_delta', type: 'event_delta', delta: {} }),
    null,
  );
  const event = publicAgentEvent({
    id: 'evt_x',
    type: 'agent.custom_tool_use',
    name: 'unknown',
    input: { command: 'read credentials' },
    auth: 'private',
  });
  assert.deepEqual(event, {
    id: 'evt_x',
    type: 'agent.custom_tool_use',
    name: 'unknown',
  });
  assert.deepEqual(
    publicAgentEvent({
      id: 'evt_y',
      type: 'user.custom_tool_result',
      custom_tool_use_id: 'evt_x',
      content: [{ type: 'text', text: 'private' }],
    }),
    {
      id: 'evt_y',
      type: 'user.custom_tool_result',
      custom_tool_use_id: 'evt_x',
    },
  );
});

test('public native text and tool payloads are bounded and redact credential fields', () => {
  const event = publicAgentEvent({
    id: 'evt_x',
    type: 'agent.message',
    content: [
      { type: 'thinking', text: 'private' },
      {
        type: 'text',
        text: 'Bearer credential-value api_key=credential-value',
      },
      {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          nested: { password: 'private', reasoning: 'private' },
        }),
      },
      { type: 'text', text: 'a'.repeat(30000) },
    ],
  });
  assert.equal(event.content.length, 3);
  assert.doesNotMatch(JSON.stringify(event), /credential-value|private/);
  assert.deepEqual(JSON.parse(event.content[1].text), { ok: true, nested: {} });
  assert.equal(event.content[2].text.length, 16384);
});
