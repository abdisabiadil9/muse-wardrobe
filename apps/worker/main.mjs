import { createPool } from '../../packages/db/index.mjs';
import { configFromEnv } from '../../packages/domain/config.mjs';
import { PrivateMedia } from '../api/media.mjs';
import { ManagedQoder } from '../../packages/qoder/client.mjs';
import { syncMemoryJobs } from '../../packages/qoder/memory.mjs';
import { Worker } from './runtime.mjs';
import { SeedreamAdapter } from '../../packages/seedream/index.mjs';
const config = configFromEnv(process.env, { allowTeamDemo: true }),
  pool = createPool(config.databaseUrl);
const qoder = config.qoderToken
  ? new ManagedQoder({ accessToken: config.qoderToken })
  : null;
const worker = new Worker({
  pool,
  config,
  media: new PrivateMedia({
    root: config.mediaRoot,
    secret: config.sessionSecret,
  }),
  qoder,
  seedream: config.tryonEnabled
    ? new SeedreamAdapter({ apiKey: config.arkKey, model: config.arkModel })
    : null,
});
process.on('SIGINT', () => {
  worker.stopping = true;
});
process.on('SIGTERM', () => {
  worker.stopping = true;
});
console.log('MUSE worker started');
let lastMaintenance = 0;
try {
  while (!worker.stopping) {
    const ran = await worker.runOnce();
    if (Date.now() - lastMaintenance > 30000) {
      await worker.cleanupMedia();
      if (qoder) await syncMemoryJobs({ pool, client: qoder });
      lastMaintenance = Date.now();
    }
    if (!ran) await new Promise((r) => setTimeout(r, 500));
  }
} finally {
  await pool.end();
}
