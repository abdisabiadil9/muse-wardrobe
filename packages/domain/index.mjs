import { one, all } from '../db/index.mjs';
export const CATEGORIES = ['coat', 'top', 'bottom', 'shoes', 'bag'];
export const TERMINAL = ['succeeded', 'failed', 'cancelled', 'unconfirmed'];
export class AppError extends Error {
  constructor(status, code, message, details, retryable = false) {
    super(message);
    Object.assign(this, { status, code, details, retryable });
  }
}
export const fail = (status, code, message, details) => {
  throw new AppError(status, code, message, details);
};
export const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export const requireUUID = (value) => {
  if (!uuid(value)) fail(400, 'invalid_id', '记录标识无效');
  return value;
};
export const iso = (value) =>
  value instanceof Date ? value.toISOString() : value;
export function publicTask(t) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    stage: t.stage ?? null,
    progress: t.progress ?? null,
    last_event_seq: t.last_event_seq,
    cancel_requested_at: iso(t.cancel_requested_at) ?? null,
    result: t.result ?? null,
    error: t.error ?? null,
    question: t.question ?? null,
    created_at: iso(t.created_at),
    updated_at: iso(t.updated_at),
  };
}
export function publicDraft(d) {
  return {
    id: d.id,
    scene: d.scene,
    revision: d.revision,
    slots: d.slots,
    canvas_layout: d.canvas_layout,
    updated_at: iso(d.updated_at),
  };
}
export function publicGarment(g) {
  return {
    id: g.id,
    name: g.name,
    category: g.category,
    ...(g.color ? { color: g.color } : {}),
    ...(g.material ? { material: g.material } : {}),
    ...(g.garment_kind ? { garment_kind: g.garment_kind } : {}),
    image_asset_id: g.image_asset_id,
    measurements: g.measurements,
    source: g.source,
    revision: g.revision,
    created_at: iso(g.created_at),
    updated_at: iso(g.updated_at),
  };
}
export function publicOutfit(o) {
  return {
    id: o.id,
    draft_id: o.draft_id,
    source_revision: o.source_revision,
    snapshot: o.snapshot,
    ...(o.worn_date ? { worn_date: iso(o.worn_date).slice(0, 10) } : {}),
    created_at: iso(o.created_at),
  };
}
export const owned = async (db, table, id, owner) => {
  const allowed = [
    'tasks',
    'garments',
    'media_assets',
    'outfit_versions',
    'outfit_drafts',
    'wear_feedback',
  ];
  if (!allowed.includes(table)) throw new Error('Invalid repository');
  const row = await one(
    db,
    `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2`,
    [requireUUID(id), owner],
  );
  if (!row) fail(404, 'not_found', '记录不存在');
  return row;
};
export async function validAsset(db, id, owner, kind) {
  const a = await owned(db, 'media_assets', id, owner);
  if (
    a.status !== 'ready' ||
    (a.expires_at && a.expires_at < new Date()) ||
    (kind && a.kind !== kind)
  )
    fail(422, 'asset_unavailable', '图片尚未准备好或已失效');
  return a;
}
export async function validateSlots(db, slots, owner) {
  if (!slots || typeof slots !== 'object' || Array.isArray(slots))
    fail(400, 'invalid_slots', '搭配内容无效');
  for (const [slot, ref] of Object.entries(slots)) {
    if (!CATEGORIES.includes(slot) || !ref || ref.source !== 'wardrobe')
      fail(422, 'unsupported_item', '首版仅支持已拥有的衣物');
    const g = await owned(db, 'garments', ref.ref_id, owner);
    if (
      g.deleted_at ||
      g.category !== slot ||
      g.image_asset_id !== ref.asset_id
    )
      fail(422, 'invalid_garment_reference', '衣物引用或分类不匹配');
    await validAsset(db, ref.asset_id, owner, 'garment');
  }
}
export function garmentRepository(db) {
  return {
    listGarments: (owner, category) =>
      all(
        db,
        'SELECT * FROM garments WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR category=$2)',
        [owner, category ?? null],
      ),
    getGarments: (owner, ids) =>
      all(
        db,
        'SELECT * FROM garments WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL',
        [owner, ids],
      ),
  };
}
