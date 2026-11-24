import test from 'node:test';
import assert from 'node:assert/strict';
import {
  styles,
  inspirationInput,
  noteURL,
  publicImage,
  normalizeResult,
} from './domain.mjs';
import { EveryInfra, sourceReceipt, retrySeconds } from './everyinfra.mjs';
const id = 'abcdef0123456789abcdef01';
test('12 editorial definitions are complete and only editorial queries share a cache', () => {
  assert.equal(styles.length, 12);
  assert.equal(new Set(styles.map((s) => s.id)).size, 12);
  for (const s of styles) {
    assert.ok(s.description && s.formula && s.silhouette && s.pieces.length);
    assert.equal(s.palette.length, s.colors.length);
  }
  const body = { action: 'search', style_id: 'city' };
  assert.equal(
    inspirationInput(body, 'alice').cache_key,
    inspirationInput(body, 'bob').cache_key,
  );
  assert.equal(inspirationInput(body, 'alice').cache_hours, 168);
  const custom = { ...body, keyword: '我的特殊搜索' };
  assert.notEqual(
    inspirationInput(custom, 'alice').cache_key,
    inspirationInput(custom, 'bob').cache_key,
  );
  assert.notEqual(
    inspirationInput({ action: 'note', url: id }, 'alice').cache_key,
    inspirationInput({ action: 'note', url: id }, 'bob').cache_key,
  );
  assert.throws(() =>
    inspirationInput({ ...body, cache_key: 'attacker' }, 'alice'),
  );
});
test('share URLs preserve required source tokens but reject arbitrary hosts and image trackers', () => {
  assert.equal(
    publicImage(
      'https://sns-note-i1.xhscdn.com/a?imageView2/2/format/heif/q/58&sign=kept',
    ),
    'https://sns-note-i1.xhscdn.com/a?imageView2/2/format/webp/q/58&sign=kept',
  );
  const url = `https://www.xiaohongshu.com/explore/${id}?xsec_token=required`;
  assert.equal(noteURL(`穿搭分享 ${url} 更多内容`), url);
  for (const bad of [
    'http://127.0.0.1',
    'https://xiaohongshu.com.evil.test/explore/' + id,
    'https://www.xiaohongshu.com/user/profile/' + id,
    'https://user:pass@xhslink.com/a',
    'https://xhslink.com:8443/a',
  ])
    assert.throws(() => noteURL(bad));
  assert.equal(
    publicImage('https://sns-img.xhscdn.com/test.webp'),
    'https://sns-img.xhscdn.com/test.webp',
  );
  for (const bad of [
    'https://evil.test/a',
    'http://sns-img.xhscdn.com/a',
    'https://xhscdn.com.evil.test/a',
    'data:image/png;base64,abc',
  ])
    assert.equal(publicImage(bad), null);
});
test('normalize actual catalog image/text fields with attribution, bounded size and missing-image support', () => {
  const note = {
    id,
    url: `https://www.xiaohongshu.com/explore/${id}`,
    images: [
      'https://sns-img.xhscdn.com/test.webp',
      'https://evil.test/tracker',
    ],
    title: '测试',
    text: 'a'.repeat(9000),
    author_name: '作者',
    tags: ['极简'],
    is_cooperation_note: true,
  };
  const result = normalizeResult(
    { results: [note, note, { id: 'invalid' }] },
    'search',
  );
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].text.length, 600);
  assert.equal(result.data[0].images.length, 1);
  assert.equal(result.data[0].author, '作者');
  assert.equal(result.data[0].is_summary, true);
  assert.equal(
    normalizeResult({ results: { ...note, images: null } }, 'note').data[0]
      .images.length,
    0,
  );
  assert.deepEqual(normalizeResult({ results: [] }, 'search').data, []);
  assert.throws(() => normalizeResult({ status: 'succeeded' }, 'note'));
  assert.throws(() =>
    normalizeResult({ results: [{ title: 'Missing id' }] }, 'search'),
  );
  assert.throws(
    () => noteURL('https://%'),
    (e) => e.status === 400,
  );
});
test('provider sends exact async contract; poll and request recovery are read-only', async () => {
  const calls = [];
  const api = new EveryInfra({
    apiKey: 'fixture-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ job_id: 'job_1', id: 'req_1' }, { status: 202 });
    },
  });
  const input = inspirationInput(
    { action: 'search', style_id: 'city' },
    'alice',
  );
  const ack = await api.submit('search', input.params);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    platform: 'xiaohongshu',
    action: 'search',
    params: input.params,
    mode: 'async',
  });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(sourceReceipt(ack).job_id, 'job_1');
  await api.job('job_1');
  await api.lookup('req_1');
  assert.ok(calls[1].url.endsWith('/api/v1/jobs/job_1'));
  assert.ok(calls[2].url.endsWith('/portal/api/requests/req_1'));
  assert.equal(calls[1].options.method, 'GET');
  assert.throws(
    () => sourceReceipt({ http_status: 202, id: 'req_1' }),
    (e) => e.uncertain === true,
  );
});
test('unknown submissions never become safe retries; known rate limits honor Retry-After', async () => {
  for (const [status, code, uncertain, retry] of [
    [503, 'submit_unknown', true, false],
    [503, 'busy', false, true],
    [429, 'rate_limited', false, true],
    [422, 'invalid_params', false, false],
    [500, 'internal_error', true, false],
  ]) {
    const api = new EveryInfra({
      apiKey: 'fixture-secret',
      fetchImpl: async () =>
        Response.json(
          { error: { code, message: 'do not expose fixture-secret' } },
          { status, headers: { 'Retry-After': '17', 'X-Request-Id': 'req_2' } },
        ),
    });
    await assert.rejects(
      api.submit('note', { url: id }),
      (e) =>
        e.uncertain === uncertain &&
        e.safeRetry === retry &&
        e.retryAfter === 17 &&
        e.requestId === 'req_2' &&
        !e.message.includes('fixture-secret'),
    );
  }
  const api = new EveryInfra({
    apiKey: 'fixture',
    fetchImpl: async () => {
      throw new Error('network');
    },
  });
  await assert.rejects(
    api.submit('note', { url: id }),
    (e) => e.uncertain === true,
  );
  await assert.rejects(
    api.job('job_1'),
    (e) => e.readRetry === true && !e.uncertain,
  );
  assert.equal(retrySeconds(undefined, 2), 20);
  assert.equal(
    retrySeconds(
      'Tue, 17 Nov 2026 00:00:10 GMT',
      0,
      Date.parse('2026-11-17T00:00:00Z'),
    ),
    10,
  );
});
