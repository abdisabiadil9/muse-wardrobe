import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  transaction,
  one,
  all,
  digest,
  ensureUser,
  emitEvent,
} from '../../packages/db/index.mjs';
import {
  AppError,
  fail,
  owned,
  validAsset,
  validateSlots,
  publicTask,
  publicDraft,
  publicGarment,
  publicOutfit,
  iso,
  TERMINAL,
  requireUUID,
} from '../../packages/domain/index.mjs';
import { PrivateMedia } from './media.mjs';
import { PROMPT_VERSION } from '../../packages/seedream/index.mjs';
import { publicAgentEvent } from '../../packages/qoder/public-events.mjs';

const DEV_USER = '00000000-0000-4000-8000-000000000001';
export async function createApp({ pool, media: providedMedia, ...config }) {
  const app = Fastify({
    logger: config.logger ?? false,
    bodyLimit: 256 * 1024,
    disableRequestLogging: true,
  });
  const media =
    providedMedia ??
    new PrivateMedia({
      root: config.mediaRoot ?? '.local/media',
      secret: config.sessionSecret,
    });
  if (config.devAuth && config.production)
    throw new Error('Development identity is prohibited in production');
  const contract = JSON.parse(
    await readFile(
      new URL('../../docs/contracts/openapi.json', import.meta.url),
      'utf8',
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();
  const validate = (path, method, body, override) => {
    const key = path + method;
    let v = validators.get(key);
    if (!v) {
      const schema =
        override ??
        contract.paths[path]?.[method]?.requestBody?.content?.[
          'application/json'
        ]?.schema;
      if (!schema) return;
      v = ajv.compile({ ...schema, components: contract.components });
      validators.set(key, v);
    }
    if (!v(body))
      fail(400, 'invalid_request', '请求内容无效', {
        fields: v.errors?.map((e) => ({
          path: e.instancePath,
          reason: e.keyword,
        })),
      });
  };
  await app.register(cookie);
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 },
    (req, body, done) => done(null, body),
  );
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const path = req.url.split('?')[0];
    if (path === '/api/v1/capabilities' || path === '/healthz') return;
    if (path.startsWith('/api/v1/auth/')) {
      if (path !== '/api/v1/auth/logout') return;
    }
    const sessionId = req.cookies.muse_session;
    if (sessionId) {
      const s = await one(
        pool,
        'SELECT s.*,u.display_name,u.timezone,u.deleting FROM auth_sessions s JOIN users u ON u.id=s.owner_id WHERE s.id=$1 AND s.expires_at>now()',
        [sessionId],
      );
      if (s) {
        req.session = s;
        req.user = {
          id: s.owner_id,
          display_name: s.display_name,
          timezone: s.timezone,
          deleting: s.deleting,
        };
      }
    }
    if (
      !req.user &&
      path === '/api/v1/me' &&
      req.method === 'GET' &&
      config.devAuth
    ) {
      const owner = config.allowTestIdentityHeader
        ? requireUUID(
            req.headers['x-test-user-id'] ?? config.devUserId ?? DEV_USER,
          )
        : (config.devUserId ?? DEV_USER);
      const user = await transaction(pool, (db) => ensureUser(db, owner));
      const session = {
        id: randomBytes(32).toString('base64url'),
        owner_id: user.id,
        csrf_token: randomBytes(24).toString('base64url'),
      };
      await pool.query(
        "INSERT INTO auth_sessions(id,owner_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [session.id, user.id, session.csrf_token],
      );
      req.session = session;
      req.user = user;
      reply.setCookie('muse_session', session.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.appOrigin?.startsWith('https:') ?? false,
        path: '/',
        maxAge: 604800,
      });
    }
    if (!req.user) fail(401, 'authentication_required', '请先登录');
    if (req.user.deleting) {
      const match = /^\/api\/v1\/tasks\/([a-f0-9-]{36})(?:\/events)?$/.exec(
        path,
      );
      const deletion =
        match && req.method === 'GET'
          ? await one(
              pool,
              "SELECT id FROM tasks WHERE id=$1 AND owner_id=$2 AND type='account_deletion'",
              [match[1], req.user.id],
            )
          : null;
      if (!deletion)
        fail(409, 'account_deleting', '账户正在删除，仅可查询删除进度');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        !(config.appOrigins ?? [config.appOrigin]).includes(req.headers.origin)
      )
        fail(403, 'origin_rejected', '请求来源无效');
      if (
        !(
          req.method === 'PUT' &&
          /^\/api\/v1\/media\/[^/]+\/content$/.test(path)
        ) &&
        req.headers['x-csrf-token'] !== req.session.csrf_token
      )
        fail(403, 'csrf_rejected', '会话校验失败，请刷新后重试');
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const status = error.status ?? error.statusCode ?? 500;
    const safe = error instanceof AppError || status < 500;
    reply
      .code(status)
      .send({
        error: {
          code: safe ? (error.code ?? 'invalid_request') : 'internal_error',
          message: safe ? error.message : '服务暂时不可用',
          retryable: error.retryable ?? status >= 500,
          request_id: req.id,
          ...(error.details ? { details: error.details } : {}),
        },
      });
  });
  const route = (method, url, handler, opts = {}) =>
    app.route({ method, url: '/api/v1' + url, ...opts, handler });
  const idempotent = async (req, reply, work, status = 200) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 200)
      fail(400, 'idempotency_key_required', '需要有效的幂等请求标识');
    const routeKey = req.method + ' ' + req.url.split('?')[0],
      hash = digest(req.body ?? {});
    const out = await transaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        req.user.id + routeKey + key,
      ]);
      const old = await one(
        db,
        'SELECT * FROM idempotency_records WHERE owner_id=$1 AND route=$2 AND key=$3',
        [req.user.id, routeKey, key],
      );
      if (old) {
        if (old.request_hash !== hash)
          fail(409, 'idempotency_conflict', '同一请求标识不能用于不同内容');
        return { body: old.response, status: old.status_code };
      }
      const body = await work(db);
      await db.query(
        'INSERT INTO idempotency_records(owner_id,route,key,request_hash,response,status_code) VALUES($1,$2,$3,$4,$5,$6)',
        [req.user.id, routeKey, key, hash, body, status],
      );
      return { body, status };
    });
    return reply.code(out.status).send(out.body);
  };
  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });
  route('GET', '/capabilities', async () => ({
    mode: 'live',
    ai_styling: Boolean(config.stylingEnabled),
    image_tryon: Boolean(config.tryonEnabled),
    realtime_tryon: false,
    memory: Boolean(config.memoryEnabled),
    dream: Boolean(config.dreamEnabled),
  }));
  route('GET', '/me', async (req) => ({
    id: req.user.id,
    display_name: req.user.display_name,
    timezone: req.user.timezone,
    csrf_token: req.session.csrf_token,
    quota: {
      styling_remaining: await remaining(
        pool,
        req.user.id,
        'styling',
        config.dailyTaskLimit ?? 50,
      ),
      tryon_remaining: await remaining(
        pool,
        req.user.id,
        'tryon',
        config.dailyTaskLimit ?? 50,
      ),
    },
  }));
  route('GET', '/auth/login', async () =>
    fail(
      503,
      'identity_provider_unconfigured',
      '真实登录尚未配置；本地开发可使用开发会话',
    ),
  );
  route('GET', '/auth/callback', async () =>
    fail(503, 'identity_provider_unconfigured', '真实登录尚未配置'),
  );
  route('POST', '/auth/logout', async (req, reply) => {
    await pool.query('DELETE FROM auth_sessions WHERE id=$1', [req.session.id]);
    reply.clearCookie('muse_session', { path: '/' });
    return reply.code(204).send();
  });
  route('GET', '/garments', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    if (req.query.cursor) requireUUID(req.query.cursor);
    const rows = await all(
      pool,
      'SELECT * FROM garments WHERE owner_id=$1 AND deleted_at IS NULL AND ($2::text IS NULL OR category=$2) AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4',
      [
        req.user.id,
        req.query.category ?? null,
        req.query.cursor ?? null,
        limit + 1,
      ],
    );
    return {
      data: rows.slice(0, limit).map(publicGarment),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  });
  route('GET', '/garments/:id', async (req) => {
    const g = await owned(pool, 'garments', req.params.id, req.user.id);
    if (g.deleted_at) fail(404, 'not_found', '衣物不存在');
    return publicGarment(g);
  });
  route('POST', '/garments', async (req, reply) => {
    validate('/garments', 'post', req.body);
    return idempotent(
      req,
      reply,
      async (db) => {
        await validAsset(db, req.body.image_asset_id, req.user.id, 'garment');
        const b = req.body;
        return publicGarment(
          await one(
            db,
            'INSERT INTO garments(id,owner_id,name,category,color,material,image_asset_id,measurements,source,garment_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [
              randomUUID(),
              req.user.id,
              b.name,
              b.category,
              b.color ?? null,
              b.material ?? null,
              b.image_asset_id,
              b.measurements ?? {},
              b.source,
              b.garment_kind ?? null,
            ],
          ),
        );
      },
      201,
    );
  });
  route('PATCH', '/garments/:id', async (req) => {
    validate('/garments/{id}', 'patch', req.body);
    return transaction(pool, async (db) => {
      const g = await owned(db, 'garments', req.params.id, req.user.id);
      if (g.deleted_at) fail(404, 'not_found', '衣物不存在');
      const b = { ...g, ...req.body };
      await validAsset(db, b.image_asset_id, req.user.id, 'garment');
      const row = await one(
        db,
        'UPDATE garments SET name=$3,category=$4,color=$5,material=$6,image_asset_id=$7,measurements=$8,source=$9,garment_kind=$11,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$10 RETURNING *',
        [
          g.id,
          req.user.id,
          b.name,
          b.category,
          b.color,
          b.material,
          b.image_asset_id,
          b.measurements,
          b.source,
          req.body.expected_revision,
          b.garment_kind ?? null,
        ],
      );
      if (!row)
        fail(409, 'revision_conflict', '衣物已被更新', {
          current_revision: (await owned(db, 'garments', g.id, req.user.id))
            .revision,
        });
      return publicGarment(row);
    });
  });
  route('DELETE', '/garments/:id', async (req, reply) => {
    const g = await owned(pool, 'garments', req.params.id, req.user.id);
    await pool.query(
      'UPDATE garments SET deleted_at=now(),revision=revision+1 WHERE id=$1 AND owner_id=$2',
      [g.id, req.user.id],
    );
    return reply.code(204).send();
  });
  route('POST', '/media/uploads', async (req, reply) => {
    validate('/media/uploads', 'post', req.body);
    return idempotent(
      req,
      reply,
      async (db) => {
        const id = randomUUID(),
          b = req.body;
        const a = await one(
          db,
          "INSERT INTO media_assets(id,owner_id,kind,object_key,mime,bytes,status,expires_at) VALUES($1::uuid,$2,$3,$1::text,$4,$5,'uploading',now()+interval '24 hours') RETURNING *",
          [id, req.user.id, b.kind, b.mime, b.bytes],
        );
        return {
          asset_id: id,
          upload_url: media.url(a, 'upload'),
          method: 'PUT',
          headers: { 'Content-Type': b.mime },
          expires_at: new Date(Date.now() + 900000).toISOString(),
        };
      },
      201,
    );
  });
  route(
    'PUT',
    '/media/:id/content',
    async (req, reply) => {
      await transaction(pool, async (db) => {
        await db.query(
          'SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [requireUUID(req.params.id), req.user.id],
        );
        const a = await owned(db, 'media_assets', req.params.id, req.user.id);
        if (
          a.status !== 'uploading' ||
          a.expires_at < new Date() ||
          !media.verify(req.query.token, a, 'upload')
        )
          fail(403, 'upload_rejected', '上传凭证无效');
        await media.upload(a, req.body);
      });
      return reply.code(204).send();
    },
    { bodyLimit: 10 * 1024 * 1024 },
  );
  route('GET', '/media/:id/content', async (req, reply) => {
    const a = await validAsset(pool, req.params.id, req.user.id);
    if (!media.verify(req.query.token, a, 'download'))
      fail(403, 'download_rejected', '图片链接已过期');
    let bytes;
    try {
      bytes = await media.read(a);
    } catch {
      fail(404, 'asset_missing', '图片已失效');
    }
    return reply
      .type(a.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .send(bytes);
  });
  route('POST', '/media/:id/complete', async (req, reply) => {
    validate('/media/{id}/complete', 'post', req.body);
    return idempotent(req, reply, async (db) => {
      await db.query(
        'SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [requireUUID(req.params.id), req.user.id],
      );
      const a = await owned(db, 'media_assets', req.params.id, req.user.id);
      if (a.status === 'ready') {
        if (a.upload_sha256 !== req.body.sha256)
          fail(409, 'checksum_conflict', '图片已使用不同内容完成');
        return media.public(a);
      }
      if (a.status !== 'uploading' || a.expires_at < new Date())
        fail(422, 'asset_unavailable', '图片无法完成');
      const clean = await media.complete(a, req.body.sha256);
      const updated = await one(
        db,
        "UPDATE media_assets SET status='ready',mime=$3,bytes=$4,sha256=$5,upload_sha256=$6,expires_at=CASE WHEN kind='garment' THEN NULL ELSE expires_at END WHERE id=$1 AND owner_id=$2 RETURNING *",
        [
          a.id,
          req.user.id,
          clean.mime,
          clean.bytes.length,
          clean.sha256,
          clean.upload_sha256,
        ],
      );
      return media.public(updated);
    });
  });
  route('GET', '/media/:id', async (req) =>
    media.public(await owned(pool, 'media_assets', req.params.id, req.user.id)),
  );
  route('POST', '/media/:id/retain', async (req, reply) =>
    idempotent(req, reply, async (db) => {
      const a = await validAsset(
        db,
        req.params.id,
        req.user.id,
        'tryon_result',
      );
      return media.public(
        await one(
          db,
          'UPDATE media_assets SET retained=true,expires_at=NULL WHERE id=$1 RETURNING *',
          [a.id],
        ),
      );
    }),
  );
  route('DELETE', '/media/:id', async (req, reply) => {
    await transaction(pool, async (db) => {
      const a = await owned(db, 'media_assets', req.params.id, req.user.id);
      const related = await all(
        db,
        'SELECT * FROM tasks WHERE owner_id=$1 AND input_snapshot::text LIKE $2 ORDER BY id FOR UPDATE',
        [req.user.id, '%' + a.id + '%'],
      );
      const affected = [
        a.id,
        ...related.map((t) => t.result?.result_asset?.id).filter(Boolean),
      ];
      await db.query(
        "UPDATE media_assets SET status='deleting' WHERE owner_id=$1 AND id=ANY($2::uuid[])",
        [req.user.id, affected],
      );
      for (const task of related) {
        if (!TERMINAL.includes(task.status)) {
          const status = ['queued', 'needs_input'].includes(task.status)
            ? 'cancelled'
            : task.status;
          await db.query(
            'UPDATE tasks SET cancel_requested_at=coalesce(cancel_requested_at,now()),status=$2 WHERE id=$1',
            [task.id, status],
          );
          await emitEvent(db, task.id, 'task.updated', {
            task_id: task.id,
            status,
            stage: 'cancelling',
            progress: null,
          });
        }
      }
    });
    return reply.code(204).send();
  });
  route('GET', '/outfit-drafts/:scene', async (req) => {
    const d = await one(
      pool,
      'SELECT * FROM outfit_drafts WHERE owner_id=$1 AND scene=$2',
      [req.user.id, req.params.scene],
    );
    if (!d) fail(404, 'not_found', '场景不存在');
    return publicDraft(d);
  });
  route('PATCH', '/outfit-drafts/:scene', async (req) => {
    validate('/outfit-drafts/{scene}', 'patch', req.body);
    return transaction(pool, async (db) => {
      await validateSlots(db, req.body.slots, req.user.id);
      const d = await one(
        db,
        'UPDATE outfit_drafts SET slots=$3,canvas_layout=$4,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND scene=$2 AND revision=$5 RETURNING *',
        [
          req.user.id,
          req.params.scene,
          req.body.slots,
          req.body.canvas_layout,
          req.body.expected_revision,
        ],
      );
      if (!d) {
        const current = await one(
          db,
          'SELECT revision FROM outfit_drafts WHERE owner_id=$1 AND scene=$2',
          [req.user.id, req.params.scene],
        );
        if (!current) fail(404, 'not_found', '场景不存在');
        fail(409, 'revision_conflict', '搭配已被更新', {
          current_revision: current.revision,
        });
      }
      return publicDraft(d);
    });
  });
  route('POST', '/outfits', async (req, reply) => {
    validate('/outfits', 'post', req.body);
    return idempotent(
      req,
      reply,
      async (db) => {
        const d = await draftSnapshot(db, req.user.id, req.body);
        return publicOutfit(
          await one(
            db,
            'INSERT INTO outfit_versions(id,owner_id,draft_id,source_revision,snapshot,worn_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
            [
              randomUUID(),
              req.user.id,
              d.id,
              d.revision,
              publicDraft(d),
              req.body.worn_date ?? null,
            ],
          ),
        );
      },
      201,
    );
  });
  route('GET', '/outfits', async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    if (req.query.cursor) requireUUID(req.query.cursor);
    const rows = await all(
      pool,
      'SELECT * FROM outfit_versions WHERE owner_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3',
      [req.user.id, req.query.cursor ?? null, limit + 1],
    );
    return {
      data: rows.slice(0, limit).map(publicOutfit),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  });
  route('GET', '/outfits/:id', async (req) =>
    publicOutfit(
      await owned(pool, 'outfit_versions', req.params.id, req.user.id),
    ),
  );
  route('DELETE', '/outfits/:id', async (req, reply) => {
    await owned(pool, 'outfit_versions', req.params.id, req.user.id);
    await pool.query(
      'DELETE FROM outfit_versions WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.user.id],
    );
    return reply.code(204).send();
  });
  route('POST', '/outfits/:id/worn', async (req, reply) => {
    validate('/outfits/{id}/worn', 'post', req.body);
    return idempotent(req, reply, async (db) => {
      await owned(db, 'outfit_versions', req.params.id, req.user.id);
      return publicOutfit(
        await one(
          db,
          'UPDATE outfit_versions SET worn_date=$3 WHERE id=$1 AND owner_id=$2 RETURNING *',
          [req.params.id, req.user.id, req.body.worn_date],
        ),
      );
    });
  });
  for (const type of ['styling', 'tryon'])
    route('POST', `/${type}-tasks`, async (req, reply) => {
      if (type === 'styling') {
        validate('/styling-tasks', 'post', req.body);
        if (req.body.intent !== 'style')
          fail(503, 'purchase_unconfigured', '购买建议尚未配置');
        if (!config.stylingEnabled)
          fail(503, 'styling_unconfigured', 'AI 搭配尚未配置');
      } else {
        validate('/tryon-tasks', 'post', req.body, tryonSchema(contract));
        if (!config.tryonEnabled)
          fail(503, 'tryon_unconfigured', '图片试穿尚未配置');
        if (req.body.mode === 'single' && !req.body.target_slot)
          fail(400, 'target_slot_required', '请选择单件位置');
        if (req.body.mode === 'outfit' && req.body.target_slot)
          fail(400, 'invalid_target_slot', '整套试穿不指定单件位置');
      }
      return idempotent(
        req,
        reply,
        async (db) => {
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            ['quota:' + req.user.id],
          );
          if (
            (await remaining(
              db,
              req.user.id,
              type,
              config.dailyTaskLimit ?? 50,
            )) <= 0
          )
            fail(429, 'quota_exceeded', '今日任务额度已用完');
          const d = await draftSnapshot(db, req.user.id, req.body);
          await validateSlots(db, d.slots, req.user.id);
          const snapshot = { ...req.body, draft: publicDraft(d) };
          if (type === 'styling' && config.agentId && config.environmentId)
            snapshot.qoder = {
              agentId: config.agentId,
              agentVersion: config.agentVersion,
              environmentId: config.environmentId,
              maxCreditCost: config.maxCreditCost,
            };
          if (type === 'tryon') {
            const person = await validAsset(
              db,
              req.body.person_asset_id,
              req.user.id,
              'person',
            );
            const selected = Object.entries(d.slots).filter(
              ([s]) => req.body.mode === 'outfit' || s === req.body.target_slot,
            );
            if (!selected.length) fail(422, 'empty_outfit', '请先选择衣物');
            snapshot.person = {
              id: person.id,
              sha256: person.sha256,
              mime: person.mime,
            };
            snapshot.garments = [];
            for (const [slot, ref] of selected) {
              const g = await owned(db, 'garments', ref.ref_id, req.user.id);
              const a = await validAsset(
                db,
                ref.asset_id,
                req.user.id,
                'garment',
              );
              snapshot.garments.push({
                slot,
                ref_id: g.id,
                asset_id: a.id,
                name: g.name,
                ...(g.garment_kind ? { garment_kind: g.garment_kind } : {}),
                sha256: a.sha256,
                mime: a.mime,
              });
            }
            snapshot.model = config.arkModel;
            snapshot.prompt_version = PROMPT_VERSION;
            snapshot.consent_at = new Date().toISOString();
          }
          const id = randomUUID();
          await db.query(
            'INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,$3,$4)',
            [id, req.user.id, type, snapshot],
          );
          await db.query(
            'INSERT INTO usage_ledger(operation_id,owner_id,task_id,provider,unit) VALUES($1,$2,$3,$4,$5)',
            [
              id,
              req.user.id,
              id,
              type === 'styling' ? 'qoder' : 'ark',
              type === 'styling' ? 'request' : 'image',
            ],
          );
          await emitEvent(db, id, 'task.updated', {
            task_id: id,
            status: 'queued',
            stage: null,
            progress: null,
          });
          return { task_id: id, status: 'queued' };
        },
        202,
      );
    });
  route('GET', '/tasks/:id', async (req) => {
    const task = publicTask(
      await owned(pool, 'tasks', req.params.id, req.user.id),
    );
    if (task.result?.kind === 'tryon_result') {
      const asset = await owned(
        pool,
        'media_assets',
        task.result.result_asset.id,
        req.user.id,
      );
      task.result = { ...task.result, result_asset: media.public(asset) };
    }
    return task;
  });
  route('GET', '/tasks/:id/agent-events', async (req) => {
    await owned(pool, 'tasks', req.params.id, req.user.id);
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const after = req.query.after;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (after !== undefined &&
        (typeof after !== 'string' ||
          !/^evt_[A-Za-z0-9_-]{1,196}$/.test(after)))
    )
      fail(400, 'invalid_cursor', '事件分页参数无效');
    const session = await one(
      pool,
      'SELECT qoder_session_id FROM agent_sessions WHERE task_id=$1 AND owner_id=$2',
      [req.params.id, req.user.id],
    );
    if (!session) {
      if (after) fail(400, 'invalid_cursor', '事件游标无效');
      return { data: [], next_cursor: null };
    }
    const sessionId = session.qoder_session_id;
    const cursor = after
      ? await one(
          pool,
          'SELECT event_id FROM agent_events WHERE session_id=$1 AND event_id=$2',
          [sessionId, after],
        )
      : null;
    if (after && !cursor) fail(400, 'invalid_cursor', '事件游标无效');
    // Scan every stored event, including hidden ones, so polling always advances.
    const rows = await all(
      pool,
      `SELECT payload,event_id FROM agent_events WHERE session_id=$1
       ${cursor ? 'AND (received_at,event_id)>(SELECT received_at,event_id FROM agent_events WHERE session_id=$1 AND event_id=$3)' : ''}
       ORDER BY received_at,event_id LIMIT $2`,
      cursor ? [sessionId, limit, cursor.event_id] : [sessionId, limit],
    );
    const calls = rows
      .map((row) => row.payload.custom_tool_use_id)
      .filter((id) => typeof id === 'string');
    const names = calls.length
      ? await all(
          pool,
          'SELECT event_id,payload FROM agent_events WHERE session_id=$1 AND event_id=ANY($2::text[])',
          [sessionId, calls],
        )
      : [];
    const toolNames = new Map(
      names
        .filter((row) => row.payload.type === 'agent.custom_tool_use')
        .map((row) => [row.event_id, row.payload.name]),
    );
    return {
      data: rows
        .map((row) =>
          publicAgentEvent(
            row.payload,
            toolNames.get(row.payload.custom_tool_use_id),
          ),
        )
        .filter(Boolean),
      next_cursor: rows.at(-1)?.event_id ?? after ?? null,
    };
  });
  route('POST', '/tasks/:id/cancel', async (req, reply) =>
    idempotent(
      req,
      reply,
      async (db) => {
        const t = await owned(db, 'tasks', req.params.id, req.user.id);
        if (!TERMINAL.includes(t.status)) {
          const status = ['queued', 'needs_input'].includes(t.status)
            ? 'cancelled'
            : t.status;
          await db.query(
            'UPDATE tasks SET cancel_requested_at=now(),status=$2,updated_at=now() WHERE id=$1',
            [t.id, status],
          );
          await emitEvent(db, t.id, 'task.updated', {
            task_id: t.id,
            status,
            stage: 'cancelling',
            progress: null,
          });
          if (status === 'cancelled')
            await db.query(
              "UPDATE usage_ledger SET state=CASE WHEN EXISTS(SELECT 1 FROM provider_operations WHERE task_id=$1 AND kind IN ('message','image_generation') AND state IN ('dispatching','unconfirmed','done')) THEN 'frozen' ELSE 'released' END WHERE task_id=$1 AND state='reserved'",
              [t.id],
            );
        }
        return publicTask(await owned(db, 'tasks', t.id, req.user.id));
      },
      202,
    ),
  );
  route('POST', '/tasks/:id/messages', async (req, reply) => {
    validate('/tasks/{id}/messages', 'post', req.body);
    return idempotent(
      req,
      reply,
      async (db) => {
        const t = await owned(db, 'tasks', req.params.id, req.user.id);
        if (t.status !== 'needs_input')
          fail(409, 'task_not_waiting', '当前任务不能接收补答');
        await draftSnapshot(db, req.user.id, t.input_snapshot);
        const opKey = `message:${t.id}:${randomUUID()}`;
        await db.query(
          "INSERT INTO provider_operations(id,task_id,owner_id,provider,operation_key,kind,input) VALUES($1,$2,$3,'qoder',$4,'message',$5)",
          [
            randomUUID(),
            t.id,
            req.user.id,
            opKey,
            { message: req.body.message },
          ],
        );
        await db.query(
          "UPDATE tasks SET status='queued',question=NULL,candidate=NULL,lease_until=NULL,lease_token=NULL,next_run_at=now() WHERE id=$1",
          [t.id],
        );
        await emitEvent(db, t.id, 'task.updated', {
          task_id: t.id,
          status: 'queued',
          stage: null,
          progress: null,
        });
        return { task_id: t.id, status: 'queued' };
      },
      202,
    );
  });
  route('GET', '/tasks/:id/events', async (req, reply) => {
    const t = await owned(pool, 'tasks', req.params.id, req.user.id);
    let seq = Number(req.headers['last-event-id'] ?? req.query.after ?? 0);
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > t.last_event_seq)
      fail(400, 'invalid_cursor', '任务游标无效');
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    let closed = false,
      busy = false;
    const close = () => {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
    };
    const tick = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const events = await all(
          pool,
          'SELECT * FROM task_events WHERE task_id=$1 AND seq>$2 ORDER BY seq LIMIT 100',
          [t.id, seq],
        );
        for (const event of events) {
          if (closed) break;
          reply.raw.write(
            `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
          );
          seq = event.seq;
        }
      } catch {
        close();
        reply.raw.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 500),
      heartbeat = setInterval(() => {
        if (!closed) reply.raw.write(': heartbeat\n\n');
      }, 15000);
    reply.raw.on('close', close);
    await tick();
  });
  route('GET', '/preferences', async (req) =>
    preference(
      await one(pool, 'SELECT * FROM preferences WHERE owner_id=$1', [
        req.user.id,
      ]),
    ),
  );
  route('PATCH', '/preferences', async (req) => {
    validate('/preferences', 'patch', req.body);
    return transaction(pool, async (db) => {
      if (config.memoryEnabled) await memoryLock(db, req.user.id);
      const { expected_revision, ...changes } = req.body;
      const p = await one(
        db,
        'UPDATE preferences SET data=data || $2::jsonb,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND revision=$3 RETURNING *',
        [req.user.id, changes, expected_revision],
      );
      if (!p)
        fail(409, 'revision_conflict', '偏好已更新', {
          current_revision: (
            await one(
              db,
              'SELECT revision FROM preferences WHERE owner_id=$1',
              [req.user.id],
            )
          ).revision,
        });
      if (config.memoryEnabled)
        await queueMemory(db, req.user.id, 'preferences');
      return preference(p);
    });
  });
  route('POST', '/wear-feedback', async (req, reply) => {
    validate('/wear-feedback', 'post', req.body);
    return idempotent(
      req,
      reply,
      async (db) => {
        if (config.memoryEnabled) await memoryLock(db, req.user.id);
        const b = req.body;
        await owned(db, 'outfit_versions', b.outfit_version_id, req.user.id);
        const id = randomUUID();
        await db.query(
          'INSERT INTO wear_feedback(id,owner_id,outfit_version_id,actually_worn,fit_by_part,comment,consent_to_memory) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            id,
            req.user.id,
            b.outfit_version_id,
            b.actually_worn,
            b.fit_by_part ?? {},
            b.comment ?? null,
            b.consent_to_memory,
          ],
        );
        const sync = b.consent_to_memory && config.memoryEnabled;
        if (sync) await queueMemory(db, req.user.id, 'feedback:' + id);
        return { id, memory_sync_status: sync ? 'queued' : 'not_requested' };
      },
      201,
    );
  });
  route('DELETE', '/wear-feedback/:id', async (req, reply) => {
    await transaction(pool, async (db) => {
      await memoryLock(db, req.user.id);
      const feedback = await owned(
        db,
        'wear_feedback',
        req.params.id,
        req.user.id,
      );
      await db.query(
        "UPDATE wear_feedback SET deleted_at=now(),comment=NULL,fit_by_part='{}' WHERE id=$1 AND owner_id=$2",
        [req.params.id, req.user.id],
      );
      if (feedback.consent_to_memory)
        await queueMemory(db, req.user.id, 'feedback:' + req.params.id);
    });
    return reply.code(204).send();
  });
  route('DELETE', '/me', async (req, reply) =>
    idempotent(
      req,
      reply,
      async (db) => {
        const id = randomUUID();
        await db.query('UPDATE users SET deleting=true WHERE id=$1', [
          req.user.id,
        ]);
        await db.query(
          "UPDATE tasks SET cancel_requested_at=now() WHERE owner_id=$1 AND status IN ('queued','running','waiting_tools','needs_input')",
          [req.user.id],
        );
        await db.query(
          "INSERT INTO tasks(id,owner_id,type,input_snapshot) VALUES($1,$2,'account_deletion','{}')",
          [id, req.user.id],
        );
        await emitEvent(db, id, 'task.updated', {
          task_id: id,
          status: 'queued',
          stage: null,
          progress: null,
        });
        return { task_id: id, status: 'queued' };
      },
      202,
    ),
  );
  route('GET', '/products', async () => ({ data: [], next_cursor: null }));
  route('GET', '/inspirations', async () => ({ data: [], next_cursor: null }));
  route('POST', '/garment-extraction-tasks', async () =>
    fail(503, 'extraction_unconfigured', '请手动填写衣物信息'),
  );
  route('POST', '/tryon/client-token', async () =>
    fail(503, 'realtime_unconfigured', '实时视频试穿尚未配置'),
  );
  app.decorate('media', media);
  return app;
}
async function draftSnapshot(db, owner, body) {
  const d = await owned(db, 'outfit_drafts', body.draft_id, owner);
  if (d.revision !== body.draft_revision)
    fail(409, 'revision_conflict', '搭配版本已改变', {
      current_revision: d.revision,
    });
  return d;
}
async function remaining(db, owner, type, max) {
  const row = await one(
    db,
    "SELECT count(*)::int AS count FROM tasks t JOIN usage_ledger u ON u.task_id=t.id WHERE t.owner_id=$1 AND t.type=$2 AND t.created_at>=date_trunc('day',now()) AND u.state!='released'",
    [owner, type],
  );
  return Math.max(0, max - row.count);
}
function preference(p) {
  return { ...p.data, revision: p.revision, updated_at: iso(p.updated_at) };
}
async function memoryLock(db, owner) {
  await db.query("SET LOCAL lock_timeout='5s'");
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'memory:' + owner,
    ]);
  } catch (error) {
    if (error.code === '55P03')
      fail(503, 'memory_busy', '偏好同步正在进行，请稍后重试');
    throw error;
  }
}
export async function queueMemory(db, owner, key) {
  await memoryLock(db, owner);
  const binding = await one(
    db,
    'SELECT * FROM memory_bindings WHERE owner_id=$1',
    [owner],
  );
  await db.query(
    "INSERT INTO memory_sync_jobs(id,owner_id,resource_key,generation) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,resource_key,generation) DO UPDATE SET state='queued',error=NULL",
    [randomUUID(), owner, key, binding?.generation ?? 0],
  );
}
function tryonSchema(contract) {
  const old =
    contract.paths['/tryon-tasks'].post.requestBody.content['application/json']
      .schema;
  return {
    ...old,
    properties: {
      ...old.properties,
      mode: { type: 'string', enum: ['single', 'outfit'] },
      target_slot: {
        type: 'string',
        enum: ['coat', 'top', 'bottom', 'shoes', 'bag'],
      },
    },
    required: [...new Set([...old.required, 'mode'])],
  };
}
