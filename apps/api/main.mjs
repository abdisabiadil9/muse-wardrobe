import { createPool } from '../../packages/db/index.mjs';
import { configFromEnv } from '../../packages/domain/config.mjs';
import { createApp } from './app.mjs';
const config = configFromEnv(process.env),
  pool = createPool(config.databaseUrl);
const app = await createApp({ pool, ...config });
await app.listen({ host: config.host, port: config.port });
console.log(`MUSE API listening on ${config.host}:${config.port}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
}
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
