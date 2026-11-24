import styles from './styles.json' with { type: 'json' };
import { AppError } from '../domain/index.mjs';
import { digest } from '../db/index.mjs';
export { styles };
export const UNIT_PRICE_USD = 0.005556;
export function noteURL(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw new AppError(400, 'invalid_note_url', '请提供有效的小红书笔记链接');
  const raw = String(value ?? '').trim();
  if (/^[a-f0-9]{24}$/i.test(raw)) return raw;
  const links = raw.match(/https?:\/\/[^\s<>"，。]+/g) ?? [];
  if (links.length !== 1)
    throw new AppError(
      400,
      'invalid_note_url',
      '请粘贴一条小红书笔记链接或分享文本',
    );
  let u;
  try {
    u = new URL(links[0]);
  } catch {
    throw new AppError(400, 'invalid_note_url', '小红书笔记链接格式无效');
  }
  if (
    ![
      'www.xiaohongshu.com',
      'xiaohongshu.com',
      'xhslink.com',
      'www.xhslink.com',
    ].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port ||
    u.protocol !== 'https:'
  )
    throw new AppError(400, 'invalid_note_url', '仅支持 HTTPS 小红书笔记链接');
  if (
    u.hostname.endsWith('xiaohongshu.com') &&
    !/^\/(explore|discovery\/item)\/[a-f0-9]{24}\/?$/i.test(u.pathname)
  )
    throw new AppError(400, 'invalid_note_url', '请使用笔记链接，不是作者主页');
  u.hash = '';
  // Access-token query parameters are required by the source; preserve them.
  return u.href;
}
export function inspirationInput(body, owner) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some(
      (k) => !['action', 'style_id', 'keyword', 'url'].includes(k),
    )
  )
    throw new AppError(400, 'invalid_request', '灵感请求无效');
  const style = styles.find((x) => x.id === body.style_id);
  if (body.style_id !== undefined && !style)
    throw new AppError(400, 'invalid_style', '风格不存在');
  let params,
    scope = owner;
  if (body.action === 'search') {
    if (
      body.url ||
      (body.keyword !== undefined && typeof body.keyword !== 'string')
    )
      throw new AppError(400, 'invalid_request', '搜索条件无效');
    const keyword = (body.keyword ?? style?.keyword ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ');
    if (!keyword || keyword.length > 100)
      throw new AppError(400, 'invalid_keyword', '请输入 1–100 字的穿搭关键词');
    params = {
      keyword,
      content_type: 'image',
      sort: 'relevance',
      date_range: 'any_time',
    };
    // Only predefined, non-personal editorial queries share a cache between users.
    if (style && keyword === style.keyword) scope = 'editorial';
  } else if (body.action === 'note') {
    if (body.keyword)
      throw new AppError(400, 'invalid_request', '笔记详情不接受搜索词');
    params = { url: noteURL(body.url) };
  } else throw new AppError(400, 'invalid_action', '请选择搜索或导入笔记');
  return {
    action: body.action,
    params,
    style_id: style?.id ?? null,
    cache_hours: scope === 'editorial' ? 168 : 24,
    cache_key: digest({ version: 1, scope, action: body.action, params }),
  };
}
function text(v, n) {
  return typeof v === 'string' ? v.slice(0, n) : '';
}
export function publicImage(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !['xhscdn.com', 'xiaohongshu.com'].some(
        (d) => host === d || host.endsWith('.' + d),
      )
    )
      return null;
    // XHS returns HEIF by default; its same-CDN WebP rendition works in Chromium.
    const url =
      host === 'xhscdn.com' || host.endsWith('.xhscdn.com')
        ? u.href.replace(
            /\/format\/(?:heif|heic)(?=\/|[&|]|$)/gi,
            '/format/webp',
          )
        : u.href;
    return url.length <= 2048 ? url : null;
  } catch {
    return null;
  }
}
export function normalizeResult(response, action) {
  if (
    !Object.hasOwn(response, 'results') ||
    (response.results !== null && typeof response.results !== 'object')
  )
    throw new AppError(502, 'invalid_source_result', '来源返回结构不完整');
  const rows = Array.isArray(response.results)
    ? response.results
    : response.results
      ? [response.results]
      : [];
  const seen = new Set();
  const data = rows.slice(0, 20).flatMap((row) => {
    if (!row || !/^[a-f0-9]{24}$/i.test(row.id) || seen.has(row.id)) return [];
    let url;
    try {
      url = noteURL(row.url || row.id);
    } catch {
      return [];
    }
    seen.add(row.id);
    const images = [
      ...new Set(
        [row.image_url, ...(Array.isArray(row.images) ? row.images : [])]
          .map(publicImage)
          .filter(Boolean),
      ),
    ].slice(0, 12);
    return [
      {
        id: row.id,
        url: url.startsWith('https:')
          ? url
          : `https://www.xiaohongshu.com/explore/${url}`,
        title: text(row.title, 180),
        text: text(row.text, action === 'note' ? 8000 : 600),
        images,
        author: text(row.author_name, 100),
        tags: (Array.isArray(row.tags) ? row.tags : [])
          .filter((x) => typeof x === 'string')
          .slice(0, 12)
          .map((x) => x.slice(0, 40)),
        source: 'xiaohongshu',
        is_summary: action === 'search',
        is_video: row.is_video === true,
        sponsored:
          typeof row.is_cooperation_note === 'boolean'
            ? row.is_cooperation_note
            : null,
      },
    ];
  });
  if (rows.length && !data.length)
    throw new AppError(
      502,
      'invalid_source_result',
      '来源内容缺少有效笔记标识',
    );
  return {
    kind: 'inspiration_result',
    data,
    fetched_at: new Date().toISOString(),
    cached: false,
  };
}
