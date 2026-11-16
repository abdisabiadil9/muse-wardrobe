import type { ReactNode } from 'react';
import { Button } from '@lenso/ui/button';
import { SegmentedControl } from '@lenso/ui/segmented-control';
import * as stylex from '@stylexjs/stylex';
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Plus,
  RotateCcw,
  Shirt,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { slotNames, type Garment, type Outfit, type Slot } from '../data';
import type { CanvasLayout } from './StyleStudio';
import { sceneNames, scenePresets, toSceneName } from '../sceneOutfits';

export const outfitSlots: Slot[] = ['coat', 'top', 'bottom', 'shoes', 'bag'];
type Props = {
  outfit: Outfit;
  items: Garment[];
  scene: string;
  confirmed: boolean;
  layout?: CanvasLayout;
  renderItem: (g: Garment, className?: string) => ReactNode;
  onPick: (slot?: Slot) => void;
  onEdit: () => void;
  onSave: () => void;
  onConfirm: () => void;
  onTryOn: () => void;
  onCloset: () => void;
  onScene: (scene: string) => void;
  onInspiration: () => void;
  customized: boolean;
  onRestoreScene: () => void;
  live?: boolean;
  onAI?: () => void;
  aiStatus?: string;
  feed?: ReactNode;
};
const nativeStyles = stylex.create({
  scene: { width: '100%', minHeight: 38 },
  primary: {
    minHeight: 48,
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    flex: 1.4,
    gap: 8,
  },
  secondary: {
    minHeight: 48,
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 550,
    flex: 1,
    gap: 7,
  },
  saved: { width: 40, height: 40, borderRadius: 999, color: '#1c1c1e' },
});
const scenes = sceneNames.map((value) => ({ value, label: value }));

export default function TodayHome(p: Props) {
  const preset = scenePresets[toSceneName(p.scene)];
  const selected = outfitSlots
    .map((slot) => ({
      slot,
      garment: p.items.find((g) => g.id === p.outfit[slot]),
    }))
    .filter((x) => x.garment);
  const owned = selected.filter((x) => x.garment!.owned).length;
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  return (
    <div className="today-home">
      <header className="today-brand">
        <span className="today-wordmark">
          muse<span>.</span>
        </span>
        <Button
          variant="borderless"
          xstyle={nativeStyles.saved}
          isIconOnly
          aria-label="查看已保存搭配"
          onClick={p.onSave}
          icon={<Bookmark size={21} />}
        />
      </header>
      <div className="today-heading">
        <div>
          <p>{date}</p>
          <h1>今日搭配</h1>
        </div>
        <span className="today-status">
          {p.confirmed ? (
            <>
              <Check size={13} />
              已选好
            </>
          ) : (
            '穿出今天的自己'
          )}
        </span>
      </div>
      <div className="today-occasions">
        <SegmentedControl
          aria-label="今天的场景"
          items={scenes}
          value={p.scene}
          onValueChange={(value) => {
            if (value) p.onScene(value);
          }}
          size="lg"
          lift={4}
          xstyle={nativeStyles.scene}
        />
      </div>

      <section className="daily-look" aria-label="今日搭配预览">
        <div className="daily-look-top">
          <span>
            {p.confirmed
              ? '今天，就穿这套'
              : p.live
                ? `${p.scene} · 我的搭配`
                : p.customized
                  ? `${p.scene} · 我的调整`
                  : preset.description}
          </span>
          <button onClick={p.onEdit} aria-label="调整搭配排版">
            <SlidersHorizontal size={16} />
          </button>
        </div>
        <div className="daily-collage">
          {selected.map(({ slot, garment }) => {
            const pos = p.layout?.[slot];
            return (
              <button
                key={slot}
                className={`daily-piece daily-${slot}`}
                style={
                  pos
                    ? {
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        right: 'auto',
                        bottom: 'auto',
                        width: `${pos.width}%`,
                        transform: `translate(-50%,-50%) rotate(${pos.rotation}deg)`,
                      }
                    : undefined
                }
                onClick={() => p.onPick(slot)}
                aria-label={`更换今日${slotNames[slot]}：${garment!.name}`}
              >
                {p.renderItem(garment!)}
                <span className="piece-edit">
                  <Plus size={12} />
                </span>
              </button>
            );
          })}
          {p.live &&
            outfitSlots
              .filter((slot) => !selected.some((x) => x.slot === slot))
              .map((slot) => (
                <button
                  key={slot}
                  className={`daily-piece daily-${slot} live-empty-slot`}
                  onClick={() => p.onPick(slot)}
                  aria-label={`选择${slotNames[slot]}`}
                >
                  <Plus size={20} />
                  <span>{slotNames[slot]}</span>
                </button>
              ))}
        </div>
        <div className="daily-look-caption">
          <div>
            <strong>
              {p.live
                ? selected.length
                  ? '搭成你喜欢的样子。'
                  : '从你的一件衣服开始。'
                : p.customized
                  ? '搭成你喜欢的样子。'
                  : preset.title}
            </strong>
            <span>
              {p.live && !selected.length
                ? '先添加衣物，再自由搭配'
                : owned === selected.length
                  ? `${owned} 件单品 · 全部来自我的衣橱`
                  : `${owned} 件已有 · ${selected.length - owned} 件待购，可替换`}
            </span>
          </div>
          <span className="look-count">
            {selected.length}
            <small>单品</small>
          </span>
        </div>
      </section>

      {p.onAI && (
        <button className="live-ai-entry" onClick={p.onAI}>
          <Sparkles size={19} />
          <div>
            <strong>AI 帮我搭</strong>
            <small>{p.aiStatus || '从已有衣物里，找一点新想法'}</small>
          </div>
          <ChevronRight size={17} />
        </button>
      )}
      <div className="today-actions">
        <Button
          variant="prominent"
          xstyle={nativeStyles.primary}
          onClick={() => p.onPick()}
          icon={<Shirt size={18} />}
        >
          从衣橱选衣
        </Button>
        <Button
          variant="bordered"
          xstyle={nativeStyles.secondary}
          onClick={p.onTryOn}
          icon={<Sparkles size={18} />}
        >
          试穿这套
        </Button>
      </div>
      <div className="today-confirm">
        {p.customized ? (
          <button
            className="scene-restore"
            onClick={p.onRestoreScene}
            aria-label={`恢复${p.scene}场景推荐`}
          >
            <RotateCcw size={13} />
            {p.live ? '恢复最近推荐' : '恢复场景推荐'}
          </button>
        ) : (
          <span>
            {p.confirmed
              ? '今日穿搭已保存'
              : p.live
                ? '自由选衣 · 由你决定'
                : '场景推荐 · 可自由换衣'}
          </span>
        )}
        <button
          onClick={p.onConfirm}
          disabled={p.confirmed || (p.live && !selected.length)}
        >
          {p.confirmed ? (
            <>
              <Check size={15} />
              已记下
            </>
          ) : (
            <>
              就穿这套
              <ChevronRight size={15} />
            </>
          )}
        </button>
      </div>

      <section className="today-pieces-section">
        <div className="today-section-heading">
          <h2>这套里的单品</h2>
          <span>轻点替换</span>
        </div>
        <div className="today-pieces-strip">
          {selected.map(({ slot, garment }) => (
            <button
              key={slot}
              onClick={() => p.onPick(slot)}
              aria-label={`从衣橱替换${slotNames[slot]}`}
            >
              <div>
                {p.renderItem(garment!)}
                <span>
                  <Plus size={11} />
                </span>
              </div>
              <small>{slotNames[slot]}</small>
            </button>
          ))}
        </div>
      </section>
      {p.feed}
      <button className="today-wardrobe-link" onClick={p.onCloset}>
        <span className="wardrobe-link-icon">
          <Shirt size={20} />
        </span>
        <div>
          <b>我的衣橱</b>
          <span>
            {p.items.filter((g) => g.owned).length} 件衣服，还有更多可能
          </span>
        </div>
        <ChevronRight size={18} />
      </button>
      <button className="today-inspiration-link" onClick={p.onInspiration}>
        <span>想换一种感觉？</span>
        <b>
          找点灵感
          <ArrowRight size={14} />
        </b>
      </button>
    </div>
  );
}
