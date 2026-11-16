import {
  QoderClient,
  QoderError,
} from '../../skills/qoder-cloud-agent/scripts/qoder-client.mjs';
export {
  QoderError,
  decodeSSE,
} from '../../skills/qoder-cloud-agent/scripts/qoder-client.mjs';
export class ManagedQoder extends QoderClient {
  #token;
  #fetchImpl;
  constructor({ accessToken, fetchImpl = globalThis.fetch }) {
    super({ accessToken, fetchImpl });
    this.#token = accessToken;
    this.#fetchImpl = fetchImpl;
  }
  async request(path, { method = 'GET', body } = {}) {
    let response;
    const write = method !== 'GET';
    try {
      response = await this.#fetchImpl(
        'https://api.qoder.com.cn/api/v1/cloud' + path,
        {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${this.#token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new QoderError(write ? 'write_unconfirmed' : 'connection_failed', {
        uncertain: write,
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new QoderError(
        write && ![400, 401, 403, 404, 409, 422].includes(response.status)
          ? 'write_unconfirmed'
          : 'upstream_rejected',
        {
          status: response.status,
          requestId: response.headers.get('x-request-id'),
          uncertain:
            write && ![400, 401, 403, 404, 409, 422].includes(response.status),
        },
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new QoderError(write ? 'write_unconfirmed' : 'invalid_response', {
        uncertain: write,
      });
    }
  }
  listSessions(page) {
    return this.request('/sessions?limit=100' + pagination(page));
  }
  listMemories(store, page) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memories?limit=100` +
        pagination(page),
    );
  }
  getMemory(store, memory) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memories/${id(memory, 'mem_')}`,
    );
  }
  updateMemory(store, memory, content, hash) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memories/${id(memory, 'mem_')}`,
      { method: 'POST', body: { content, content_sha256: hash } },
    );
  }
  deleteMemory(store, memory) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memories/${id(memory, 'mem_')}`,
      { method: 'DELETE' },
    );
  }
  listMemoryVersions(store, page) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memory_versions?limit=100` +
        pagination(page),
    );
  }
  redactMemoryVersion(store, version) {
    return this.request(
      `/memory_stores/${id(store, 'memstore_')}/memory_versions/${encodeURIComponent(version)}/redact`,
      { method: 'POST' },
    );
  }
}
function id(value, prefix) {
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  )
    throw new TypeError('Invalid Qoder resource ID');
  return value;
}
function pagination(page) {
  return page
    ? typeof page === 'object'
      ? '&after_id=' + encodeURIComponent(page.afterId)
      : '&page=' + encodeURIComponent(page)
    : '';
}
export async function collectPages(fetchPage) {
  const items = [];
  let page;
  const seen = new Set();
  do {
    const response = await fetchPage(page);
    items.push(...(response.data ?? response.items ?? []));
    page =
      response.next_page ??
      (response.has_more && response.last_id
        ? { afterId: response.last_id }
        : undefined);
    if (response.has_more && !page)
      throw new Error('Pagination cursor missing');
    if (page) {
      const key = JSON.stringify(page);
      if (seen.has(key)) throw new Error('Repeated pagination cursor');
      seen.add(key);
    }
  } while (page);
  return items;
}
