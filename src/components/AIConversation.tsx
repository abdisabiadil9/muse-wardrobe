import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import AgentInspirationCards from './AgentInspirationCards';
import AgentProductCards from './AgentProductCards';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  LoaderCircle,
  History,
  SquarePen,
  Minus,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
  X,
} from 'lucide-react';
import type { Api, Draft, MediaAsset, Task } from '../api/client';
import { errorMessage } from '../api/client';
import type { Garment } from '../data';
import {
  projectConversation,
  displayAgentText,
  safeConversationImageUrl,
  safeConversationUrl,
  shouldFollowConversation,
  taskIsWorking,
  type ConversationPart,
  type ConversationTask,
} from '../conversation';
import { useConversation } from '../hooks/useConversation';
import '../conversation.css';

export type AIConversationProps = {
  api: Api;
  owner: string;
  draft: Draft;
  items: Garment[];
  enabled: boolean;
  flush: () => Promise<Draft>;
  renderItem?: (item: Garment) => ReactNode;
  onOpenProposal?: (task: Task) => void;
  initialPrompt?: string;
  onPromptConsumed?: () => void;
  onTaskChange?: (task: Task | null) => void;
  proposalPreviews?: Record<
    string,
    { asset: MediaAsset; mode: 'single' | 'outfit'; taskId: string }
  >;
};
const labels: Record<string, string> = {
  queued: '已收到，稍等一下',
  running: '正在整理搭配思路',
  waiting_tools: '正在查看相关信息',
  needs_input: '再了解一点你的想法',
  succeeded: '本次建议已完成',
  failed: '这次没有完成',
  cancelled: '已停止本次搭配',
  unconfirmed: '正在等待结果确认',
};
const toolLabels: Record<string, string> = {
  Read: '读取搭配资料',
  read_wardrobe: '查看我的衣橱',
  propose_outfit: '整理搭配方案',
  read_memory: '了解穿搭偏好',
  search_memory: '查找穿搭偏好',
  get_weather: '查看天气',
  get_style_definition: '了解风格特点',
  search_inspirations: '查找小红书图文',
  read_inspiration_note: '读取灵感笔记',
  search_products: '查找淘宝商品',
};
function Markdown({
  text,
  imageUrls,
  onImage,
}: {
  text: string;
  imageUrls: string[];
  onImage: (url: string, alt: string) => void;
}) {
  const imageUrl = (url: string) =>
    safeConversationImageUrl(url, location.origin, imageUrls);
  return (
    <div className="ai-markdown">
      <ReactMarkdown
        skipHtml
        urlTransform={(url, key) =>
          key === 'src' ? imageUrl(url) : safeConversationUrl(url)
        }
        components={{
          a: ({ children, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt, src }) => {
            const url = src ? imageUrl(src) : '';
            return url ? (
              <img
                className="ai-inline-image"
                src={url}
                alt={alt || '对话中的图片'}
                loading="lazy"
                tabIndex={0}
                role="button"
                onClick={() => onImage(url, alt || '对话中的图片')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    onImage(url, alt || '对话中的图片');
                }}
              />
            ) : (
              <span>{alt || '图片暂不可用'}</span>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function readable(value: unknown) {
  if (value === undefined || value === null) return '';
  if (
    Array.isArray(value) &&
    value.every(
      (part) => part?.type === 'text' && typeof part.text === 'string',
    )
  )
    value = value.map((part) => part.text).join('\n');
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '暂时无法显示';
  }
}

function ToolRow({
  part,
  open,
  onToggle,
  completed,
  onImage,
  onUse,
}: {
  part: Extract<ConversationPart, { type: 'tool' }>;
  open: boolean;
  onToggle: () => void;
  completed: boolean;
  onImage: (url: string, alt: string) => void;
  onUse: (text: string) => void;
}) {
  const done = part.status !== 'running';
  return (
    <div className={`ai-tool ${open ? 'is-open' : ''}`}>
      <button
        className="ai-tool-trigger"
        aria-expanded={open}
        aria-controls={`tool-${part.id}`}
        onClick={onToggle}
      >
        <span className={`ai-tool-state ${part.status}`}>
          {part.status === 'failed' ? (
            <X size={13} />
          ) : done ? (
            <Check size={13} />
          ) : completed ? (
            <Minus size={13} />
          ) : (
            <LoaderCircle className="ai-spin" size={13} />
          )}
        </span>
        <span>{toolLabels[part.name] || part.name}</span>
        <small>
          {part.status === 'failed'
            ? '未完成'
            : done
              ? '已完成'
              : completed
                ? '已结束'
                : '进行中'}
        </small>
        <ChevronDown size={14} className="ai-tool-chevron" />
      </button>
      {['search_inspirations', 'read_inspiration_note'].includes(part.name) && (
        <AgentInspirationCards
          output={part.output}
          styleId={(part.input as { style_id?: string } | undefined)?.style_id}
          onImage={onImage}
          onUse={onUse}
        />
      )}
      {part.name === 'search_products' && (
        <AgentProductCards
          output={part.output}
          onImage={onImage}
          onUse={onUse}
        />
      )}
      {open && (
        <div id={`tool-${part.id}`} className="ai-tool-detail">
          <div>
            <span>工具</span>
            <pre>{part.name}</pre>
          </div>
          <div>
            <span>调用参数</span>
            <pre>{readable(part.input) || '无额外参数'}</pre>
          </div>
          <div>
            <span>返回结果</span>
            <pre>
              {readable(part.output) ||
                (done
                  ? '工具已完成，未提供可展示的返回内容。'
                  : completed
                    ? '本次调用已结束，暂无返回内容。'
                    : '等待返回…')}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
function ProposalCard({
  task,
  items,
  renderItem,
  onOpen,
  preview,
}: {
  task: ConversationTask;
  items: Garment[];
  renderItem?: (item: Garment) => ReactNode;
  onOpen?: () => void;
  preview?: { asset: MediaAsset; mode: 'single' | 'outfit'; taskId: string };
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [preview?.asset.download_url]);
  const result = task.result;
  if (result?.kind !== 'outfit_proposal') return null;
  const selected = [
    ...new Set(Object.values(result.slots).map((ref) => ref?.ref_id)),
  ]
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is Garment => !!item);
  const previewUrl =
    preview?.asset.status === 'ready' && preview.asset.download_url
      ? safeConversationImageUrl(preview.asset.download_url, location.origin, [
          preview.asset.download_url,
        ])
      : '';
  return (
    <button
      className="ai-proposal-card"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label="查看这套搭配并调整"
    >
      <div className={`ai-proposal-visual ${previewUrl ? 'has-preview' : ''}`}>
        {previewUrl ? (
          imageFailed ? (
            <span className="ai-image-unavailable">
              试穿图片暂时不可用，点开搭配重新查看
            </span>
          ) : (
            <img
              className="ai-result-image"
              src={previewUrl}
              alt={`${preview?.mode === 'single' ? '单件' : '整套'} AI 试穿效果`}
              onError={() => setImageFailed(true)}
            />
          )
        ) : selected.length ? (
          selected.slice(0, 4).map((item) => (
            <div className="ai-proposal-item" key={item.id}>
              {renderItem ? (
                renderItem(item)
              ) : item.image ? (
                <img src={item.image} alt={item.name} />
              ) : (
                <Shirt size={32} />
              )}
            </div>
          ))
        ) : (
          <Shirt size={46} />
        )}
      </div>
      <div className="ai-proposal-copy">
        {previewUrl && (
          <span className="ai-preview-label">
            AI 试穿 · {preview?.mode === 'single' ? '单件' : '整套'}
          </span>
        )}
        <span className="ai-eyebrow">为你整理的搭配</span>
        <strong>把今天，穿成喜欢的样子</strong>
        <p>{result.reason || '从你的衣橱出发，找到新的搭配灵感。'}</p>
        <div>
          <span>{result.owned_count} 件来自我的衣橱</span>
          <b>
            查看与调整 <ChevronRight size={14} />
          </b>
        </div>
      </div>
    </button>
  );
}
export default function AIConversation({
  api,
  owner,
  draft,
  items,
  enabled,
  flush,
  renderItem,
  onOpenProposal,
  initialPrompt,
  onPromptConsumed,
  onTaskChange,
  proposalPreviews = {},
}: AIConversationProps) {
  const c = useConversation(api, owner);
  const [message, setMessage] = useState(''),
    [localError, setLocalError] = useState(''),
    [preparingIds, setPreparingIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyPanel = useRef<HTMLElement>(null);
  const activeId = useRef(c.activeId);
  const previousConversation = useRef(c.activeId);
  activeId.current = c.activeId;
  const [viewingImage, setViewingImage] = useState<{
    url: string;
    alt: string;
  } | null>(null);
  const imageUrls = [
    ...items.map((item) => item.image || ''),
    ...Object.values(proposalPreviews).map(
      (preview) => preview.asset.download_url || '',
    ),
  ].filter(Boolean);
  const onImage = (url: string, alt: string) => setViewingImage({ url, alt });
  useEffect(() => {
    if (!viewingImage) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewingImage(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [viewingImage]);
  const viewport = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    input = useRef<HTMLTextAreaElement>(null);
  const lastCallback = useRef<Record<string, string>>({});
  const latest = c.tasks.at(-1);
  const active = c.tasks.find(taskIsWorking);
  const waiting = c.tasks.find((task) => task.status === 'needs_input');
  const busy = preparingIds.includes(c.activeId) || c.submitting;
  useEffect(() => {
    if (initialPrompt) {
      setMessage(initialPrompt);
      onPromptConsumed?.();
      input.current?.focus();
    }
  }, [initialPrompt, onPromptConsumed]);
  useEffect(() => {
    for (const task of c.allTasks) {
      const signature = JSON.stringify([
        task.last_event_seq,
        task.status,
        task.result,
        task.error,
      ]);
      if (lastCallback.current[task.id] !== signature) {
        lastCallback.current[task.id] = signature;
        onTaskChange?.(task);
      }
    }
  }, [c.allTasks, onTaskChange]);
  useEffect(() => {
    lastCallback.current = {};
    setExpanded({});
    follow.current = true;
    setUnread(false);
  }, [owner]);
  useLayoutEffect(() => {
    if (previousConversation.current === c.activeId) return;
    previousConversation.current = c.activeId;
    setMessage('');
    setLocalError('');
    setViewingImage(null);
    setExpanded({});
    follow.current = true;
    setUnread(false);
  }, [c.activeId]);
  useEffect(() => {
    if (!historyOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    historyPanel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
      if (event.key !== 'Tab') return;
      const buttons =
        historyPanel.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard);
      previous?.focus();
    };
  }, [historyOpen]);
  const contentVersion = JSON.stringify([
    c.activeId,
    c.tasks.map((task) => [task.id, task.status, task.result, task.question]),
    c.events,
    c.pending?.key,
    proposalPreviews,
  ]);
  const toBottom = () => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
    follow.current = true;
    setUnread(false);
  };
  useLayoutEffect(() => {
    if (follow.current) toBottom();
    else setUnread(true);
  }, [contentVersion]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (follow.current) toBottom();
    });
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const submit = async () => {
    const text = message.trim();
    if (!text || busy || active || c.pending || c.loading || !enabled) return;
    const threadId = c.activeId;
    setPreparingIds((current) => [...current, threadId]);
    setLocalError('');
    try {
      const snapshot = waiting ? draft : await flush();
      await c.send(text, snapshot, threadId);
      if (activeId.current === threadId) {
        setMessage((current) => (current.trim() === text ? '' : current));
        follow.current = true;
        toBottom();
      }
    } catch (error) {
      if (activeId.current === threadId) setLocalError(errorMessage(error));
    } finally {
      setPreparingIds((current) => current.filter((id) => id !== threadId));
    }
  };
  const recover = async () => {
    const threadId = c.activeId;
    setLocalError('');
    try {
      await c.recover();
    } catch (error) {
      if (activeId.current === threadId) setLocalError(errorMessage(error));
    }
  };
  const suggestions = ['明天上课怎么穿', '保留外套，换个搭法'];
  return (
    <section className="ai-conversation" aria-label="AI 穿搭对话">
      <header className="ai-chat-header">
        <div className="ai-chat-title">
          <span className="ai-muse-mark">
            <Sparkles size={18} />
          </span>
          <div>
            <h1>Lumi</h1>
            <p>
              {c.empty
                ? '你的衣橱搭配助手'
                : c.conversations.find((thread) => thread.id === c.activeId)
                    ?.title}
            </p>
          </div>
        </div>
        <div className="ai-header-actions">
          <button
            className="ai-icon-button"
            aria-label="历史对话"
            title="历史对话"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={20} strokeWidth={1.7} />
          </button>
          <button
            className="ai-icon-button"
            aria-label="新建对话"
            title="新建对话"
            onClick={c.newConversation}
          >
            <SquarePen size={20} strokeWidth={1.7} />
          </button>
        </div>
      </header>
      <div
        className="ai-chat-viewport"
        ref={viewport}
        onScroll={() => {
          const element = viewport.current;
          if (!element) return;
          follow.current = shouldFollowConversation(
            element.scrollHeight,
            element.scrollTop,
            element.clientHeight,
          );
          if (follow.current) setUnread(false);
        }}
      >
        <div className="ai-chat-transcript">
          {c.loading && (
            <p className="ai-restoring">
              <LoaderCircle size={15} className="ai-spin" /> 正在找回你的对话
            </p>
          )}
          {c.empty && (
            <div className="ai-welcome">
              <div className="ai-welcome-symbol">
                <Sparkles size={30} strokeWidth={1.4} />
              </div>
              <span className="ai-eyebrow">Lumi · 你的穿搭助手</span>
              <h2>今天想怎么穿？</h2>
              <p>
                一点想法，一个场合。
                <br />
                一起发现衣橱里的新可能。
              </p>
              <div className="ai-welcome-prompts">
                {suggestions.map((text) => (
                  <button
                    key={text}
                    onClick={() => {
                      setMessage(text);
                      input.current?.focus();
                    }}
                  >
                    {text}
                    <Plus size={15} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {c.tasks.map((task) => {
            const parts = projectConversation(
              c.events[task.id] || [],
              c.messages[task.id],
            );
            const hasUser = parts.some((part) => part.type === 'user');
            return (
              <article
                className="ai-round"
                key={task.id}
                aria-label="一轮穿搭对话"
              >
                {!hasUser && (
                  <div className="ai-user-message">
                    {c.messages[task.id] || '帮我搭一套'}
                  </div>
                )}
                {!hasUser && (
                  <div className="ai-assistant-byline">
                    <Sparkles size={13} /> Lumi
                  </div>
                )}
                {parts.map((part) => {
                  if (part.type === 'user') {
                    return (
                      <div className="ai-native-user-turn" key={part.id}>
                        <div className="ai-user-message">{part.text}</div>
                        <div className="ai-assistant-byline">
                          <Sparkles size={13} /> Lumi
                        </div>
                      </div>
                    );
                  }
                  if (part.type === 'text')
                    return (
                      <div
                        className={`ai-assistant-message ${part.phase === 'final' ? 'ai-final-answer' : ''}`}
                        key={part.id}
                      >
                        {part.phase === 'final' && (
                          <span className="ai-final-label">给你的搭配建议</span>
                        )}
                        <Markdown
                          text={displayAgentText(part.text)}
                          imageUrls={imageUrls}
                          onImage={onImage}
                        />
                      </div>
                    );
                  const key = `${task.id}:${part.id}`;
                  return (
                    <ToolRow
                      key={part.id}
                      part={part}
                      onImage={onImage}
                      onUse={(text) => {
                        setMessage(text);
                        input.current?.focus();
                      }}
                      completed={!taskIsWorking(task)}
                      open={!!expanded[key]}
                      onToggle={() => {
                        follow.current = false;
                        setExpanded((previous) => ({
                          ...previous,
                          [key]: !previous[key],
                        }));
                      }}
                    />
                  );
                })}
                {task.status === 'succeeded' && (
                  <ProposalCard
                    task={task}
                    items={items}
                    renderItem={renderItem}
                    onOpen={
                      onOpenProposal ? () => onOpenProposal(task) : undefined
                    }
                    preview={proposalPreviews[task.id]}
                  />
                )}
                {task.status === 'needs_input' &&
                  task.question &&
                  !parts.some(
                    (part) =>
                      part.type === 'text' &&
                      displayAgentText(part.text) === task.question,
                  ) && (
                    <div className="ai-assistant-message">
                      <Markdown
                        text={task.question}
                        imageUrls={imageUrls}
                        onImage={onImage}
                      />
                    </div>
                  )}
                {taskIsWorking(task) && (
                  <div className="ai-task-status" role="status">
                    <LoaderCircle size={13} className="ai-spin" />
                    {task.cancel_requested_at
                      ? '正在停止，请稍等'
                      : labels[task.status]}
                    <button
                      disabled={!!task.cancel_requested_at}
                      onClick={() => void c.cancel(task.id)}
                    >
                      <CircleStop size={13} />
                      停止
                    </button>
                  </div>
                )}
                {task.status === 'failed' && (
                  <p className="ai-inline-error" role="alert">
                    {task.error?.message ||
                      '这次搭配没有完成，可以调整想法后再试。'}
                  </p>
                )}
                {task.status === 'cancelled' && (
                  <p className="ai-round-note">已停止本次搭配</p>
                )}
                {task.status === 'unconfirmed' && (
                  <p className="ai-round-note">结果尚未确认，请先恢复查询。</p>
                )}
              </article>
            );
          })}
          {c.pending && (
            <article className="ai-round ai-pending-round">
              <div className="ai-user-message">{c.pending.message}</div>
              <p className="ai-round-note">
                {c.submitting
                  ? '正在发送…'
                  : '提交结果待确认，请恢复上次提交。'}
              </p>
            </article>
          )}
        </div>
      </div>
      {unread && (
        <button className="ai-new-messages" onClick={toBottom}>
          <ArrowDown size={14} /> 回到最新消息
        </button>
      )}
      <div className="ai-compose-area">
        {(c.error || localError) && (
          <div className="ai-chat-error" role="alert">
            <span>{localError || c.error}</span>
            <button disabled={busy} onClick={() => void recover()}>
              <RefreshCw size={13} />
              恢复查询
            </button>
          </div>
        )}
        {c.pending && !c.error && !localError && !c.submitting && (
          <button className="ai-recover" onClick={() => void recover()}>
            <RefreshCw size={14} />
            恢复上次提交
          </button>
        )}
        {latest?.status === 'unconfirmed' && !c.pending && (
          <button className="ai-recover" onClick={() => void recover()}>
            <RefreshCw size={14} />
            查询最新状态
          </button>
        )}
        {c.error.includes('登录') && (
          <a className="ai-login" href="/api/v1/auth/login?return_to=/">
            重新登录并恢复对话
          </a>
        )}
        {!enabled && (
          <p className="ai-service-note">
            AI 搭配暂不可用，衣橱与已有搭配仍可查看。
          </p>
        )}
        {enabled && !items.length && (
          <p className="ai-service-note">
            可以先聊风格、找穿搭灵感；添加衣物后，再组合你自己的搭配。
          </p>
        )}
        {!c.empty && !active && !c.pending && (
          <div className="ai-quick-prompts">
            {suggestions.map((text) => (
              <button
                key={text}
                onClick={() => {
                  setMessage(text);
                  input.current?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        <form
          className="ai-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={input}
            aria-label={waiting ? '补充你的搭配要求' : '告诉 Lumi 你的穿搭想法'}
            rows={1}
            maxLength={2000}
            placeholder={waiting ? '补充一点你的想法…' : '说说今天的穿搭想法…'}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              event.target.style.height = 'auto';
              event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button
            className="ai-send"
            type="submit"
            aria-label={waiting ? '补充并继续搭配' : '发送消息'}
            disabled={
              !message.trim() ||
              busy ||
              !!active ||
              !!c.pending ||
              c.loading ||
              !enabled
            }
          >
            {busy ? (
              <LoaderCircle size={17} className="ai-spin" />
            ) : (
              <ArrowUp size={19} />
            )}
          </button>
        </form>
        <p className="ai-compose-note">灵感由 AI 提供，选择始终属于你</p>
      </div>
      {historyOpen && (
        <div
          className="ai-history-backdrop"
          onClick={() => setHistoryOpen(false)}
        >
          <section
            className="ai-history-panel"
            ref={historyPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-history-heading">
              <div>
                <h2 id="ai-history-title">历史对话</h2>
                <p>对话保存在当前设备的浏览器中</p>
              </div>
              <button
                className="ai-icon-button"
                aria-label="关闭历史对话"
                onClick={() => setHistoryOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <button
              className="ai-history-new"
              onClick={() => {
                c.newConversation();
                setHistoryOpen(false);
              }}
            >
              <SquarePen size={18} /> 新建对话
            </button>
            <div className="ai-history-list">
              {[...c.conversations]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((thread) => (
                  <button
                    className={`ai-history-item ${thread.id === c.activeId ? 'is-active' : ''}`}
                    key={thread.id}
                    aria-current={thread.id === c.activeId ? 'true' : undefined}
                    onClick={() => {
                      c.selectConversation(thread.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span>
                      <strong>{thread.title}</strong>
                      <small>
                        {thread.pending
                          ? '有一条消息待确认'
                          : `${thread.ids.length} 轮搭配对话`}
                      </small>
                    </span>
                    {thread.id === c.activeId ? (
                      <Check size={17} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                ))}
            </div>
          </section>
        </div>
      )}
      {viewingImage && (
        <div
          className="ai-image-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={viewingImage.alt}
          onClick={() => setViewingImage(null)}
        >
          <button
            autoFocus
            className="ai-image-close"
            aria-label="关闭图片"
            onClick={() => setViewingImage(null)}
          >
            <X size={21} />
          </button>
          <img
            src={viewingImage.url}
            alt={viewingImage.alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
export { AIConversation };
