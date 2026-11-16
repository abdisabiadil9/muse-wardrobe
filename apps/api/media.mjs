import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { digest } from '../../packages/db/index.mjs';
import { AppError } from '../../packages/domain/index.mjs';
export class PrivateMedia {
  constructor({ root, secret, basePath = '/api/v1/media' }) {
    if (!secret || secret.length < 24)
      throw new Error(
        'Media signing secret must contain at least 24 characters',
      );
    this.root = resolve(root);
    this.secret = secret;
    this.basePath = basePath;
  }
  path(key) {
    if (!/^[a-f0-9-]{36}(\.upload)?$/.test(key))
      throw new Error('Invalid object key');
    return join(this.root, key);
  }
  token(asset, action, ttl = 900) {
    const data = Buffer.from(
      JSON.stringify({
        id: asset.id,
        owner: asset.owner_id,
        action,
        exp: Math.floor(Date.now() / 1000) + ttl,
      }),
    ).toString('base64url');
    return (
      data +
      '.' +
      createHmac('sha256', this.secret).update(data).digest('base64url')
    );
  }
  verify(token, asset, action) {
    try {
      const [data, signature] = String(token).split('.');
      const expected = createHmac('sha256', this.secret).update(data).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return false;
      const p = JSON.parse(Buffer.from(data, 'base64url').toString());
      return (
        p.id === asset.id &&
        p.owner === asset.owner_id &&
        p.action === action &&
        p.exp > Math.floor(Date.now() / 1000)
      );
    } catch {
      return false;
    }
  }
  url(asset, action = 'download') {
    return `${this.basePath}/${asset.id}/content?token=${encodeURIComponent(this.token(asset, action))}`;
  }
  async upload(asset, bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== Number(asset.bytes) ||
      bytes.length > 10 * 1024 * 1024
    )
      throw new AppError(422, 'invalid_upload_size', '上传图片大小不符');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(asset.object_key + '.upload'), bytes, {
      mode: 0o600,
    });
  }
  async complete(asset, expectedHash) {
    let bytes;
    try {
      bytes = await readFile(this.path(asset.object_key + '.upload'));
    } catch {
      throw new AppError(422, 'upload_missing', '请先上传图片');
    }
    const uploadedHash = digest(bytes);
    if (uploadedHash !== expectedHash)
      throw new AppError(
        422,
        'checksum_mismatch',
        '图片校验不一致，请重新上传',
      );
    const clean = await this.normalize(bytes, asset.mime);
    await writeFile(this.path(asset.object_key + '.upload'), clean.bytes, {
      mode: 0o600,
    });
    await rename(
      this.path(asset.object_key + '.upload'),
      this.path(asset.object_key),
    );
    return {
      ...clean,
      sha256: digest(clean.bytes),
      upload_sha256: uploadedHash,
    };
  }
  async normalize(bytes, expectedMime) {
    try {
      const image = sharp(bytes, {
        limitInputPixels: 36_000_000,
        failOn: 'error',
      });
      const meta = await image.metadata();
      const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[
        meta.format
      ];
      if (
        !mime ||
        (expectedMime && mime !== expectedMime) ||
        !meta.width ||
        !meta.height ||
        meta.width < 15 ||
        meta.height < 15 ||
        (meta.pages ?? 1) > 1
      )
        throw new Error('Invalid image');
      const out = await image.rotate().toFormat(meta.format).toBuffer();
      return { bytes: out, mime, width: meta.width, height: meta.height };
    } catch {
      throw new AppError(422, 'invalid_image', '图片格式、尺寸或内容无效');
    }
  }
  async put(asset, bytes, mime) {
    const clean = await this.normalize(bytes, mime);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(asset.object_key), clean.bytes, { mode: 0o600 });
    return { ...clean, sha256: digest(clean.bytes) };
  }
  read(asset) {
    return readFile(this.path(asset.object_key));
  }
  async remove(asset) {
    await Promise.all([
      rm(this.path(asset.object_key), { force: true }),
      rm(this.path(asset.object_key + '.upload'), { force: true }),
    ]);
  }
  public(asset) {
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      mime: asset.mime,
      bytes: Number(asset.bytes),
      ...(asset.status === 'ready'
        ? {
            download_url: this.url(asset),
            expires_at: new Date(Date.now() + 900000).toISOString(),
          }
        : {}),
    };
  }
}
