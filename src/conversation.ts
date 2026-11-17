import type { Scene, Task } from './api/client';
import { newKey } from './api/client.ts';

/** Public native event fields only. The renderer never infers event types from text. */
export type NativeConversationEvent = {
  id: string;
  type: string;
  content?: Array<{ type: string; text?: string }> | string;
  name?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  tool_use_id?: string;
  custom_tool_use_id?: string;
  is_error?: boolean;
  status?: string;
  created_at?: string;
  stop_reason?: { type: string; event_ids?: string[] };
};
export type ConversationTask = Task & {
  created_at?: string;
  input?: {
    message?: string;
    scene?: string;
    draft_id?: string;
    draft_revision?: number;
    source_task_id?: string;
  };
  events?: NativeConversationEvent[];
};
export type ConversationPart =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'text'; text: string; phase: 'intermediate' | 'final' }
  | {
      id: string;
      type: 'tool';
      name: string;
      input?: unknown;
      output?: unknown;
      status: 'running' | 'succeeded' | 'failed';
    };
export type ConversationContext = {
  scene: Scene;
  draftId: string;
  revision: number;
};
export type PendingMessage = {
  context?: ConversationContext;
  key: string;
  path: string;
  body: Record<string, unknown>;
  message: string;
  createdAt: string;
};
export type ConversationRecord = {
  ids: string[];
  pending?: PendingMessage;
  messages: Record<string, string>;
  contexts: Record<string, ConversationContext>;
  answers: Record<string, Array<{ id: string; text: string }>>;
};
export const emptyRecord = (): ConversationRecord => ({
  ids: [],
  messages: {},
  contexts: {},
  answers: {},
});
export const conversationStorageKey = (owner: string) =>
  `muse-live:${owner}:conversation:v1`;
export function readConversationRecord(
  storage: Pick<Storage, 'getItem'>,
  owner: string,
): ConversationRecord {
  try {
    const value = JSON.parse(
      storage.getItem(conversationStorageKey(owner)) || 'null',
    );
    if (!value || !Array.isArray(value.ids)) return emptyRecord();
    return {
      ids: value.ids.filter((id: unknown) => typeof id === 'string'),
      messages: value.messages || {},
      contexts: value.contexts || {},
      answers: value.answers || {},
      ...(value.pending?.key &&
      value.pending?.path &&
      value.pending?.body &&
      typeof value.pending?.message === 'string'
        ? { pending: value.pending }
        : {}),
    };
  } catch {
    return emptyRecord();
  }
}

export type ConversationThread = ConversationRecord & {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type ConversationHistory = {
  version: 2;
  activeId: string;
  threads: ConversationThread[];
};
export const conversationHistoryKey = (owner: string) =>
  `muse-live:${owner}:conversation:v2`;
export function newConversationThread(
  id = newKey(),
  now = new Date().toISOString(),
): ConversationThread {
  return {
    ...emptyRecord(),
    id,
    title: '新对话',
    createdAt: now,
    updatedAt: now,
  };
}
export const conversationTitle = (message: string) =>
  message.trim().replace(/\s+/g, ' ').slice(0, 24) || '新对话';

/** Migrate the single transcript once; future new chats never inherit its context. */
export function readConversationHistory(
  storage: Pick<Storage, 'getItem'>,
  owner: string,
): ConversationHistory {
  try {
    const saved = JSON.parse(
      storage.getItem(conversationHistoryKey(owner)) || 'null',
    );
    if (saved?.version === 2 && Array.isArray(saved.threads)) {
      const seen = new Set<string>();
      const threads: ConversationThread[] = saved.threads.flatMap(
        (thread: ConversationThread) => {
          if (
            !thread ||
            typeof thread.id !== 'string' ||
            seen.has(thread.id) ||
            !Array.isArray(thread.ids)
          )
            return [];
          seen.add(thread.id);
          const record = readConversationRecord(
            { getItem: () => JSON.stringify(thread) },
            owner,
          );
          const defaults = newConversationThread(thread.id);
          return [
            {
              ...defaults,
              ...record,
              title: typeof thread.title === 'string' ? thread.title : '新对话',
              createdAt:
                typeof thread.createdAt === 'string'
                  ? thread.createdAt
                  : defaults.createdAt,
              updatedAt:
                typeof thread.updatedAt === 'string'
                  ? thread.updatedAt
                  : defaults.updatedAt,
            },
          ];
        },
      );
      if (threads.length)
        return {
          version: 2,
          activeId: threads.some((thread) => thread.id === saved.activeId)
            ? saved.activeId
            : threads[0].id,
          threads,
        };
    }
  } catch {
    /* Fall back to the previous transcript if storage is malformed. */
  }
  const legacy = readConversationRecord(storage, owner);
  for (const scene of ['daily', 'weekend', 'meeting']) {
    try {
      const task = JSON.parse(
        storage.getItem(`muse-live:${owner}:task:styling:${scene}`) || 'null',
      );
      if (typeof task?.taskId === 'string' && !legacy.ids.includes(task.taskId))
        legacy.ids.push(task.taskId);
    } catch {
      /* Ignore malformed legacy task metadata. */
    }
  }
  const thread = { ...newConversationThread(), ...legacy };
  thread.title = conversationTitle(
    legacy.messages[legacy.ids[0]] ||
      legacy.pending?.message ||
      (legacy.ids.length ? '此前的搭配对话' : ''),
  );
  return { version: 2, activeId: thread.id, threads: [thread] };
}

/** Home cards need task origins from every thread, not just the open chat. */
export function readConversationTaskIndex(
  storage: Pick<Storage, 'getItem'>,
  owner: string,
) {
  const { threads } = readConversationHistory(storage, owner);
  return {
    ids: [...new Set(threads.flatMap((thread) => thread.ids))],
    contexts: Object.assign(
      {},
      ...threads.map((thread) => thread.contexts),
    ) as Record<string, ConversationContext>,
  };
}

/** Async results always update their originating thread, even after a history switch. */
export function updateConversationThread(
  history: ConversationHistory,
  id: string,
  update: (thread: ConversationThread) => ConversationThread,
): ConversationHistory {
  return {
    ...history,
    threads: history.threads.map((thread) =>
      thread.id === id ? update(thread) : thread,
    ),
  };
}
export function eventText(event: NativeConversationEvent): string {
  return typeof event.content === 'string'
    ? event.content
    : (event.content || [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
}
const tools = new Set(['agent.tool_use', 'agent.custom_tool_use', 'tool.use']);
const results = new Set([
  'user.tool_result',
  'user.custom_tool_result',
  'agent.tool_result',
  'tool.result',
]);
/** Pair a result to its native call ID in place, retaining the call's chronological position. */
export function projectNativeEvents(
  events: NativeConversationEvent[],
): ConversationPart[] {
  const parts: ConversationPart[] = [];
  const seen = new Set<string>();
  const finalIds = new Set<string>();
  let lastMessage: string | undefined;
  for (const event of events) {
    if (event.type === 'user.message') lastMessage = undefined;
    if (event.type === 'agent.message') lastMessage = event.id;
    if (
      event.type === 'session.status_idle' &&
      event.stop_reason?.type === 'end_turn' &&
      lastMessage
    )
      finalIds.add(lastMessage);
  }
  const outputs = new Map<string, NativeConversationEvent>();
  for (const event of events) {
    if (results.has(event.type)) {
      const callId = event.custom_tool_use_id || event.tool_use_id;
      if (callId) outputs.set(callId, event);
    }
  }
  for (const event of events) {
    if (!event.id || seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.type === 'user.message' || event.type === 'agent.message') {
      const text = eventText(event);
      if (text)
        parts.push(
          event.type === 'user.message'
            ? { id: event.id, type: 'user', text }
            : {
                id: event.id,
                type: 'text',
                text,
                phase: finalIds.has(event.id) ? 'final' : 'intermediate',
              },
        );
    } else if (tools.has(event.type)) {
      const result = outputs.get(event.id);
      const part: Extract<ConversationPart, { type: 'tool' }> = {
        id: event.id,
        type: 'tool',
        name: event.name || '工具调用',
        input: event.input,
        status: result
          ? result.is_error
            ? 'failed'
            : 'succeeded'
          : event.status === 'failed'
            ? 'failed'
            : 'running',
      };
      if (result)
        part.output = result.output ?? result.result ?? result.content;
      else if (event.output !== undefined) {
        part.output = event.output;
        part.status = event.is_error ? 'failed' : 'succeeded';
      }
      parts.push(part);
    }
  }
  return parts;
}
export function mergeTask(
  current: ConversationTask | undefined,
  incoming: ConversationTask,
): ConversationTask {
  if (current && incoming.last_event_seq < current.last_event_seq)
    return current;
  return { ...current, ...incoming };
}
export function mergeNativeEvents(
  current: NativeConversationEvent[],
  incoming: NativeConversationEvent[],
) {
  const result = [...current];
  const index = new Map(result.map((event, i) => [event.id, i]));
  for (const event of incoming) {
    const i = index.get(event.id);
    if (i === undefined) {
      index.set(event.id, result.length);
      result.push(event);
    } else result[i] = { ...result[i], ...event };
  }
  return result;
}
export const taskIsWorking = (task: Task) =>
  ['queued', 'running', 'waiting_tools'].includes(task.status);
export const shouldFollowConversation = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
) => scrollHeight - scrollTop - clientHeight < 72;
export const safeConversationUrl = (url: string) =>
  /^(https?:|mailto:)/i.test(url) ? url : '';

export function displayUserMessage(text: string): string {
  try {
    const wrapper = JSON.parse(text);
    if (
      typeof wrapper?.message === 'string' &&
      typeof wrapper?.scene === 'string'
    )
      return wrapper.message || '帮我搭一套';
  } catch {
    /* Plain native user messages are already displayable. */
  }
  return text;
}

/** Existing MUSE Agent contract uses a structured final question for needs_input. */
export function displayAgentText(text: string): string {
  try {
    const value = JSON.parse(text);
    if (value?.kind === 'needs_input' && typeof value.question === 'string')
      return value.question;
  } catch {
    /* Ordinary public text is preserved verbatim. */
  }
  return text;
}

/** Keep the latest user request intact within the existing API's 2,000-character limit. */
export function composeStylingMessage(
  message: string,
  prior: unknown[],
): string {
  const request = message.slice(0, 2000);
  if (!prior.length) return request;
  const start = '此前搭配对话（仅供理解上下文，可能有截断）：\n';
  const end = `\n\n本次请求：${request}`;
  const allowance = 2000 - start.length - end.length;
  if (allowance < 80) return request;
  return `${start}${JSON.stringify(prior).slice(-allowance)}${end}`;
}

export function safeConversationImageUrl(
  url: string,
  origin: string,
  ownedUrls: Iterable<string> = [],
): string {
  try {
    const parsed = new URL(url, origin);
    if (!['https:', 'http:'].includes(parsed.protocol)) return '';
    if (
      parsed.origin === origin &&
      /^\/api\/v1\/media\/[a-f0-9-]+\/content$/.test(parsed.pathname)
    )
      return parsed.href;
    const owned = [...ownedUrls].some((candidate) => {
      try {
        return new URL(candidate, origin).href === parsed.href;
      } catch {
        return false;
      }
    });
    if (owned && (parsed.protocol === 'https:' || parsed.origin === origin))
      return parsed.href;
  } catch {
    /* Incomplete streamed URLs are simply not rendered yet. */
  }
  return '';
}

export function projectConversation(
  events: NativeConversationEvent[],
  initialMessage?: string,
): ConversationPart[] {
  let firstUser = true;
  return projectNativeEvents(events).map((part) => {
    if (part.type !== 'user') return part;
    const text =
      firstUser && initialMessage
        ? initialMessage
        : displayUserMessage(part.text);
    firstUser = false;
    return { ...part, text };
  });
}
