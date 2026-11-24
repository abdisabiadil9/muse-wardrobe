import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  ImageOff,
  Link,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Api } from '../api/client';
import {
  inspirationPrompt,
  inspirationImageUrl,
  styleLibrary,
  type InspirationNote,
} from '../inspiration';
import { useInspiration } from '../hooks/useInspiration';
import './inspiration-library.css';

function SourceImage({
  note,
  index = 0,
}: {
  note: InspirationNote;
  index?: number;
}) {
  const [failed, setFailed] = useState(false),
    url = inspirationImageUrl(note.images[index] || '');
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? (
    <img
      src={url}
      alt={`${note.title || '穿搭灵感'} · 图片 ${index + 1}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="inspo-image-fallback">
      <ImageOff size={26} />
      <span>图片暂不可用</span>
    </div>
  );
}
export default function InspirationLibrary({
  api,
  owner,
  enabled,
  favorites,
  onFavorite,
  onUse,
  initialFilter = '全部',
}: {
  api: Api;
  owner: string;
  enabled: boolean;
  favorites: string[];
  onFavorite: (id: string) => void;
  onUse: (text: string) => void;
  initialFilter?: string;
}) {
  const [styleId, setStyleId] = useState(() => {
    const explicit = styleLibrary.find((s) => s.name === initialFilter)?.id;
    if (explicit) return explicit;
    try {
      const saved = JSON.parse(
        localStorage.getItem(`muse-live:${owner}:inspiration-request`) ||
          'null',
      );
      if (styleLibrary.some((s) => s.id === saved?.request?.style_id))
        return saved.request.style_id as string;
    } catch {
      /* ignore invalid local state */
    }
    return 'city';
  });
  const [favoritesOnly, setFavoritesOnly] = useState(
    initialFilter === '已收藏',
  );
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<InspirationNote[]>([]);
  const [selected, setSelected] = useState<InspirationNote | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [listLabel, setListLabel] = useState('');
  const [cacheError, setCacheError] = useState('');
  const [cacheLoading, setCacheLoading] = useState(false);
  const style = styleLibrary.find((s) => s.id === styleId)!;
  const job = useInspiration(api, owner);
  const lastApplied = useRef('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cacheController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    cacheController.current = controller;
    setNotes([]);
    setFetchedAt(null);
    setSelected(null);
    setCacheError('');
    setCacheLoading(true);
    setListLabel(style.name);
    api
      .get<{ data: InspirationNote[]; fetched_at: string | null }>(
        `/inspirations?style_id=${encodeURIComponent(styleId)}`,
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted) {
          setNotes(data.data);
          setFetchedAt(data.fetched_at);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCacheError('暂时没能读取已保存的灵感。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCacheLoading(false);
      });
    return () => controller.abort();
  }, [api, styleId]);
  useEffect(() => {
    const task = job.task;
    if (
      task?.status !== 'succeeded' ||
      !task.result ||
      task.id === lastApplied.current ||
      job.record?.request.style_id !== styleId
    )
      return;
    lastApplied.current = task.id;
    cacheController.current?.abort();
    setCacheLoading(false);
    setFetchedAt(task.result.fetched_at);
    if (job.record.request.action === 'note') {
      const note = task.result.data[0];
      if (note) {
        const seenKey = `muse-live:${owner}:inspiration-seen-note-task`;
        try {
          if (localStorage.getItem(seenKey) !== task.id) setSelected(note);
          localStorage.setItem(seenKey, task.id);
        } catch {
          setSelected(note);
        }
        setNotes((old) => [note, ...old.filter((n) => n.id !== note.id)]);
      } else setCacheError('这篇笔记暂时无法读取，可以打开原文查看。');
    } else {
      setNotes(task.result.data);
      setListLabel(job.record.request.keyword || style.name);
      setCacheError('');
    }
  }, [job.task, job.record, styleId]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'Tab') {
        const nodes = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled)',
          ) ?? []),
        ].filter((n) => n.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [selected?.id]);
  const runSearch = () => {
    const value = query.trim();
    if (/https?:\/\//i.test(value) || /^[a-f0-9]{24}$/i.test(value))
      void job.start({ action: 'note', style_id: styleId, url: value });
    else
      void job.start({
        action: 'search',
        style_id: styleId,
        ...(value ? { keyword: value } : {}),
      });
  };
  const visible = styleLibrary.filter(
    (s) => !favoritesOnly || favorites.includes(s.id),
  );
  const sourceError = job.error || job.task?.error?.message;
  return (
    <div className="inspo-library">
      <header className="inspo-heading">
        <span className="inspo-eyebrow">A LITTLE INSPIRATION</span>
        <h1>
          喜欢的感觉，
          <br />
          穿成自己的样子。
        </h1>
        <p>先找到风格，再用你的衣橱重新组合。</p>
      </header>
      <div className="inspo-section-label">
        <h2>
          你的风格起点 <small>12</small>
        </h2>
        <button
          className={favoritesOnly ? 'is-active' : ''}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
        >
          <Bookmark size={15} />
          已收藏
        </button>
      </div>
      <div className="inspo-style-rail" aria-label="选择风格">
        {visible.map((s) => (
          <button
            key={s.id}
            className={styleId === s.id ? 'selected' : ''}
            aria-pressed={styleId === s.id}
            onClick={() => {
              setStyleId(s.id);
              setQuery('');
              setExpanded(false);
            }}
          >
            <span className="inspo-mini-palette">
              {s.palette.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {s.name}
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className="inspo-muted">
          还没有收藏。关闭筛选，看看哪些风格让你心动。
        </p>
      )}
      <article
        className="inspo-style-card"
        style={{ '--style-tint': style.palette[0] } as CSSProperties}
      >
        <div className="inspo-style-title">
          <div>
            <p>STYLE NOTES</p>
            <h2>{style.name}</h2>
            <span>{style.subtitle}</span>
          </div>
          <button
            className="inspo-icon"
            aria-label={`${favorites.includes(style.id) ? '取消收藏' : '收藏'}${style.name}`}
            aria-pressed={favorites.includes(style.id)}
            onClick={() => onFavorite(style.id)}
          >
            <Bookmark
              size={22}
              fill={favorites.includes(style.id) ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        <p className="inspo-description">{style.description}</p>
        <div className="inspo-palette">
          {style.palette.map((c, i) => (
            <span key={c}>
              <i style={{ background: c }} />
              {style.colors[i]}
            </span>
          ))}
        </div>
        <div className="inspo-formula">
          <span>试试这个组合</span>
          <strong>{style.formula}</strong>
        </div>
        <button
          className="inspo-text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起风格笔记' : '看廓形、单品和适用场景'}
          <span>{expanded ? '−' : '＋'}</span>
        </button>
        {expanded && (
          <dl className="inspo-definition">
            <dt>廓形</dt>
            <dd>{style.silhouette}</dd>
            <dt>代表单品</dt>
            <dd>{style.pieces.join(' · ')}</dd>
            <dt>适用场景</dt>
            <dd>{style.occasions.join(' · ')}</dd>
            <dt>说明</dt>
            <dd>MUSE 编辑定义，是搭配参考，不是唯一标准。</dd>
          </dl>
        )}
        <button
          className="inspo-primary"
          onClick={() => onUse(inspirationPrompt(style))}
        >
          <Sparkles size={17} />
          用我的衣橱搭这套风格
        </button>
      </article>
      <section className="inspo-source-section" aria-label="小红书图文灵感">
        <div className="inspo-section-label">
          <h2>看看真实穿搭</h2>
          <span className="inspo-source-badge">小红书 · 图文</span>
        </div>
        <form
          className="inspo-search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <Search size={18} />
          <input
            aria-label="搜索穿搭或粘贴小红书笔记链接"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="穿搭关键词 / 小红书笔记链接"
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={!enabled || job.busy || job.pending}
            aria-label="搜索或导入笔记"
          >
            <ArrowUpRight size={20} />
          </button>
        </form>
        <button
          className="inspo-search-style"
          disabled={!enabled || job.busy || job.pending}
          onClick={() =>
            void job.start({ action: 'search', style_id: styleId })
          }
        >
          <Search size={15} />
          找「{style.name}」的图片
        </button>
        {!enabled && (
          <p className="inspo-muted">
            图文灵感暂未开通。你可以先用上面的风格说明搭配。
          </p>
        )}
        {(job.busy || cacheLoading) && (
          <div className="inspo-status" role="status">
            <LoaderCircle size={17} className="inspo-spin" />
            {cacheLoading
              ? '正在读取已保存的灵感…'
              : job.task?.stage === 'source_backoff'
                ? '来源繁忙，稍后继续查询…'
                : '正在寻找图文灵感，离开页面后也能恢复。'}
          </div>
        )}
        {(sourceError || job.pending) && (
          <div className="inspo-error" role="alert">
            <p>{sourceError || '上次提交尚未确认，请恢复原请求。'}</p>
            {(job.pending || job.task?.status === 'unconfirmed') && (
              <button onClick={() => void job.recover()} disabled={job.sending}>
                恢复原请求
              </button>
            )}
          </div>
        )}
        {cacheError && <p className="inspo-muted">{cacheError}</p>}
        {!!notes.length && (
          <p className="inspo-results-caption">
            {listLabel} · {notes.length} 篇
            {fetchedAt
              ? ` · ${new Date(fetchedAt).toLocaleDateString('zh-CN')} 获取`
              : ''}
          </p>
        )}
        <div className="inspo-note-grid">
          {notes.map((note) => (
            <button
              className="inspo-note"
              key={note.id}
              onClick={() => setSelected(note)}
            >
              <SourceImage note={note} />
              <div>
                <strong>{note.title || '一份穿搭灵感'}</strong>
                <span>
                  {note.author || '小红书作者'}
                  {note.sponsored ? ' · 商业合作' : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
        {!notes.length && !job.busy && !cacheLoading && (
          <div className="inspo-empty">
            <span className="inspo-empty-icon">
              <Link size={24} />
            </span>
            <h3>把你喜欢的那一套带过来</h3>
            <p>
              粘贴笔记链接，或搜索当前风格。
              <br />
              选中喜欢的内容，再让 Lumi 帮你搭配。
            </p>
          </div>
        )}
        <p className="inspo-footnote">
          保留作者与原文来源。图片是穿搭参考，不是你的试穿结果。
        </p>
      </section>
      {selected && (
        <div
          ref={dialogRef}
          className="inspo-detail"
          role="dialog"
          aria-modal="true"
          aria-label="穿搭灵感详情"
        >
          <div className="inspo-detail-inner">
            <header>
              <button
                ref={closeRef}
                onClick={() => setSelected(null)}
                aria-label="返回灵感库"
              >
                <ArrowLeft size={20} />
              </button>
              <span>灵感详情</span>
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                原文
                <ArrowUpRight size={16} />
              </a>
            </header>
            <div className="inspo-gallery">
              {(selected.images.length ? selected.images : [null]).map(
                (_, i) => (
                  <div key={i}>
                    <SourceImage note={selected} index={i} />
                  </div>
                ),
              )}
            </div>
            <div className="inspo-note-body">
              <p className="inspo-eyebrow">
                小红书 · {selected.author || '原作者'}
              </p>
              <h2>{selected.title || '穿搭灵感'}</h2>
              <p className="inspo-note-text">
                {selected.text ||
                  '这篇笔记暂时没有可用文字。你仍可查看原文，或使用当前风格定义。'}
              </p>
              {!!selected.tags.length && (
                <div className="inspo-tags">
                  {selected.tags.map((tag, i) => (
                    <span key={i}>#{tag}</span>
                  ))}
                </div>
              )}
              {selected.is_summary ? (
                <button
                  className="inspo-secondary"
                  disabled={!enabled || job.busy || job.pending}
                  onClick={() =>
                    void job.start({
                      action: 'note',
                      style_id: styleId,
                      url: selected.url,
                    })
                  }
                >
                  {job.busy ? <LoaderCircle size={16} /> : <Link size={16} />}
                  读取完整笔记
                </button>
              ) : (
                <p className="inspo-muted">
                  <Check size={14} />
                  已读取笔记全文
                </p>
              )}
              {sourceError && (
                <p className="inspo-error" role="alert">
                  {sourceError}
                </p>
              )}
              <p className="inspo-muted">
                依据「{style.name}
                」定义与笔记文字生成个人方案；尚未分析图片里的单品。
              </p>
              <button
                className="inspo-primary"
                onClick={() => {
                  onUse(inspirationPrompt(style, selected));
                  setSelected(null);
                }}
              >
                <Sparkles size={17} />
                变成我的穿搭
              </button>
            </div>
          </div>
          <button
            className="inspo-dialog-dismiss"
            aria-label="关闭详情"
            onClick={() => setSelected(null)}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
