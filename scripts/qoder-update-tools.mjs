// Explicitly update this application's existing Agent; never start a paid Session.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { agentDefinition, basicTools } from '../packages/qoder/agent.mjs';
if (!process.argv.includes('--execute')) {
  console.log(
    JSON.stringify({
      action: 'update existing Agent tools and pin version',
      basicTools,
      execute: false,
    }),
  );
  process.exit(0);
}
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const id = process.env.QODER_AGENT_ID,
  token = process.env.QODER_ACCESS_TOKEN;
if (!id || !token)
  throw new Error('QODER_AGENT_ID and QODER_ACCESS_TOKEN are required');
async function request(method, body) {
  const r = await fetch(
    'https://api.qoder.com.cn/api/v1/cloud/agents/' + encodeURIComponent(id),
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    },
  );
  if (!r.ok)
    throw new Error(
      `Qoder Agent ${method}: HTTP ${r.status}; no automatic retry`,
    );
  const data = await r.json();
  return data.data ?? data;
}
const before = await request('GET');
await mkdir('.local', { recursive: true });
await writeFile('.local/qoder-tools-backup.json', JSON.stringify(before), {
  mode: 0o600,
});
const definition = agentDefinition(before.model, { memoryEnabled: true });
// Preserve model, metadata, MCP, skills and unrelated toolsets. Replace only our builtin/basic configuration.
const tools = [
  definition.tools[0],
  ...(before.tools || []).filter((t) => t.type !== 'agent_toolset_20260401'),
];
const after =
  JSON.stringify(before.tools) === JSON.stringify(tools) &&
  before.system === definition.system
    ? before
    : await request('POST', {
        version: before.version,
        system: definition.system,
        tools,
      });
const verified = await request('GET');
if (
  verified.version !== after.version ||
  !basicTools.every((t) =>
    verified.tools
      .find((x) => x.type === 'agent_toolset_20260401')
      ?.enabled_tools?.includes(t),
  )
)
  throw new Error('Agent version verification failed');
const file = '.env';
const env = (await readFile(file, 'utf8'))
  .split('\n')
  .filter((l) => !l.startsWith('QODER_AGENT_VERSION='))
  .join('\n')
  .trim();
await writeFile(
  file,
  env + '\nQODER_AGENT_VERSION=' + verified.version + '\n',
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    id,
    version: verified.version,
    basicTools,
    status:
      'verified; local version pinned; update cloud QODER_AGENT_VERSION too',
  }),
);
