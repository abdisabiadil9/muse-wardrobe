// Public buffered Qoder events only. Never expose raw envelopes or memory reads.
const fields = {
  'user.message': ['content'],
  'agent.message': ['content'],
  'agent.custom_tool_use': ['name', 'input'],
  'user.custom_tool_result': ['custom_tool_use_id', 'content', 'is_error'],
  'agent.tool_use': ['name'],
  'agent.tool_result': ['tool_use_id', 'is_error'],
  'session.status_running': [],
  'session.status_idle': ['stop_reason'],
  'session.status_terminated': [],
};
const businessTools = new Set([
  'read_wardrobe',
  'propose_outfit',
  'get_style_definition',
  'search_inspirations',
  'read_inspiration_note',
  'search_products',
]);
const privateKey =
  /(?:authorization|credential|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|cookie|environment|thinking|reasoning)/i;
const redact = (text) =>
  text
    .slice(0, 16384)
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|pat|sat|ei)[-_][A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;"']+/gi,
      '$1[redacted]',
    );
function safe(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((v) => safe(v, depth + 1));
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .filter(
        ([key]) =>
          !privateKey.test(key) &&
          !['__proto__', 'constructor', 'prototype'].includes(key),
      )
      .map(([key, v]) => [key, safe(v, depth + 1)]),
  );
}
function content(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .slice(0, 20)
    .map((b) => {
      let text = b.text;
      try {
        text = JSON.stringify(safe(JSON.parse(text)));
      } catch {}
      return { type: 'text', text: redact(text) };
    });
}
export function publicAgentEvent(event, customToolName) {
  if (
    !event ||
    typeof event.id !== 'string' ||
    !Object.hasOwn(fields, event.type)
  )
    return null;
  const result = { id: event.id, type: event.type };
  for (const key of ['session_id', 'session_thread_id', 'processed_at'])
    if (typeof event[key] === 'string') result[key] = event[key].slice(0, 200);
  for (const key of fields[event.type]) {
    if (event[key] === undefined) continue;
    if (key === 'content') {
      if (
        event.type === 'user.custom_tool_result' &&
        !businessTools.has(customToolName)
      )
        continue;
      result.content = content(event.content);
    } else if (key === 'input') {
      if (businessTools.has(event.name)) result.input = safe(event.input);
    } else if (key === 'stop_reason') {
      if (typeof event.stop_reason?.type !== 'string') continue;
      result.stop_reason = { type: event.stop_reason.type.slice(0, 100) };
      if (Array.isArray(event.stop_reason.event_ids))
        result.stop_reason.event_ids = event.stop_reason.event_ids
          .filter((id) => typeof id === 'string')
          .slice(0, 100);
    } else result[key] = safe(event[key]);
  }
  // Bound each event as well as individual fields. Identity/links remain native.
  if (JSON.stringify(result).length > 65536) {
    delete result.content;
    delete result.input;
  }
  return result;
}
