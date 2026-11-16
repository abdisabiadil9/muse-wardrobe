import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { agentDefinition } from '../packages/qoder/agent.mjs';

const execute = process.argv.includes('--execute');
if (!execute) {
  console.log(
    'Preview: find/create MUSE development Agent and Environment; pin returned IDs/version in .env. Add --execute to use QODER_ACCESS_TOKEN. No Session or paid turn is started.',
  );
  process.exit(0);
}
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!process.env.QODER_ACCESS_TOKEN)
  throw new Error('Configure QODER_ACCESS_TOKEN in the server .env first');
await mkdir('.local', { recursive: true, mode: 0o700 });
const journalPath = '.local/qoder-setup.json';
let journal = {};
try {
  journal = JSON.parse(await readFile(journalPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
async function persist() {
  await writeFile(journalPath, JSON.stringify(journal, null, 2), {
    mode: 0o600,
  });
}
async function request(path, body, key) {
  const response = await fetch(`https://api.qoder.com.cn/api/v1/cloud${path}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${process.env.QODER_ACCESS_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Qoder ${path}: HTTP ${response.status}; no automatic retry`,
    );
  }
  return response.json();
}
async function list(path) {
  const results = [];
  let page;
  do {
    const data = await request(
      path + (page ? `?page=${encodeURIComponent(page)}` : ''),
    );
    results.push(...data.data);
    if (data.has_more && !data.next_page)
      throw new Error('Provider pagination cursor missing');
    page = data.has_more ? data.next_page : undefined;
  } while (page);
  return results;
}
async function resource(kind, definition) {
  const existing = (await list(`/${kind}`)).find(
    (item) => item.name === definition.name,
  );
  if (existing) {
    journal[kind] = { status: 'confirmed', id: existing.id };
    await persist();
    return existing;
  }
  if (journal[kind]?.status === 'dispatching')
    throw new Error(
      `${kind} previous create is unconfirmed. Reconcile it before creating another resource.`,
    );
  journal[kind] = {
    status: 'dispatching',
    at: new Date().toISOString(),
    name: definition.name,
  };
  await persist();
  const key =
    kind === 'agents'
      ? 'muse-dev-' +
        createHash('sha256')
          .update(JSON.stringify(definition))
          .digest('hex')
          .slice(0, 32)
      : undefined;
  const result = await request(`/${kind}`, definition, key);
  const item = result.data ?? result;
  if (!item.id)
    throw new Error(`${kind} response has no id; creation remains unconfirmed`);
  journal[kind] = { status: 'confirmed', id: item.id };
  await persist();
  return item;
}
try {
  const model = process.env.QODER_MODEL || 'auto';
  const models = await request('/models');
  if (!models.data?.some((item) => item.id === model))
    throw new Error('Configured Qoder model is not available to this account');
  const agent = await resource(
    'agents',
    agentDefinition(model, { memoryEnabled: true }),
  );
  const environment = await resource('environments', {
    name: 'muse-local-dev',
    config: { type: 'cloud' },
  });
  const detail = await request(`/agents/${agent.id}`);
  const version = (detail.data ?? detail).version;
  if (!Number.isInteger(version) || version < 1)
    throw new Error('Cannot pin the Agent version');
  const updates = {
    QODER_AGENT_ID: agent.id,
    QODER_AGENT_VERSION: String(version),
    QODER_ENVIRONMENT_ID: environment.id,
  };
  let env = '';
  try {
    env = await readFile('.env', 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = env
    .split('\n')
    .filter(
      (line) => !Object.keys(updates).some((key) => line.startsWith(key + '=')),
    );
  for (const [key, value] of Object.entries(updates))
    lines.push(`${key}=${value}`);
  await writeFile('.env', lines.filter(Boolean).join('\n') + '\n', {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      agent_id: agent.id,
      version,
      environment_id: environment.id,
      model,
      status: 'configured',
    }),
  );
} catch (error) {
  console.error(
    error.message === 'fetch failed'
      ? 'Qoder connection failed; inspect local setup journal before retrying.'
      : error.message,
  );
  process.exitCode = 1;
}
