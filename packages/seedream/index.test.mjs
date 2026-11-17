import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  SeedreamAdapter,
  SeedreamError,
  buildSeedreamRequest,
  resolveTryonInput,
  DEFAULT_MODEL,
} from './index.mjs';

const png = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: '#b8a085' },
})
  .png()
  .toBuffer();
function input(mode = 'outfit') {
  const slots = {
    coat: { asset_id: 'a-coat', ref_id: 'g-coat' },
    top: { asset_id: 'a-top', ref_id: 'g-top' },
    bottom: { asset_id: 'a-bottom', ref_id: 'g-bottom' },
    shoes: { asset_id: 'a-shoes', ref_id: 'g-shoes' },
    bag: { asset_id: 'a-scarf', ref_id: 'g-scarf' },
  };
  const garments = Object.entries(slots)
    .map(([slot, selected]) => ({
      slot,
      ...selected,
      name: slot === 'bag' ? '围巾' : slot,
      garment_kind: slot === 'bag' ? 'scarf' : slot,
      bytes: png,
      mime: 'image/png',
    }))
    .reverse();
  return {
    mode,
    ...(mode === 'single' ? { target_slot: 'top' } : {}),
    person: {
      asset_id: 'original-person',
      kind: 'person',
      bytes: png,
      mime: 'image/png',
    },
    snapshot: { draft_id: 'draft-1', draft_revision: 4, slots },
    garments:
      mode === 'single' ? garments.filter((g) => g.slot === 'top') : garments,
  };
}
function providerResponse(
  data = [
    { url: 'https://images.example.test/result.png', output_format: 'png' },
  ],
  rest = {},
) {
  return new Response(
    JSON.stringify({
      data,
      model: DEFAULT_MODEL,
      usage: { generated_images: 1 },
      ...rest,
    }),
    {
      headers: {
        'x-request-id': 'req-123',
        'content-type': 'application/json',
      },
    },
  );
}

test('outfit references are sorted by slots and scarf receives its own role', () => {
  const { plan, request } = buildSeedreamRequest(input());
  assert.deepEqual(
    plan.garments.map((g) => g.slot),
    ['coat', 'top', 'bottom', 'shoes', 'bag'],
  );
  assert.equal(request.image.length, 6);
  assert.match(request.prompt, /外套替换为图2/);
  assert.match(request.prompt, /围巾替换为图6/);
  assert.doesNotMatch(request.prompt, /将包替换/);
  assert.equal(request.watermark, true);
  assert.equal(request.model, DEFAULT_MODEL);
  assert.equal(request.size, '2K');
  for (const unsupported of ['stream', 'sequential_image_generation', 'tools'])
    assert.equal(request[unsupported], undefined);
});
test('single uses original person and exactly one selected reference', () => {
  const { request, plan } = buildSeedreamRequest(input('single'));
  assert.equal(request.image.length, 2);
  assert.match(request.prompt, /上装替换为图2/);
  assert.match(request.prompt, /保留图1其余衣物/);
  assert.equal(plan.person.asset_id, 'original-person');
  const changed = input('single');
  changed.person.kind = 'tryon_result';
  assert.throws(() => resolveTryonInput(changed), /original person/);
});
test('snapshot mismatches, missing refs, duplicate refs and conflicting modes are rejected', () => {
  const wrong = input();
  wrong.garments[0].asset_id = 'wrong';
  assert.throws(
    () => resolveTryonInput(wrong),
    (error) => error.code === 'SNAPSHOT_MISMATCH',
  );
  const missing = input();
  missing.garments.pop();
  assert.throws(() => resolveTryonInput(missing), /match exactly/);
  const duplicate = input();
  duplicate.garments.push(duplicate.garments[0]);
  assert.throws(() => resolveTryonInput(duplicate), /duplicate/);
  const noTarget = input('single');
  delete noTarget.target_slot;
  assert.throws(() => resolveTryonInput(noTarget), /requires target_slot/);
  assert.throws(
    () => resolveTryonInput({ ...input(), target_slot: 'coat' }),
    /forbids/,
  );
});
test('omitted outfit slots renumber prompt references without stale numbers', () => {
  const selected = input();
  delete selected.snapshot.slots.coat;
  selected.garments = selected.garments.filter((g) => g.slot !== 'coat');
  assert.match(buildSeedreamRequest(selected).request.prompt, /上装替换为图2/);
});
test('unknown POST is never automatically resent and does not leak thrown transport messages', async () => {
  let calls = 0;
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls++;
      throw new Error('sensitive transport details', { cause: { code: 'ETIMEDOUT', message: 'private address' } });
    },
  });
  await assert.rejects(
    adapter.generate(input('single')),
    (error) =>
      error instanceof SeedreamError &&
      error.outcome === 'unknown' &&
      error.transport_code === 'ETIMEDOUT' &&
      !JSON.stringify(error).includes('private address') &&
      !error.message.includes('sensitive') &&
      !error.retryable,
  );
  assert.equal(calls, 1);
});
test('HTTP 200 error and empty data cannot become success', async () => {
  for (const response of [
    providerResponse([], {
      error: { code: 'ContentRejected', message: 'private details' },
    }),
    providerResponse([], { success: false }),
    providerResponse([]),
  ]) {
    let calls = 0;
    const adapter = new SeedreamAdapter({
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls++;
        return response;
      },
    });
    await assert.rejects(adapter.generate(input('single')), (error) =>
      ['PROVIDER_REJECTED', 'INVALID_RESPONSE'].includes(error.code),
    );
    assert.equal(calls, 1);
  }
});
test('unsafe response URLs are rejected without following them', async () => {
  for (const url of [
    'http://example.com/a.png',
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://localhost/a.png',
    'https://name:secret@example.com/a.png',
    'https://example.com:8443/a.png',
  ]) {
    let calls = 0;
    const adapter = new SeedreamAdapter({
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls++;
        return providerResponse([{ url }]);
      },
    });
    await assert.rejects(
      adapter.generate(input('single')),
      (error) => error.outcome === 'invalid_response',
    );
    assert.equal(calls, 1);
  }
});
test('download rejects redirects, oversized responses and corrupt image bodies without retries', async () => {
  for (const response of [
    new Response('', {
      status: 302,
      headers: { location: 'https://127.0.0.1/private' },
    }),
    new Response('', {
      headers: { 'content-length': String(41 * 1024 * 1024) },
    }),
    new Response('not an image', { headers: { 'content-type': 'image/png' } }),
  ]) {
    let calls = 0;
    const adapter = new SeedreamAdapter({
      lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
      fetchImpl: async () => {
        calls++;
        return response;
      },
    });
    await assert.rejects(
      adapter.downloadResult({
        version: 1,
        mime: 'image/png',
        url: 'https://images.example.test/result.png',
      }),
      (error) => error.outcome === 'download_failed',
    );
    assert.equal(calls, 1);
  }
});
test('decoded image outside the model output range is rejected', async () => {
  const tiny = await sharp({
    create: { width: 16, height: 16, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    new SeedreamAdapter().downloadResult({
      version: 1,
      mime: 'image/png',
      b64_json: tiny.toString('base64'),
    }),
    (error) => error.outcome === 'download_failed',
  );
});
test('truncated response leaves POST outcome unknown', async () => {
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    fetchImpl: async () => new Response('{'),
  });
  await assert.rejects(
    adapter.generate(input('single')),
    (error) => error.outcome === 'unknown',
  );
});
test('invalid input images fail before any POST', async () => {
  let calls = 0;
  const broken = input('single');
  broken.person.bytes = Buffer.from('not-an-image');
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls++;
      return providerResponse();
    },
  });
  await assert.rejects(
    adapter.generate(broken),
    (error) => error.code === 'INVALID_IMAGE',
  );
  assert.equal(calls, 0);
});
test('persisted checkpoint allows download-only recovery and no authorization on download', async () => {
  const methods = [];
  let downloadAttempt = 0;
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async (_url, options) => {
      methods.push(options.method);
      if (options.method === 'POST') return providerResponse();
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, 'error');
      if (++downloadAttempt === 1) throw new Error('temporary');
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  const checkpoint = JSON.parse(
    JSON.stringify(await adapter.generate(input('single'))),
  );
  assert.equal(checkpoint.original_person_asset_id, 'original-person');
  assert.equal(checkpoint.request_id, 'req-123');
  await assert.rejects(
    adapter.downloadResult(checkpoint),
    (error) => error.outcome === 'download_failed',
  );
  const result = await adapter.downloadResult(checkpoint);
  assert.equal(result.width, 1024);
  assert.equal(result.height, 1024);
  assert.deepEqual(methods, ['POST', 'GET', 'GET']);
});
test('private destinations are rejected before download', async () => {
  let calls = 0;
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => {
      calls++;
      return providerResponse();
    },
  });
  await assert.rejects(
    adapter.downloadResult({
      version: 1,
      mime: 'image/png',
      url: 'https://images.example.test/r.png',
    }),
    (error) => error.outcome === 'download_failed',
  );
  assert.equal(calls, 0);
});
test('valid base64 response can be recovered without a GET', async () => {
  let calls = 0;
  const adapter = new SeedreamAdapter({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls++;
      return providerResponse([
        { b64_json: png.toString('base64'), output_format: 'png' },
      ]);
    },
  });
  const result = await adapter.downloadResult(
    await adapter.generate(input('single')),
  );
  assert.equal(result.mime, 'image/png');
  assert.equal(calls, 1);
});
test('portable skill implementation is byte-identical to the canonical package', async () => {
  assert.equal(
    await readFile(new URL('./index.mjs', import.meta.url), 'utf8'),
    await readFile(
      new URL(
        '../../skills/seedream-tryon/scripts/seedream-client.mjs',
        import.meta.url,
      ),
      'utf8',
    ),
  );
});
test('all 12 single garments preserve the exact atlas pixels and manifest hashes', async () => {
  const root = new URL('../../', import.meta.url);
  const manifest = JSON.parse(
    await readFile(
      new URL('public/assets/garments/manifest.json', root),
      'utf8',
    ),
  );
  assert.equal(manifest.assets.length, 12);
  assert.equal(new Set(manifest.assets.map((asset) => asset.id)).size, 12);
  const expectedSources = {
    oat: 'products-cutout.png',
    navy: 'products-cutout.png',
    trouser: 'products-cutout.png',
    bag: 'products-cutout.png',
    tee: 'wardrobe-essentials-cutout.png',
    jeans: 'wardrobe-essentials-cutout.png',
    shoe: 'wardrobe-essentials-cutout.png',
    scarf: 'wardrobe-essentials-cutout.png',
    'red-knit': 'statement-items.png',
    'lilac-cardigan': 'statement-items.png',
    'mint-pants': 'statement-items.png',
    'black-boots': 'statement-items.png',
  };
  for (const asset of manifest.assets) {
    assert.equal(
      asset.source.file,
      `public/images/${expectedSources[asset.id]}`,
    );
    const bytes = await readFile(new URL(asset.file, root));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      asset.sha256,
    );
    const metadata = await sharp(bytes).metadata();
    assert.equal(
      metadata.hasAlpha,
      true,
      `${asset.id} keeps its transparent canvas`,
    );
    const alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer();
    assert.ok(
      alpha.includes(0),
      `${asset.id} has fully transparent background pixels`,
    );
    assert.ok(alpha.includes(255), `${asset.id} keeps opaque garment pixels`);
    const crop = asset.source.crop_rect;
    const expected = await sharp(
      await readFile(new URL(asset.source.file, root)),
    )
      .extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(bytes).ensureAlpha().raw().toBuffer();
    assert.deepEqual(actual, expected, asset.id);
  }
});
