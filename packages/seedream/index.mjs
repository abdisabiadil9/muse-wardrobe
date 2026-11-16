import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export const DEFAULT_MODEL = 'doubao-seedream-5-5-261028';
export const SEEDREAM_ENDPOINT =
  'https://ark.cn-beijing.volces.com/api/v3/images/generations';
export const PROMPT_VERSION = 'seedream-tryon-v1';
export const SLOT_ORDER = Object.freeze([
  'coat',
  'top',
  'bottom',
  'shoes',
  'bag',
]);
const SLOT_LABELS = {
  coat: '外套',
  top: '上装',
  bottom: '下装',
  shoes: '鞋履',
  bag: '配饰',
};
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_RESULT_BYTES = 40 * 1024 * 1024;
const INPUT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const OUTPUT_MIMES = new Set(['image/jpeg', 'image/png']);
const MODEL_CAPABILITIES = Object.freeze({
  [DEFAULT_MODEL]: { maxReferences: 10 },
});

export class SeedreamError extends Error {
  constructor(
    code,
    message,
    { outcome = 'rejected', request_id, status, provider_code } = {},
  ) {
    super(message);
    this.name = 'SeedreamError';
    this.code = code;
    this.outcome = outcome;
    this.retryable = false;
    if (request_id) this.request_id = request_id;
    if (status !== undefined) this.status = status;
    if (provider_code) this.provider_code = provider_code;
  }
}

function fail(code, message, options) {
  throw new SeedreamError(code, message, options);
}
function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim())
    fail('INVALID_INPUT', `${field} is required`);
  return value;
}
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function imageBytes(asset, label) {
  if (!asset || !INPUT_MIMES.has(asset.mime))
    fail('INVALID_INPUT', `${label}: expected PNG, JPEG or WebP`);
  if (
    !(asset.bytes instanceof Uint8Array) ||
    !asset.bytes.length ||
    asset.bytes.length > MAX_IMAGE_BYTES
  ) {
    fail('INVALID_INPUT', `${label}: image bytes missing or larger than 30 MB`);
  }
  return Buffer.from(asset.bytes);
}
function cleanDescription(value) {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t<>"'`]/g, ' ')
        .trim()
        .slice(0, 60)
    : '';
}
function garmentLabel(garment) {
  if (garment.slot !== 'bag') return SLOT_LABELS[garment.slot];
  if (garment.garment_kind === 'scarf') return '围巾';
  if (garment.garment_kind === 'bag') return '包';
  return '配饰';
}

/** Pure planning. The caller authenticates ownership and loads this immutable DB snapshot. */
export function resolveTryonInput(input) {
  if (!input || !['single', 'outfit'].includes(input.mode))
    fail('INVALID_INPUT', 'mode must be single or outfit');
  if (input.mode === 'single' && !SLOT_ORDER.includes(input.target_slot))
    fail('INVALID_INPUT', 'single mode requires target_slot');
  if (input.mode === 'outfit' && input.target_slot !== undefined)
    fail('INVALID_INPUT', 'outfit mode forbids target_slot');
  const snapshot = input.snapshot;
  requiredString(snapshot?.draft_id, 'snapshot.draft_id');
  if (
    !Number.isInteger(snapshot?.draft_revision) ||
    snapshot.draft_revision < 0 ||
    !snapshot.slots ||
    typeof snapshot.slots !== 'object'
  ) {
    fail(
      'INVALID_INPUT',
      'An authoritative draft revision and slots snapshot are required',
    );
  }
  const person = input.person;
  requiredString(person?.asset_id, 'person.asset_id');
  if (person.kind !== 'person')
    fail(
      'INVALID_INPUT',
      'person must be an original person asset, never a tryon result',
    );
  const personBytes = imageBytes(person, 'person');
  if (!Array.isArray(input.garments))
    fail('INVALID_INPUT', 'garments must be resolved from the snapshot');
  const wantedSlots =
    input.mode === 'single'
      ? [input.target_slot]
      : SLOT_ORDER.filter((slot) => snapshot.slots[slot] != null);
  if (!wantedSlots.length) fail('MISSING_ASSET', 'No selected garments');
  const bySlot = new Map();
  for (const garment of input.garments) {
    if (
      !garment ||
      !SLOT_ORDER.includes(garment.slot) ||
      bySlot.has(garment.slot)
    )
      fail('INVALID_INPUT', 'Unknown or duplicate garment slot');
    bySlot.set(garment.slot, garment);
  }
  // Extra refs are rejected instead of accidentally leaking unrelated wardrobe images.
  if (
    bySlot.size !== wantedSlots.length ||
    [...bySlot.keys()].some((slot) => !wantedSlots.includes(slot))
  ) {
    fail(
      'INVALID_INPUT',
      'garments must match exactly the requested snapshot slots',
    );
  }
  const garments = wantedSlots.map((slot) => {
    const selected = snapshot.slots[slot];
    const garment = bySlot.get(slot);
    if (!selected || !garment || !selected.asset_id)
      fail('MISSING_ASSET', `Missing selected ${slot} reference`);
    if (
      selected.asset_id !== garment.asset_id ||
      (selected.ref_id && selected.ref_id !== garment.ref_id)
    ) {
      fail(
        'SNAPSHOT_MISMATCH',
        `The ${slot} reference does not match the frozen draft`,
      );
    }
    const bytes = imageBytes(garment, slot);
    return {
      slot,
      asset_id: garment.asset_id,
      ref_id: garment.ref_id,
      name: cleanDescription(garment.name),
      garment_kind: garment.garment_kind,
      mime: garment.mime,
      bytes,
      sha256: hash(bytes),
    };
  });
  const result = {
    mode: input.mode,
    ...(input.mode === 'single' ? { target_slot: input.target_slot } : {}),
    draft_id: snapshot.draft_id,
    draft_revision: snapshot.draft_revision,
    person: {
      asset_id: person.asset_id,
      kind: 'person',
      mime: person.mime,
      bytes: personBytes,
      sha256: hash(personBytes),
    },
    garments,
  };
  result.input_hash = hash(
    JSON.stringify({
      mode: result.mode,
      target_slot: result.target_slot,
      draft_id: result.draft_id,
      draft_revision: result.draft_revision,
      person: {
        asset_id: result.person.asset_id,
        sha256: result.person.sha256,
      },
      garments: garments.map(
        ({ slot, asset_id, ref_id, sha256, garment_kind }) => ({
          slot,
          asset_id,
          ref_id,
          sha256,
          garment_kind,
        }),
      ),
    }),
  );
  return result;
}

export function buildSeedreamRequest(
  input,
  { model = DEFAULT_MODEL, modelCapability = DEFAULT_MODEL } = {},
) {
  const plan = resolveTryonInput(input);
  requiredString(model, 'model');
  const capabilities = MODEL_CAPABILITIES[modelCapability];
  if (!capabilities)
    fail('UNSUPPORTED_MODEL', 'Select a verified model capability profile');
  if (model !== DEFAULT_MODEL && !model.startsWith('ep-'))
    fail(
      'UNSUPPORTED_MODEL',
      'Model must be the verified version or its configured Endpoint ID',
    );
  if (plan.garments.length + 1 > capabilities.maxReferences)
    fail('INVALID_INPUT', 'Too many reference images');
  const assignments = plan.garments
    .map(
      (garment, index) =>
        `将${garmentLabel(garment)}替换为图${index + 2}中的对应单品`,
    )
    .join('；');
  const preserve =
    plan.mode === 'single'
      ? '仅修改指定单品，保留图1其余衣物与配饰。'
      : '按所有参考单品形成完整穿搭；外套在上装外层，鞋成对自然穿着，配饰按类型自然佩戴。未指定的服饰保留图1原样。';
  const prompt = `以图1人物为唯一主体，保留其面部、发型、肤色、体型、姿态、构图与背景。${assignments}。${preserve}保持参考单品的颜色、纹理、图案和轮廓，遮挡与穿着关系自然。只输出一张同一人物的真实感试穿照片，不添加其他人物、文字或拼图。`;
  const refs = [plan.person, ...plan.garments];
  return {
    plan,
    request: {
      model,
      prompt,
      image: refs.map(
        (ref) => `data:${ref.mime};base64,${ref.bytes.toString('base64')}`,
      ),
      size: '2K',
      output_format: 'png',
      background: 'opaque',
      response_format: 'url',
      watermark: true,
    },
    metadata: {
      input_hash: plan.input_hash,
      prompt_version: PROMPT_VERSION,
      model,
      model_capability: modelCapability,
    },
  };
}

async function decodeImage(bytes, declaredMime, allowedMimes = INPUT_MIMES) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    fail(
      'IMAGE_DECODER_UNAVAILABLE',
      'Install sharp before executing image requests',
    );
  }
  let meta;
  try {
    const decoder = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: 36_000_000,
      animated: true,
    });
    meta = await decoder.metadata();
    // A metadata-only check accepts some truncated images; decode a thumbnail too.
    await decoder
      .resize({ width: 32, height: 32, fit: 'inside' })
      .raw()
      .toBuffer();
  } catch {
    fail(
      'INVALID_IMAGE',
      'Image is incomplete, unsupported or exceeds pixel limits',
    );
  }
  const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[
    meta.format
  ];
  if (
    !allowedMimes.has(mime) ||
    mime !== declaredMime ||
    (meta.pages ?? 1) !== 1
  )
    fail('INVALID_IMAGE', 'Image format mismatch or animated image');
  const { width, height } = meta;
  if (
    !width ||
    !height ||
    width <= 14 ||
    height <= 14 ||
    width / height < 1 / 16 ||
    width / height > 16 ||
    width * height > 36_000_000
  ) {
    fail('INVALID_IMAGE', 'Image dimensions are outside supported limits');
  }
  return { mime, width, height };
}

function providerCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
    ? value
    : undefined;
}
function publicIp(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    return !(
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) ||
      ip.startsWith('ff') ||
      ip.startsWith('::ffff:')
    );
  }
  return false;
}
function safeUrl(value, allowedHosts) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_RESPONSE', 'Provider image URL is invalid', {
      outcome: 'invalid_response',
    });
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    fail('INVALID_RESPONSE', 'Provider image URL must use standard HTTPS', {
      outcome: 'invalid_response',
    });
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (isIP(host) && !publicIp(host))
  )
    fail('INVALID_RESPONSE', 'Non-public image destination rejected', {
      outcome: 'invalid_response',
    });
  if (
    allowedHosts &&
    !allowedHosts.some(
      (allowed) =>
        host === allowed ||
        (allowed.startsWith('*.') && host.endsWith(allowed.slice(1))),
    )
  )
    fail('INVALID_RESPONSE', 'Provider image host is not allowed', {
      outcome: 'invalid_response',
    });
  return url;
}
async function readLimited(response, limit) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit)
    throw new Error('Response too large');
  if (!response.body) throw new Error('Empty response');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function downloadWithPinnedDns(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    const selected = addresses[0];
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        signal,
        // Use the addresses already verified above, preventing a second DNS lookup
        // from rebinding a public-looking host to an internal service.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        if (
          !response.statusCode ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          response.destroy();
          reject(new Error('Download unavailable or redirect rejected'));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        resolve(
          new Response(Readable.toWeb(response), {
            status: response.statusCode,
            headers,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** One POST only. Persist its returned checkpoint before attempting downloadResult. */
export class SeedreamAdapter {
  #apiKey;
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    modelCapability = DEFAULT_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 180_000,
    downloadTimeoutMs = 30_000,
    allowedDownloadHosts,
    lookupImpl = lookup,
  } = {}) {
    if (typeof fetchImpl !== 'function')
      fail('INVALID_INPUT', 'fetchImpl is required');
    if (
      ![timeoutMs, downloadTimeoutMs].every(
        (value) => Number.isInteger(value) && value > 0,
      )
    )
      fail('INVALID_INPUT', 'Timeouts must be positive milliseconds');
    if (
      allowedDownloadHosts !== undefined &&
      (!Array.isArray(allowedDownloadHosts) ||
        !allowedDownloadHosts.length ||
        allowedDownloadHosts.some(
          (host) => typeof host !== 'string' || !host.length,
        ))
    )
      fail('INVALID_INPUT', 'allowedDownloadHosts must contain host names');
    this.#apiKey = apiKey;
    this.model = model;
    this.modelCapability = modelCapability;
    this.fetchImpl = fetchImpl;
    this.useNativeDownload = fetchImpl === globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.allowedDownloadHosts = allowedDownloadHosts;
    this.lookupImpl = lookupImpl;
  }

  async generate(input, { signal } = {}) {
    requiredString(this.#apiKey, 'apiKey');
    const { plan, request, metadata } = buildSeedreamRequest(input, {
      model: this.model,
      modelCapability: this.modelCapability,
    });
    for (const ref of [plan.person, ...plan.garments])
      await decodeImage(ref.bytes, ref.mime);
    if (signal?.aborted)
      fail('CANCELLED_BEFORE_SEND', 'Request cancelled before dispatch');
    let response;
    try {
      response = await this.fetchImpl(SEEDREAM_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      fail(
        'POST_OUTCOME_UNKNOWN',
        'Generation response was not received; do not automatically resubmit',
        { outcome: 'unknown' },
      );
    }
    const request_id =
      response.headers.get('x-request-id') ||
      response.headers.get('x-tt-logid') ||
      undefined;
    let body;
    try {
      body = JSON.parse(
        (await readLimited(response, 64 * 1024 * 1024)).toString('utf8'),
      );
    } catch {
      fail(
        'POST_OUTCOME_UNKNOWN',
        'Generation response could not be read; do not automatically resubmit',
        { outcome: 'unknown', request_id, status: response.status },
      );
    }
    if (!response.ok || body?.error || body?.success === false) {
      fail('PROVIDER_REJECTED', 'Image provider returned an error', {
        outcome: 'rejected',
        request_id,
        status: response.status,
        provider_code: providerCode(body?.error?.code),
      });
    }
    if (
      !body ||
      !Array.isArray(body.data) ||
      body.data.length !== 1 ||
      !body.data[0] ||
      body.data[0].error
    ) {
      fail('INVALID_RESPONSE', 'Expected one successful image result', {
        outcome: 'invalid_response',
        request_id,
      });
    }
    const item = body.data[0];
    const hasUrl = typeof item.url === 'string' && item.url.length > 0;
    const hasBase64 =
      typeof item.b64_json === 'string' && item.b64_json.length > 0;
    if (hasUrl === hasBase64)
      fail(
        'INVALID_RESPONSE',
        'Expected exactly one image URL or base64 payload',
        { outcome: 'invalid_response', request_id },
      );
    if (hasUrl) safeUrl(item.url, this.allowedDownloadHosts);
    if (
      hasBase64 &&
      (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json) ||
        item.b64_json.length > Math.ceil(MAX_RESULT_BYTES / 3) * 4)
    ) {
      fail('INVALID_RESPONSE', 'Invalid image base64 payload', {
        outcome: 'invalid_response',
        request_id,
      });
    }
    const mime = item.output_format === 'jpeg' ? 'image/jpeg' : 'image/png';
    if (item.output_format && !['png', 'jpeg'].includes(item.output_format))
      fail('INVALID_RESPONSE', 'Unsupported image output format', {
        outcome: 'invalid_response',
        request_id,
      });
    const usage = {};
    for (const key of [
      'generated_images',
      'input_images',
      'output_tokens',
      'total_tokens',
    ]) {
      const value = body.usage?.[key];
      if (Number.isInteger(value) && value >= 0) usage[key] = value;
    }
    return {
      version: 1,
      ...(hasUrl ? { url: item.url } : { b64_json: item.b64_json }),
      mime,
      ...(request_id ? { request_id } : {}),
      usage,
      ...metadata,
      mode: plan.mode,
      ...(plan.target_slot ? { target_slot: plan.target_slot } : {}),
      original_person_asset_id: plan.person.asset_id,
      draft_id: plan.draft_id,
      draft_revision: plan.draft_revision,
      received_at: new Date().toISOString(),
    };
  }

  /** May be called again with the same persisted checkpoint; never sends a POST. */
  async downloadResult(checkpoint, { signal } = {}) {
    if (
      !checkpoint ||
      checkpoint.version !== 1 ||
      !OUTPUT_MIMES.has(checkpoint.mime) ||
      Boolean(checkpoint.url) === Boolean(checkpoint.b64_json)
    )
      fail('INVALID_CHECKPOINT', 'Invalid generation checkpoint');
    let bytes;
    try {
      if (checkpoint.b64_json) {
        if (
          typeof checkpoint.b64_json !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(checkpoint.b64_json)
        )
          throw new Error('Invalid base64');
        bytes = Buffer.from(checkpoint.b64_json, 'base64');
      } else {
        const url = safeUrl(checkpoint.url, this.allowedDownloadHosts);
        const addresses = await this.lookupImpl(
          url.hostname.replace(/^\[|\]$/g, ''),
          { all: true, verbatim: true },
        );
        if (
          !addresses.length ||
          addresses.some((record) => !publicIp(record.address))
        )
          throw new Error('Non-public DNS destination');
        const downloadSignal = signal
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(this.downloadTimeoutMs),
            ])
          : AbortSignal.timeout(this.downloadTimeoutMs);
        const response = this.useNativeDownload
          ? await downloadWithPinnedDns(url, addresses, downloadSignal)
          : await this.fetchImpl(url.toString(), {
              method: 'GET',
              redirect: 'error',
              signal: downloadSignal,
            });
        if (!response.ok) throw new Error('Download unavailable');
        const mime = response.headers.get('content-type')?.split(';')[0].trim();
        if (
          mime &&
          mime !== checkpoint.mime &&
          mime !== 'application/octet-stream'
        )
          throw new Error('Download content type mismatch');
        bytes = await readLimited(response, MAX_RESULT_BYTES);
      }
      if (!bytes.length || bytes.length > MAX_RESULT_BYTES)
        throw new Error('Invalid image size');
      const image = await decodeImage(bytes, checkpoint.mime, OUTPUT_MIMES);
      if (
        image.width * image.height < 921_600 ||
        image.width * image.height > 4_624_220
      )
        throw new Error('Output dimensions do not match the verified model');
      return {
        bytes,
        ...image,
        sha256: hash(bytes),
        request_id: checkpoint.request_id,
        usage: checkpoint.usage ?? {},
      };
    } catch {
      fail(
        'RESULT_DOWNLOAD_FAILED',
        'Could not save the generated image; retry download from the same checkpoint',
        { outcome: 'download_failed', request_id: checkpoint.request_id },
      );
    }
  }
}
