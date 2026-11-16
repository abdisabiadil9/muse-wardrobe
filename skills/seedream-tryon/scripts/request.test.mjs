import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runCli } from './request.mjs';

test('single example is a runnable preview without network or credential access', async () => {
  let result;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Preview must not fetch');
  };
  try {
    await runCli(
      [
        'generate',
        '--input',
        fileURLToPath(
          new URL('../assets/single.example.json', import.meta.url),
        ),
      ],
      {
        stdout: (value) => {
          result = value;
        },
      },
    );
    assert.equal(result.network_requests, 0);
    assert.equal(result.credentials_read, false);
    assert.equal(result.references.length, 2);
    assert.equal(result.target_slot, 'coat');
    assert.ok(result.references.every((ref) => ref.sha256.length === 64));
  } finally {
    globalThis.fetch = priorFetch;
  }
});
test('outfit example runs from the standalone skill directory', () => {
  const skillDir = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      'scripts/request.mjs',
      'generate',
      '--input',
      'assets/outfit.example.json',
    ],
    { cwd: skillDir, encoding: 'utf8', env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.references.length, 6);
  assert.deepEqual(
    preview.references.map((ref) => ref.slot),
    ['person', 'coat', 'top', 'bottom', 'shoes', 'bag'],
  );
});
test('live execution requires an explicit checkpoint destination before credential access', async () => {
  await assert.rejects(
    runCli([
      'generate',
      '--input',
      fileURLToPath(new URL('../assets/single.example.json', import.meta.url)),
      '--execute',
    ]),
    /checkpoint/,
  );
});
