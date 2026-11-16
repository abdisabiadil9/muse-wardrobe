import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  LoaderCircle,
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
  succeeded: '本次搭配已完成',
  failed: '这次没有完成',
  cancelled: '已停止本次搭配',
  unconfirmed: '正在等待结果确认',
};
const toolLabels: Record<string, string> = {
  read_wardrobe: '查看我的衣橱',
  propose_outfit: '整理搭配方案',
  read_memory: '了解穿搭偏好',
  search_memory: '查找穿搭偏好',
  get_weather: '查看天气',
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
}: {
  part: Extract<ConversationPart, { type: 'tool' }>;
  open: boolean;
  onToggle: () => void;
  completed: boolean;
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
      {open && (
        <div id={`tool-${part.id}`} className="ai-tool-detail">
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
    [preparing, setPreparing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState(false);
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
  const busy = preparing || c.submitting;
  useEffect(() => {
    if (initialPrompt) {
      setMessage(initialPrompt);
      onPromptConsumed?.();
      input.current?.focus();
    }
  }, [initialPrompt, onPromptConsumed]);
  useEffect(() => {
    for (const task of c.tasks) {
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
  }, [c.tasks, onTaskChange]);
  useEffect(() => {
    lastCallback.current = {};
    setExpanded({});
    follow.current = true;
    setUnread(false);
  }, [owner]);
  const contentVersion = JSON.stringify([
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
    if (!text || busy || active || c.pending || !enabled || !items.length)
      return;
    setPreparing(true);
    setLocalError('');
    try {
      const snapshot = waiting ? draft : await flush();
      await c.send(text, snapshot);
      setMessage('');
      follow.current = true;
      toBottom();
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setPreparing(false);
    }
  };
  const recover = async () => {
    setLocalError('');
    try {
      await c.recover();
    } catch (error) {
      setLocalError(errorMessage(error));
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
            <h1>MUSE AI</h1>
            <p>懂你的衣橱，也懂今天的你</p>
          </div>
        </div>
        <span className="ai-header-note">穿搭灵感</span>
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
              <span className="ai-eyebrow">YOUR PERSONAL STYLIST</span>
              <h2>今天，想怎么穿？</h2>
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
                    <Sparkles size={13} /> MUSE
                  </div>
                )}
                {parts.map((part) => {
                  if (part.type === 'user') {
                    return (
                      <div className="ai-native-user-turn" key={part.id}>
                        <div className="ai-user-message">{part.text}</div>
                        <div className="ai-assistant-byline">
                          <Sparkles size={13} /> MUSE
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
            先添加几件衣服，让搭配从你的衣橱开始。
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
            aria-label={waiting ? '补充你的搭配要求' : '告诉 MUSE 你的穿搭想法'}
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
              !enabled ||
              !items.length
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
