import { AppError } from '../domain/index.mjs';
const BASE = 'https://api.everyinfra.com';
const identifier = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
    ? value
    : null;
const safeCode = (value) =>
  typeof value === 'string' && /^[a-z0-9_]{1,80}$/i.test(value)
    ? value
    : 'source_error';
export function retrySeconds(value, attempt = 0, now = Date.now()) {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds) && seconds >= 0)
    return Math.max(1, seconds);
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.max(1, Math.ceil((date - now) / 1000))
    : Math.min(300, 5 * 2 ** attempt);
}
export class EveryInfra {
  constructor({ apiKey, fetchImpl = globalThis.fetch }) {
    Object.assign(this, { apiKey, fetchImpl });
  }
  async request(path, body) {
    if (!this.apiKey)
      throw new AppError(
        503,
        'inspiration_unconfigured',
        '外部内容服务尚未配置',
      );
    let response, payload;
    try {
      response = await this.fetchImpl(BASE + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Bound response size before parsing; never return vendor errors or credentials verbatim.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty');
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('too_large');
        }
        chunks.push(Buffer.from(value));
      }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new Error('invalid');
    } catch {
      const e = new AppError(
        502,
        body ? 'write_unconfirmed' : 'source_connection_failed',
        body
          ? '来源请求结果尚未确认，不会自动重复扣费请求'
          : '来源状态暂时无法查询',
      );
      e.uncertain = Boolean(body);
      e.requestId = identifier(response?.headers.get('x-request-id'));
      e.readRetry = !body;
      throw e;
    }
    const requestId = identifier(
      payload.error?.request_id ??
        payload.request_id ??
        response.headers.get('x-request-id') ??
        payload.id,
    );
    if (!response.ok || payload.error) {
      const code = safeCode(payload.error?.code);
      const messages = {
        401: '内容服务密钥无效，请检查服务端配置',
        402: '内容服务余额不足，请充值后重试',
        403: '内容服务权限不足，请检查账号权限',
        422: '来源参数已变更，请更新接口配置',
        429: '来源请求较多，正在等待后重试',
        503: '来源暂时繁忙，正在等待后重试',
      };
      const e = new AppError(
        502,
        'everyinfra_' + code,
        messages[response.status] ?? '内容服务暂时不可用',
      );
      const retryAfter =
        response.headers.get('retry-after') ?? payload.error?.retry_after;
      Object.assign(e, {
        requestId,
        httpStatus: response.status,
        providerCode: code,
        retryAfter: retryAfter == null ? undefined : retrySeconds(retryAfter),
        safeRetry:
          [429, 503].includes(response.status) &&
          !['submit_unknown', 'submission_unknown'].includes(code),
        readRetry: !body && response.status >= 500,
      });
      e.uncertain = Boolean(
        body &&
        (['submit_unknown', 'submission_unknown'].includes(code) ||
          ![400, 401, 402, 403, 404, 422, 429, 503].includes(response.status)),
      );
      throw e;
    }
    return { ...payload, request_id: requestId, http_status: response.status };
  }
  submit(action, params, platform = 'xiaohongshu') {
    if (
      !(platform === 'xiaohongshu' && ['search', 'note'].includes(action)) &&
      !(platform === 'taobao' && action === 'search')
    )
      throw new AppError(400, 'invalid_action', '不支持的来源操作');
    return this.request('/api/v1/social', {
      platform,
      action,
      params,
      mode: 'async',
    });
  }
  job(id) {
    if (!identifier(id))
      throw new AppError(502, 'invalid_source_job', '来源任务标识无效');
    return this.request('/api/v1/jobs/' + encodeURIComponent(id));
  }
  lookup(id) {
    if (!identifier(id)) return null;
    return this.request('/portal/api/requests/' + encodeURIComponent(id));
  }
}
export function sourceReceipt(payload) {
  const job = identifier(payload.job_id);
  if (payload.http_status === 202 && !job) {
    const e = new AppError(
      502,
      'write_unconfirmed',
      '来源未返回可恢复的任务标识',
    );
    e.uncertain = true;
    e.requestId = payload.request_id;
    throw e;
  }
  return {
    job_id: job,
    request_id: payload.request_id,
    billing: payload.billing
      ? {
          charged: payload.billing.charged,
          charged_usd: payload.billing.charged_usd,
          units: payload.billing.units,
        }
      : null,
    refund: payload.refund ? { status: payload.refund.status } : null,
  };
}
