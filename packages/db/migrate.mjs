import { createPool, migrate } from './index.mjs';
const pool = createPool(
  process.env.DATABASE_URL ||
    'postgres://muse:muse_local_dev@127.0.0.1:55432/muse',
);
try {
  await migrate(pool);
  console.log('Database migrations complete');
} finally {
  await pool.end();
}
