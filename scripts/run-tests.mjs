import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith('.test.mjs')) files.push(path);
  }
}
for (const directory of ['src', 'server', 'packages', 'skills'])
  await visit(directory);
if (!files.length) throw new Error('No tests discovered');
const child = spawn(
  process.execPath,
  ['--experimental-strip-types', '--test', ...files.sort()],
  { stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
