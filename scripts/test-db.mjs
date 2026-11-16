import pg from 'pg';
import { spawn } from 'node:child_process';
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const url = new URL(
  process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://muse:muse_local_dev@127.0.0.1:55432/muse_test',
);
if (!process.env.TEST_DATABASE_URL) url.pathname = '/muse_test';
const name = url.pathname.slice(1);
if (!/^muse_test[a-z0-9_]*$/.test(name))
  throw new Error('Integration tests require a dedicated muse_test* database');
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const existing = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname=$1',
    [name],
  );
  if (!existing.rows.length) await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}
const testEnv = { ...process.env, TEST_DATABASE_URL: url.toString() };
for (const key of Object.keys(testEnv))
  if (/TOKEN|API_KEY|SA_KEY|CLIENT_SECRET|SESSION_SECRET/.test(key))
    delete testEnv[key];
const child = spawn(process.execPath, ['scripts/run-tests.mjs'], {
  stdio: 'inherit',
  env: testEnv,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
