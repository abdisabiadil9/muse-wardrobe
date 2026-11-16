import { copyFile, mkdir } from 'node:fs/promises';
const target = new URL(
  '../../skills/seedream-tryon/scripts/seedream-client.mjs',
  import.meta.url,
);
await mkdir(new URL('.', target), { recursive: true });
await copyFile(new URL('./index.mjs', import.meta.url), target);
console.log(
  'Updated the portable skill client from packages/seedream/index.mjs',
);
