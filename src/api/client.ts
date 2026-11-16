import { sha256 } from '@noble/hashes/sha2.js';
/** Application wire types mirror docs/contracts/openapi.json, never provider APIs. */
export type Scene = 'daily' | 'weekend' | 'meeting';
export type SlotName = 'coat' | 'top' | 'bottom' | 'shoes' | 'bag';
export type ApiSlot = {
  source: 'wardrobe' | 'product';
  ref_id: string;
  asset_id: string;
  locked: boolean;
};
export type ApiSlots = Partial<Record<SlotName, ApiSlot>>;
export type Layout = Record<
  string,
  { x: number; y: number; width: number; rotation: number }
>;
export type Draft = {
  id: string;
  scene: Scene;
  revision: number;
  slots: ApiSlots;
  canvas_layout: Layout;
  updated_at: string;
};
export type MediaAsset = {
  id: string;
  kind: 'person' | 'garment' | 'tryon_result';
  status: 'uploading' | 'ready' | 'deleting' | 'deleted';
  download_url?: string;
  expires_at?: string;
  mime?: string;
  bytes?: number;
};
export type ApiGarment = {
  id: string;
  name: string;
  category: SlotName;
  color?: string;
  material?: string;
  image_asset_id: string;
  source: 'manual' | 'upload' | 'product';
  garment_kind?: string;
  revision: number;
};
export type OutfitProposal = {
  kind: 'outfit_proposal';
  task_id: string;
  proposal_id: string;
  draft_revision: number;
  garment_ids: string[];
  slots: ApiSlots;
  reason: string;
  owned_count: number;
  new_cost_fen: number;
};
export type TryonResult = {
  kind: 'tryon_result';
  result_asset: MediaAsset;
  draft_id: string;
  draft_revision: number;
  mode: 'single' | 'outfit';
  target_slot?: SlotName | null;
  person_asset_id: string;
  slots: ApiSlots;
  model: string;
  prompt_version: string;
};
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_tools'
  | 'needs_input'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unconfirmed';
export type ErrorDetail = {
  code: string;
  message: string;
  retryable: boolean;
  request_id: string;
  details?: Record<string, unknown>;
};
export type Task = {
  id: string;
  type: string;
  status: TaskStatus;
  stage: string | null;
  progress: number | null;
  last_event_seq: number;
  cancel_requested_at?: string | null;
  result: OutfitProposal | TryonResult | null;
  error: ErrorDetail | null;
  question?: string | null;
};
export type Capabilities = {
  mode: 'demo' | 'live';
  ai_styling: boolean;
  image_tryon: boolean;
  realtime_tryon: boolean;
  memory: boolean;
  dream: boolean;
};
export type Me = {
  id: string;
  display_name: string;
  timezone: string;
  csrf_token: string;
  quota: { styling_remaining: number; tryon_remaining: number };
};
export type ApiOutfit = {
  id: string;
  draft_id: string;
  source_revision: number;
  snapshot: Draft;
  worn_date?: string;
  created_at: string;
};
export type UploadTicket = {
  asset_id: string;
  upload_url: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  expires_at: string;
};
export class ApiError extends Error {
  status: number;
  detail: ErrorDetail;
  constructor(status: number, detail: ErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}
export const newKey = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
export const isTerminal = (task: Task) =>
  ['succeeded', 'failed', 'cancelled', 'unconfirmed', 'needs_input'].includes(
    task.status,
  );
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '暂时无法完成，请稍后再试。';
}
export function createApi(fetcher: typeof fetch = fetch) {
  let csrf = '';
  const request = async <T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (options.method && options.method !== 'GET')
      headers.set('X-CSRF-Token', csrf);
    let response: Response;
    try {
      response = await fetcher(`/api/v1${path}`, {
        ...options,
        headers,
        credentials: 'same-origin',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError')
        throw error;
      throw new ApiError(0, {
        code: 'NETWORK_UNKNOWN',
        message: '连接中断，提交结果尚未确认。请恢复查询，不要重复生成。',
        retryable: true,
        request_id: '',
      });
    }
    if (response.status === 204) return undefined as T;
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !body) {
      const detail =
        body && typeof body === 'object' && 'error' in body
          ? (body as { error: ErrorDetail }).error
          : {
              code: `HTTP_${response.status}`,
              message:
                response.status === 401
                  ? '登录已过期，请重新登录后继续。'
                  : '服务暂不可用，请稍后再试。',
              retryable: response.status >= 500,
              request_id: '',
            };
      if (response.status === 401)
        detail.message = '登录已过期，请重新登录后继续。';
      throw new ApiError(
        response.ok ? 0 : response.status,
        response.ok
          ? {
              code: 'INVALID_RESPONSE_UNKNOWN',
              message: '服务器回复不完整，提交结果待确认。请恢复上次请求。',
              retryable: true,
              request_id: '',
            }
          : detail,
      );
    }
    return body as T;
  };
  return {
    setCsrf(value: string) {
      csrf = value;
    },
    get: <T>(path: string, signal?: AbortSignal) =>
      request<T>(path, { signal }),
    post: <T>(path: string, body?: unknown, key: string = newKey()) =>
      request<T>(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    async upload(file: Blob, kind: 'garment' | 'person'): Promise<MediaAsset> {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('请选择 JPG、PNG 或 WebP 图片。');
      if (!file.size || file.size > 10 * 1024 * 1024)
        throw new Error('请选择不超过 10 MB 的图片。');
      const ticket = await request<UploadTicket>('/media/uploads', {
        method: 'POST',
        headers: { 'Idempotency-Key': newKey() },
        body: JSON.stringify({ kind, mime: file.type, bytes: file.size }),
      });
      const uploadUrl = new URL(ticket.upload_url, location.origin);
      if (
        uploadUrl.origin !== location.origin &&
        uploadUrl.protocol !== 'https:'
      )
        throw new Error('上传地址无效，请重试。');
      let body: BodyInit = file;
      if (ticket.method === 'POST') {
        const form = new FormData();
        Object.entries(ticket.fields || {}).forEach(([k, v]) =>
          form.append(k, v),
        );
        form.append('file', file);
        body = form;
      }
      const headers = new Headers(ticket.headers);
      if (uploadUrl.origin === location.origin)
        headers.set('X-CSRF-Token', csrf);
      const uploaded = await fetcher(uploadUrl.href, {
        method: ticket.method,
        headers,
        body,
        credentials:
          uploadUrl.origin === location.origin ? 'same-origin' : 'omit',
      });
      if (!uploaded.ok) throw new Error('照片上传未完成，请重新选择照片重试。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = crypto.subtle
        ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        : sha256(bytes);
      const checksum = Array.from(digest, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const asset = await request<MediaAsset>(
        `/media/${ticket.asset_id}/complete`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': newKey() },
          body: JSON.stringify({ sha256: checksum }),
        },
      );
      if (asset.status !== 'ready')
        throw new Error('照片尚未通过校验，请重新选择照片。');
      return asset;
    },
    async stream(
      taskId: string,
      cursor: number,
      signal: AbortSignal,
      onEvent: (seq: number) => void,
    ) {
      const response = await fetcher(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/events`,
        {
          headers: {
            Accept: 'text/event-stream',
            'Last-Event-ID': String(cursor),
          },
          credentials: 'same-origin',
          signal,
        },
      );
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.includes('text/event-stream')
      )
        throw new Error('状态连接暂时中断');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(
          /\r\n/g,
          '\n',
        );
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const id = block.match(/^id:\s*(\d+)\s*$/m);
          if (id) {
            const seq = Number(id[1]);
            if (seq > cursor) {
              cursor = seq;
              onEvent(seq);
            }
          }
        }
      }
    },
  };
}
export type Api = ReturnType<typeof createApi>;
