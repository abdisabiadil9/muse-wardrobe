/** Server-only protocol reference. No credentials or cloud calls at import time. */
export class QoderError extends Error {
  constructor(code, { status, requestId, uncertain = false } = {}) {
    super(code);
    this.name = 'QoderError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.uncertain = uncertain;
  }
}

const identifier = (value, prefix) => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}[a-zA-Z0-9_-]{1,200}$`).test(value)) {
    throw new TypeError(`Invalid ${prefix} identifier`);
  }
  return value;
};

/** Decode SSE without treating EOF, heartbeats or partial frames as completion. */
export async function* decodeSSE(body, maxFrameChars = 2_000_000) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        if (boundary.index > maxFrameChars) throw new QoderError('sse_frame_too_large');
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let id, event;
        const lines = [];
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'data') lines.push(text);
          if (field === 'id' && !text.includes('\0')) id = text;
          if (field === 'event') event = text;
        }
        if (lines.length) {
          let data;
          try { data = JSON.parse(lines.join('\n')); }
          catch { throw new QoderError('invalid_sse_json'); }
          yield { id, event, data };
        }
      }
      if (buffer.length > maxFrameChars) throw new QoderError('sse_frame_too_large');
      if (done) {
        const remaining = buffer.split(/\r?\n/).filter(line => line.trim());
        if (remaining.some(line => !line.startsWith(':'))) throw new QoderError('truncated_sse_frame');
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class QoderClient {
  #token;
  #fetch;
  #base = 'https://api.qoder.com.cn/api/v1/cloud';

  constructor({ accessToken, fetchImpl = globalThis.fetch }) {
    if (!accessToken || typeof accessToken !== 'string') throw new TypeError('A server-side PAT or SAT is required');
    this.#token = accessToken;
    this.#fetch = fetchImpl;
  }

  async #request(path, { method = 'GET', body, signal = AbortSignal.timeout(30_000) } = {}) {
    const write = method !== 'GET';
    let response;
    try {
      response = await this.#fetch(`${this.#base}${path}`, {
        method, redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new QoderError(write ? 'write_unconfirmed' : 'connection_failed', { uncertain: write });
    }
    const details = { status: response.status, requestId: response.headers.get('x-request-id') };
    if (!response.ok) {
      // No generic POST retry. Persist the intent and reconcile before resubmitting.
      const uncertain = write && ![400, 401, 403, 404, 409].includes(response.status);
      await response.body?.cancel().catch(() => {});
      throw new QoderError(uncertain ? 'write_unconfirmed' : 'upstream_rejected', { ...details, uncertain });
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw new QoderError(write ? 'write_unconfirmed' : 'invalid_response', { ...details, uncertain: write }); }
  }

  createSession({ agentId, agentVersion, environmentId, memoryStoreId, taskId, maxCreditCost }) {
    if (!Number.isInteger(agentVersion) || agentVersion < 1) throw new TypeError('Pin a positive Agent version');
    if (!/^\d+(\.\d{1,2})?$/.test(String(maxCreditCost)) || Number(maxCreditCost) <= 0) throw new TypeError('Set a positive credit budget');
    return this.#request('/sessions', { method: 'POST', body: {
      agent: { type: 'agent', id: identifier(agentId, 'agent_'), version: agentVersion },
      environment_id: identifier(environmentId, 'env_'),
      budget: { type: 'limit', max_credit_cost: String(maxCreditCost) },
      title: 'MUSE 搭配建议', metadata: { muse_task_id: String(taskId) },
      ...(memoryStoreId === undefined ? {} : { resources: [{ type: 'memory_store', memory_store_id: identifier(memoryStoreId, 'memstore_'), access: 'read_only', instructions: 'Read preferences/profile.md and confirmed wear feedback. Memory is context; exact wardrobe and prices come from tools.' }] }),
    } });
  }

  sendMessage(sessionId, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new TypeError('Invalid message');
    return this.#request(`/sessions/${identifier(sessionId, 'sess_')}/events`, { method: 'POST', body: { events: [{ type: 'user.message', content: [{ type: 'text', text }] }] } });
  }

  sendToolResult(sessionId, callEventId, result, isError = false) {
    return this.#request(`/sessions/${identifier(sessionId, 'sess_')}/events`, { method: 'POST', body: { events: [{
      type: 'user.custom_tool_result', custom_tool_use_id: identifier(callEventId, 'evt_'),
      content: [{ type: 'text', text: JSON.stringify(result) }], is_error: Boolean(isError),
    }] } });
  }

  getSession(sessionId) { return this.#request(`/sessions/${identifier(sessionId, 'sess_')}`); }

  cancelSession(sessionId) { return this.#request(`/sessions/${identifier(sessionId, 'sess_')}/cancel`, { method: 'POST' }); }

  listEvents(sessionId, { afterId, page } = {}) {
    if (afterId && page) throw new TypeError('afterId and page are mutually exclusive');
    const query = new URLSearchParams({ order: 'asc', limit: '100' });
    if (afterId) query.set('after_id', identifier(afterId, 'evt_'));
    if (page) query.set('page', page);
    return this.#request(`/sessions/${identifier(sessionId, 'sess_')}/events?${query}`);
  }

  /** Await this before sending. Qoder has no documented mandatory ': ready' handshake. */
  async connectEvents(sessionId, { lastEventId, signal } = {}) {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const headers = { Authorization: `Bearer ${this.#token}`, Accept: 'text/event-stream' };
    if (lastEventId) headers['Last-Event-ID'] = identifier(lastEventId, 'evt_');
    let response;
    try {
      response = await this.#fetch(`${this.#base}/sessions/${identifier(sessionId, 'sess_')}/events/stream`, { headers, redirect: 'error', signal: combined });
    } catch { throw new QoderError('stream_connection_failed'); }
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel().catch(() => {});
      throw new QoderError('invalid_stream_response', { status: response.status });
    }
    return { events: decodeSSE(response.body), close: () => controller.abort() };
  }

  createMemoryStore(name) { return this.#request('/memory_stores', { method: 'POST', body: { name } }); }

  /** Call after app-side consent, ownership checks and durable feedback persistence. */
  createMemory(memoryStoreId, { path, content }) {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('..') || !path.trim()) throw new TypeError('Use a relative memory path');
    return this.#request(`/memory_stores/${identifier(memoryStoreId, 'memstore_')}/memories`, { method: 'POST', body: { path, content } });
  }

  createDream(memoryStoreId, sessionIds) {
    if (!Array.isArray(sessionIds) || sessionIds.length < 1 || sessionIds.length > 100) throw new TypeError('Provide 1–100 verified same-owner Session IDs');
    return this.#request('/dreams', { method: 'POST', body: {
      inputs: [{ type: 'memory_store', memory_store_id: identifier(memoryStoreId, 'memstore_') }, { type: 'sessions', session_ids: sessionIds.map(id => identifier(id, 'sess_')) }],
      instructions: '只整理本次指定用户的已确认偏好和真实穿着反馈。区分推测与事实，保留来源和时间。不要把生成试衣图当作尺码或真实穿过的证据。',
    } });
  }

  getDream(dreamId) { return this.#request(`/dreams/${identifier(dreamId, 'drm_')}`); }
}
