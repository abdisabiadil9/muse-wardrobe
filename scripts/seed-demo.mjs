// Explicit local development fixture import. No model requests or provider credentials.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'http://localhost:5179';
await fs.mkdir('.local', { recursive: true, mode: 0o700 });
let state = {};
try {
  state = JSON.parse(await fs.readFile('.local/demo-seed.json', 'utf8'));
} catch {}
const save = () =>
  fs.writeFile('.local/demo-seed.json', JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
const login = await fetch(base + '/api/v1/me', {
  signal: AbortSignal.timeout(15000),
});
const me = await login.json();
if (!login.ok) throw new Error('login ' + login.status);
const cookie = login.headers
  .getSetCookie()
  .map((s) => s.split(';')[0])
  .join('; ');
async function api(path, { method = 'GET', body, key } = {}) {
  const r = await fetch(base + '/api/v1' + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: base,
      'X-CSRF-Token': me.csrf_token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      path + ' HTTP' + r.status + ' ' + JSON.stringify(data.error),
    );
  return data;
}
async function upload(file, kind, key) {
  state.assets ??= {};
  if (state.assets[key]) return state.assets[key];
  const bytes = await fs.readFile(file);
  const ticket = await api('/media/uploads', {
    method: 'POST',
    body: { kind, mime: 'image/png', bytes: bytes.length },
    key: 'demo-upload-' + key,
  });
  const r = await fetch(new URL(ticket.upload_url, base), {
    method: ticket.method,
    headers: {
      ...ticket.headers,
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'image/png',
    },
    body: bytes,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('upload HTTP' + r.status);
  const asset = await api(`/media/${ticket.asset_id}/complete`, {
    method: 'POST',
    body: { sha256: createHash('sha256').update(bytes).digest('hex') },
    key: 'demo-complete-' + key,
  });
  state.assets[key] = asset.id;
  await save();
  return asset.id;
}
const mode = 'seed';
if (mode === 'seed') {
  const manifest = JSON.parse(
    await fs.readFile('public/assets/garments/manifest.json', 'utf8'),
  );
  const names = {
    oat: '燕麦色西装',
    navy: '深蓝色西装',
    trouser: '灰褐长裤',
    bag: '棕色手提包',
    tee: '白色针织上装',
    jeans: '直筒牛仔裤',
    shoe: '棕色乐福鞋',
    scarf: '浅灰围巾',
    'red-knit': '红色针织衫',
    'lilac-cardigan': '浅紫开衫',
    'mint-pants': '薄荷绿长裤',
    'black-boots': '黑色短靴',
  };
  const existing = [];
  let cursor = null;
  do {
    const page = await api(
      '/garments?limit=100' + (cursor ? '&cursor=' + cursor : ''),
    );
    existing.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);
  state.garments ??= {};
  state.sourceHashes ??= {};
  for (const a of manifest.assets) {
    if (state.garments[a.id] && state.sourceHashes[a.id] === a.sha256) continue;
    const image = await upload(a.file, 'garment', a.sha256);
    const found =
      existing.find((g) => g.id === state.garments[a.id]?.id) ||
      existing.find((g) => g.name === '体验 · ' + names[a.id]);
    const body = {
      name: '体验 · ' + names[a.id],
      category: a.slot,
      garment_kind: a.garment_kind,
      image_asset_id: image,
      source: 'upload',
    };
    const g = found
      ? await api('/garments/' + found.id, {
          method: 'PATCH',
          body: { ...body, expected_revision: found.revision },
        })
      : await api('/garments', {
          method: 'POST',
          key: 'demo-garment-' + a.id,
          body,
        });
    state.garments[a.id] = g;
    state.sourceHashes[a.id] = a.sha256;
    await save();
  }
  const looks = {
    daily: ['oat', 'tee', 'trouser', 'shoe', 'bag'],
    weekend: ['lilac-cardigan', 'tee', 'mint-pants', 'shoe', 'bag'],
    meeting: ['oat', 'red-knit', 'jeans', 'shoe', 'bag'],
  };
  state.drafts ??= {};
  for (const [scene, ids] of Object.entries(looks)) {
    const d = await api('/outfit-drafts/' + scene);
    let slots;
    if (Object.keys(d.slots).length) {
      slots = Object.fromEntries(
        Object.entries(d.slots).map(([slot, ref]) => {
          const g = Object.values(state.garments).find(
            (g) => g.id === ref.ref_id,
          );
          return [slot, g ? { ...ref, asset_id: g.image_asset_id } : ref];
        }),
      );
    } else
      slots = Object.fromEntries(
        ids.map((id) => {
          const g = state.garments[id];
          return [
            g.category,
            {
              source: 'wardrobe',
              ref_id: g.id,
              asset_id: g.image_asset_id,
              locked: false,
            },
          ];
        }),
      );
    state.drafts[scene] =
      JSON.stringify(slots) === JSON.stringify(d.slots)
        ? d
        : await api('/outfit-drafts/' + scene, {
            method: 'PATCH',
            body: {
              expected_revision: d.revision,
              slots,
              canvas_layout: d.canvas_layout,
            },
          });
    await save();
  }
  await save();
  console.log(
    JSON.stringify({
      seeded_garments: Object.keys(state.garments).length,
      scenes: Object.keys(state.drafts),
    }),
  );
}
