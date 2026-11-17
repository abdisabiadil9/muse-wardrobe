import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  ChevronRight,
  Heart,
  Layers,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  type ApiSlots,
  type MediaAsset,
  type Scene,
  type Layout,
} from '../api/client';
import { styles, slotNames, type Garment, type Slot } from '../data';
import { sceneLabels, slots } from '../api/viewModels';
import './style-content.css';

export type LookCard = {
  id: string;
  title: string;
  scene: Scene;
  slots: ApiSlots;
  reason: string;
  kind: 'proposal' | 'generated' | 'saved';
  layout?: Layout;
  image?: MediaAsset;
  taskId?: string;
  sourceTaskId?: string;
  createdAt?: string;
};
export const sameLook = (a: ApiSlots, b: ApiSlots) =>
  slots.every(
    (s) => a[s]?.ref_id === b[s]?.ref_id && a[s]?.asset_id === b[s]?.asset_id,
  );
type RenderItem = (g: Garment, className?: string) => ReactNode;
export function LookCollage({
  look,
  items,
  renderItem,
}: {
  look: LookCard;
  items: Garment[];
  renderItem: RenderItem;
}) {
  const pieces = slots.flatMap((slot) => {
    const item = items.find((g) => g.id === look.slots[slot]?.ref_id);
    return item ? [{ slot, item }] : [];
  });
  const hasLayout =
    pieces.length > 0 && pieces.every(({ slot }) => look.layout?.[slot]);
  return (
    <div
      className={`content-collage${hasLayout ? ' has-layout' : ''}`}
      data-piece-count={pieces.length}
    >
      {pieces.map(({ slot, item }) => (
        <div
          className={`content-piece content-${slot}`}
          key={slot}
          style={
            hasLayout && look.layout?.[slot]
              ? {
                  left: `${look.layout[slot].x}%`,
                  top: `${look.layout[slot].y}%`,
                  right: 'auto',
                  bottom: 'auto',
                  width: `${look.layout[slot].width}%`,
                  transform: `translate(-50%,-50%) rotate(${look.layout[slot].rotation}deg)`,
                }
              : undefined
          }
        >
          {renderItem(item)}
        </div>
      ))}
      {!pieces.length && <Layers size={26} />}
    </div>
  );
}
function LookVisual({
  look,
  items,
  renderItem,
  detail = false,
}: {
  look: LookCard;
  items: Garment[];
  renderItem: RenderItem;
  detail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [look.image?.download_url]);
  if (look.image?.status === 'ready' && look.image.download_url && !failed)
    return (
      <img
        className={detail ? 'detail-generated-image' : 'content-look-photo'}
        src={look.image.download_url}
        alt={`${look.title} · AI 上身预览`}
        onError={() => setFailed(true)}
      />
    );
  return (
    <>
      <LookCollage look={look} items={items} renderItem={renderItem} />
      {(look.kind === 'generated' || failed) && (
        <p className="content-image-unavailable">
          上身图暂不可用 · 查看衣橱搭配
        </p>
      )}
    </>
  );
}
export function LookGrid({
  looks,
  items,
  renderItem,
  onOpen,
}: {
  looks: LookCard[];
  items: Garment[];
  renderItem: RenderItem;
  onOpen: (look: LookCard) => void;
}) {
  return (
    <div className="look-content-grid">
      {looks.map((look) => (
        <button
          className="content-look-card"
          key={look.id}
          onClick={() => onOpen(look)}
        >
          <LookVisual look={look} items={items} renderItem={renderItem} />
          <span className="content-card-tag">
            {look.kind === 'generated'
              ? 'AI 上身预览'
              : look.kind === 'proposal'
                ? look.image?.download_url
                  ? 'AI 搭配 · 上身预览'
                  : 'Lumi 搭配 · 衣橱精选'
                : '我的搭配'}
          </span>
          <strong>{look.title}</strong>
          <small>
            {sceneLabels[look.scene]}
            <ArrowUpRight size={13} />
          </small>
        </button>
      ))}
    </div>
  );
}
export function InspirationPage({
  favorites,
  onFavorite,
  onUse,
  initialFilter = '全部',
}: {
  initialFilter?: string;
  favorites: string[];
  onFavorite: (id: string) => void;
  onUse: (text: string) => void;
}) {
  const [filter, setFilter] = useState(initialFilter),
    [selected, setSelected] = useState<string | null>(null);
  const style = styles.find((s) => s.id === selected);
  if (style)
    return (
      <div className="content-page inspiration-detail">
        <button className="content-back" onClick={() => setSelected(null)}>
          <ArrowLeft size={20} />
          灵感
        </button>
        <div className="inspiration-cover">
          <img src={style.image} alt={`${style.name}编辑风格参考`} />
          <span>编辑精选 · 风格参考</span>
          <button
            aria-label={
              favorites.includes(style.id) ? '取消收藏灵感' : '收藏灵感'
            }
            onClick={() => onFavorite(style.id)}
          >
            <Heart
              size={21}
              fill={favorites.includes(style.id) ? 'currentColor' : 'none'}
            />
          </button>
        </div>
        <p className="content-eyebrow">{style.en}</p>
        <h1>{style.name}</h1>
        <p className="content-description">{style.description}</p>
        <div className="content-tags">
          {style.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="content-note">
          这是一份编辑风格参考。AI 会结合你自己的衣橱寻找类似感觉。
        </div>
        <button
          className="content-primary"
          onClick={() =>
            onUse(
              `参考「${style.name}」的${style.tags.join('、')}，从我的衣橱搭一套。${style.description}`,
            )
          }
        >
          <Sparkles size={17} />
          用这个灵感搭配
        </button>
      </div>
    );
  const list = styles.filter(
    (s) =>
      filter === '全部' ||
      (filter === '已收藏' && favorites.includes(s.id)) ||
      filter === s.name,
  );
  return (
    <div className="content-page">
      <header className="content-heading">
        <p>FIND YOUR NEXT FEELING</p>
        <h1>一点灵感，很多可能。</h1>
        <span>从喜欢的风格，找到自己的穿法。</span>
      </header>
      <div className="content-filters">
        {['全部', ...styles.map((style) => style.name), '已收藏'].map((f) => (
          <button
            key={f}
            className={filter === f ? 'active' : ''}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="inspiration-grid">
        {list.map((s, i) => (
          <article key={s.id}>
            <button
              className="inspiration-image"
              onClick={() => setSelected(s.id)}
            >
              <img src={s.image} alt={`${s.name}编辑风格参考`} />
              <span className="inspiration-number">0{i + 1}</span>
              <div>
                <i>{s.en}</i>
                <strong>
                  {s.name}
                  <ArrowUpRight size={20} />
                </strong>
              </div>
            </button>
            <div className="inspiration-card-footer">
              <span>编辑精选 · 风格参考</span>
              <button
                aria-label={`${favorites.includes(s.id) ? '取消收藏' : '收藏'}${s.name}`}
                aria-pressed={favorites.includes(s.id)}
                onClick={() => onFavorite(s.id)}
              >
                <Heart
                  size={17}
                  fill={favorites.includes(s.id) ? 'currentColor' : 'none'}
                />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <div className="content-empty">
          <Heart size={25} />
          <strong>留住你喜欢的感觉</strong>
          <p>轻点灵感卡上的爱心，就能在这里再找到。</p>
        </div>
      )}
      <div className="content-note">
        图片为编辑风格参考，不代表实时趋势、商品或试穿生成结果。
      </div>
    </div>
  );
}
export function MyStylePage({
  name,
  items,
  looks,
  lookFavorites,
  inspirationFavorites,
  renderItem,
  onOpen,
  onCloset,
  onInspiration,
  children,
}: {
  name: string;
  items: Garment[];
  looks: LookCard[];
  lookFavorites: string[];
  inspirationFavorites: string[];
  renderItem: RenderItem;
  onOpen: (look: LookCard) => void;
  onCloset: () => void;
  onInspiration: () => void;
  children?: ReactNode;
}) {
  const [tab, setTab] = useState('搭配');
  const saved = looks.filter((l) => l.kind === 'saved'),
    generated = looks.filter((l) => l.kind === 'generated'),
    favorites = looks.filter((l) => lookFavorites.includes(l.id));
  const list =
    tab === '搭配' ? saved : tab === '上身图' ? generated : favorites;
  return (
    <div className="content-page">
      <header className="my-style-header">
        <span className="my-style-avatar">
          <UserRound size={27} />
        </span>
        <div>
          <h1>{name}</h1>
          <p>慢慢收集，属于自己的风格。</p>
        </div>
      </header>
      <div className="my-style-stats">
        <button onClick={onCloset}>
          <b>{items.length}</b>
          <span>衣橱单品</span>
        </button>
        <button onClick={() => setTab('搭配')}>
          <b>{saved.length}</b>
          <span>保存搭配</span>
        </button>
        <button onClick={() => setTab('上身图')}>
          <b>{generated.length}</b>
          <span>上身预览</span>
        </button>
      </div>
      <button className="my-inspiration-link" onClick={onInspiration}>
        <Heart size={18} />
        <span>
          收藏的灵感<small>{inspirationFavorites.length} 份风格参考</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <div className="my-content-tabs">
        {['搭配', '上身图', '收藏'].map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {list.length ? (
        <LookGrid
          looks={list}
          items={items}
          renderItem={renderItem}
          onOpen={onOpen}
        />
      ) : (
        <div className="content-empty">
          <Bookmark size={28} />
          <strong>
            {tab === '搭配'
              ? '把喜欢的一套留下来'
              : tab === '上身图'
                ? '记录每一次新的尝试'
                : '让喜欢的搭配有迹可循'}
          </strong>
          <p>
            {tab === '搭配'
              ? '在今日搭配点「就穿这套」，会保存到这里。'
              : tab === '上身图'
                ? '主动生成的上身预览会出现在这里。'
                : '在搭配详情点收藏，就能随时再找到。'}
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
export function LookDetail({
  look,
  items,
  renderItem,
  favorite,
  onFavorite,
  onBack,
  onAdopt,
  onAdjust,
  onTryOn,
  onSource,
  onRetain,
  busy,
  error,
  current,
}: {
  look: LookCard;
  items: Garment[];
  renderItem: RenderItem;
  favorite: boolean;
  onFavorite: () => void;
  onBack: () => void;
  onAdopt: () => void;
  onAdjust: () => void;
  onTryOn: () => void;
  onSource?: () => void;
  onRetain?: () => void;
  busy: boolean;
  error: string;
  current: boolean;
}) {
  return (
    <div className="content-page look-detail">
      <header className="look-detail-header">
        <button aria-label="返回" onClick={onBack}>
          <ArrowLeft size={21} />
        </button>
        <span>
          {look.kind === 'proposal'
            ? 'AI 搭配提案'
            : look.kind === 'generated'
              ? 'AI 上身预览'
              : '已保存搭配'}
        </span>
        <button
          aria-label={favorite ? '取消收藏搭配' : '收藏搭配'}
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          <Heart size={21} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </header>
      <LookVisual look={look} items={items} renderItem={renderItem} detail />
      <p className="content-eyebrow">
        {sceneLabels[look.scene]} ·{' '}
        {look.image?.download_url ? 'AI 生成外观参考' : '衣橱搭配'}
      </p>
      <h1>{look.title}</h1>
      <p className="content-description">{look.reason}</p>
      {look.kind === 'generated' && (
        <p className="content-note">
          图片对应生成时的衣物组合，仅用于外观参考。
        </p>
      )}
      <section className="detail-pieces">
        <h2>这套里的单品</h2>
        {slots
          .filter((s) => look.slots[s])
          .map((slot) => {
            const g = items.find((i) => i.id === look.slots[slot]?.ref_id);
            return (
              <div key={slot}>
                {g ? (
                  <span className="detail-piece-image">{renderItem(g)}</span>
                ) : (
                  <span className="detail-piece-image">
                    <Layers size={20} />
                  </span>
                )}
                <span>
                  <small>{slotNames[slot as Slot]}</small>
                  <strong>{g?.name || '衣物暂不可用'}</strong>
                </span>
              </div>
            );
          })}
      </section>
      {!current && (
        <div className="content-note">
          当前「{sceneLabels[look.scene]}
          」可能已有调整。用这套会替换该场景未固定的单品，请先确认。
        </div>
      )}
      {onRetain && (
        <button className="detail-source" disabled={busy} onClick={onRetain}>
          保存这张上身图
          <Bookmark size={16} />
        </button>
      )}
      {onSource && (
        <button className="detail-source" onClick={onSource}>
          查看原始搭配提案
          <ChevronRight size={16} />
        </button>
      )}
      {error && (
        <p className="live-stale" role="alert">
          {error}
        </p>
      )}
      <div className="detail-actions">
        <button className="content-primary" disabled={busy} onClick={onAdopt}>
          {busy ? '正在处理…' : current ? '已是当前这套 · 保存' : '用这套'}
        </button>
        <button
          className="content-secondary"
          disabled={busy}
          onClick={onAdjust}
        >
          调整这套
        </button>
      </div>
      <button className="detail-tryon" disabled={busy} onClick={onTryOn}>
        <Sparkles size={17} />
        生成上身图
        <ArrowUpRight size={16} />
      </button>
      <p className="detail-footnote">
        生成前可以选择人物照片，并确认本次生成。
      </p>
    </div>
  );
}
