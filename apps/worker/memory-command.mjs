import { createPool, one } from '../../packages/db/index.mjs';
import { configFromEnv } from '../../packages/domain/config.mjs';
import { ManagedQoder } from '../../packages/qoder/client.mjs';
import {
  provisionMemory,
  syncMemoryJobs,
  startDream,
  reconcileDream,
} from '../../packages/qoder/memory.mjs';
const [command, ownerOrJob, store] = process.argv.slice(2);
if (
  !['provision', 'bind', 'sync', 'dream', 'reconcile-dream'].includes(command)
)
  throw new Error(
    'Usage: memory-command.mjs provision OWNER | bind OWNER STORE | sync | dream OWNER | reconcile-dream JOB [--isolation-verified]',
  );
const config = configFromEnv(process.env),
  pool = createPool(config.databaseUrl),
  client = new ManagedQoder({ accessToken: config.qoderToken });
try {
  let result;
  if (command === 'provision')
    result = await provisionMemory({ pool, client, owner: ownerOrJob });
  if (command === 'bind') {
    if (!/^memstore_[a-zA-Z0-9_-]+$/.test(store ?? ''))
      throw new Error('Invalid Memory Store ID');
    result = await one(
      pool,
      'INSERT INTO memory_bindings(owner_id,active_store_id) VALUES($1,$2) ON CONFLICT(owner_id) DO NOTHING RETURNING owner_id,active_store_id',
      [ownerOrJob, store],
    );
  }
  if (command === 'sync')
    result = { synced: await syncMemoryJobs({ pool, client }) };
  if (command === 'dream') {
    if (!config.dreamEnabled)
      throw new Error(
        'DREAM_ENABLED must be explicitly enabled after tenant isolation validation',
      );
    result = await startDream({ pool, client, owner: ownerOrJob });
  }
  if (command === 'reconcile-dream')
    result = await reconcileDream({
      pool,
      client,
      jobId: ownerOrJob,
      verifyIsolation: process.argv.includes('--isolation-verified'),
    });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
