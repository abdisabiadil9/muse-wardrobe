import { createPool, migrate, ensureUser, transaction } from './index.mjs';
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], 'file:').href
) {
  const pool = createPool(
    process.env.DATABASE_URL ||
      'postgres://muse:muse_local_dev@127.0.0.1:55432/muse',
  );
  try {
    await migrate(pool);
    await transaction(pool, (db) => ensureUser(db, DEV_USER_ID));
    console.log('Development identity ready; wardrobe starts empty');
  } finally {
    await pool.end();
  }
}
