import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code === 'ENOENT')
    throw new Error(
      'Copy .env.example to .env and configure SESSION_SECRET before starting.',
    );
  throw error;
}
const children = [];
let stopping = false;
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}
let docker = process.env.DOCKER_BIN || 'docker';
if (!process.env.DOCKER_BIN && process.platform === 'darwin') {
  for (const candidate of [
    `${os.homedir()}/.docker/bin/docker`,
    '/Applications/Docker.app/Contents/Resources/bin/docker',
  ]) {
    try {
      await access(candidate);
      docker = candidate;
      break;
    } catch {}
  }
}
await run(docker, ['compose', 'up', '-d', '--wait']);
await run(process.execPath, ['packages/db/migrate.mjs']);
function start(name, args) {
  const env = { ...process.env };
  if (name === 'Web')
    for (const key of Object.keys(env))
      if (/^(QODER_|ARK_|SESSION_SECRET|DATABASE_URL)/.test(key))
        delete env[key];
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} stopped (${code}).`);
      stop(code || 1);
    }
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 5000);
  timeout.unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
start('API', ['apps/api/main.mjs']);
start('Worker', ['apps/worker/main.mjs']);
start('Web', [resolve('node_modules/vite/bin/vite.js'), '--host', '0.0.0.0']);
console.log(
  'MUSE local: http://localhost:5179 — PostgreSQL, API and Worker enabled. Ctrl+C stops app processes; database data remains in Docker.',
);
for (const entries of Object.values(os.networkInterfaces()))
  for (const address of entries ?? []) {
    if (address.family === 'IPv4' && !address.internal)
      console.log(
        `Phone address candidate: http://${address.address}:5179 (include this exact origin in APP_ORIGINS).`,
      );
  }
