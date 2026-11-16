import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Expand, Grid2X2, ImagePlus, Layers, Pin, PinOff, Plus, RotateCcw, Shuffle, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { slotNames, type Garment, type Outfit, type Slot } from '../data';

export type CanvasLayout = Record<Slot, { x: number; y: number; width: number; rotation: number }>;
type Props = {
  initialMode?: 'dress'|'canvas'|'boards'; onHome:()=>void;
  outfit: Outfit; items: Garment[]; locked: Slot[]; favorites: string[];
  renderItem: (item: Garment, className?: string) => ReactNode;
  onChange: (id: string, slot: Slot) => void;
  onToggleLock: (slot: Slot) => void;
  onPickSlot: (slot: Slot) => void;
  layout?: CanvasLayout; onLayoutChange: (layout: CanvasLayout) => void;
  onShuffle: () => void; onSave: (layout: CanvasLayout) => void; onTryOn: () => void;
  onBrowse: () => void; onSaved: () => void;
};
const mainSlots: Slot[] = ['coat', 'bottom', 'shoes'];
const categoryFor: Record<Slot, string> = { coat: '外套', top: '上装', bottom: '下装', shoes: '鞋履', bag: '配饰' };
const initialPositions: Record<Slot, { x: number; y: number; width: number; rotation: number }> = {
  coat: { x: 28, y: 33, width: 47, rotation: -8 },
  top: { x: 73, y: 23, width: 38, rotation: 7 },
  bottom: { x: 69, y: 62, width: 40, rotation: -3 },
  shoes: { x: 29, y: 82, width: 40, rotation: 4 },
  bag: { x: 29, y: 64, width: 28, rotation: -9 },
};

function ClothesRail({ slot, choices, selected, locked, renderItem, onChange, onToggleLock }: {
  slot: Slot; choices: Garment[]; selected: Garment; locked: boolean;
  renderItem: Props['renderItem']; onChange: Props['onChange']; onToggleLock: Props['onToggleLock'];
}) {
  const rail = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const interacting = useRef(false);
  const mounted = useRef(false);
  const mouseDrag=useRef<{x:number;left:number}|null>(null);
  const moved=useRef(false);
  const options = choices.some(x => x.id === selected.id) ? choices : [selected, ...choices];
  const index = Math.max(0, options.findIndex(x => x.id === selected.id));
  const loops=options.length>1?[...options,...options,...options]:options;
  const offset=options.length>1?options.length:0;
  useEffect(() => {
    if (!interacting.current) rail.current?.scrollTo({ left: (offset + index) * 116, behavior: mounted.current?'smooth':'instant' });
    mounted.current=true;
  }, [index, options.length]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!rail.current || locked || !interacting.current || mouseDrag.current) return;
      const next = Math.round(rail.current.scrollLeft / 116) % options.length;
      interacting.current = false;
      if (options[next]?.id !== selected.id) onChange(options[next].id, slot);
      else rail.current.scrollTo({left:(offset+next)*116,behavior:'instant'});
    }, 130);
  };
  const step = (direction: number) => {
    if (locked || options.length < 2) return;
    const next = (index + direction + options.length) % options.length;
    onChange(options[next].id, slot);
  };
  return <section className={`clothes-row ${locked ? 'is-pinned' : ''}`} aria-label={`${slotNames[slot]}滑动选择`}>
    <div className="clothes-row-label"><span>{slotNames[slot]}</span><button className={locked ? 'pin-control active' : 'pin-control'} onClick={() => onToggleLock(slot)} aria-label={`${locked ? '取消固定' : '固定'}${slotNames[slot]}`} aria-pressed={locked}>{locked ? <Pin size={15} fill="currentColor"/> : <PinOff size={15}/>}<span>{locked ? '已固定' : '固定'}</span></button></div>
    <div className="rail-wrap">
      <button className="rail-arrow prev" aria-label={`上一件${slotNames[slot]}`} disabled={locked || options.length < 2} onClick={() => step(-1)}><ChevronLeft size={17}/></button>
      <div ref={rail} className={`clothes-rail ${locked ? 'rail-locked' : ''}`} onScroll={settle} onWheel={()=>{interacting.current=!locked}} onPointerDown={e => { interacting.current = !locked; moved.current=false; if(!locked&&e.pointerType==='mouse'&&rail.current)mouseDrag.current={x:e.clientX,left:rail.current.scrollLeft}; }} onPointerMove={e=>{const start=mouseDrag.current;if(!start||!rail.current)return;const delta=e.clientX-start.x;if(Math.abs(delta)>5){moved.current=true;e.currentTarget.setPointerCapture(e.pointerId);rail.current.scrollLeft=start.left-delta;interacting.current=true;}}} onPointerUp={()=>{mouseDrag.current=null;settle()}} onPointerCancel={()=>{mouseDrag.current=null;settle()}} onTouchStart={() => { interacting.current = !locked; }}>
        {loops.map((g,i) => <button key={`${g.id}-${i}`} aria-hidden={options.length>1&&(i<offset||i>=offset+options.length)?true:undefined} tabIndex={options.length>1&&(i<offset||i>=offset+options.length)?-1:0} className={`rail-item ${selected.id === g.id ? 'current' : ''}`} aria-label={`选择${g.name}`} aria-pressed={selected.id === g.id} disabled={locked && selected.id !== g.id} onClick={() => { if (!locked&&!moved.current) { interacting.current = false; onChange(g.id, slot); } }}>{renderItem(g)}{selected.id === g.id && <span className="selected-item-dot"/>}</button>)}
      </div>
      <button className="rail-arrow next" aria-label={`下一件${slotNames[slot]}`} disabled={locked || options.length < 2} onClick={() => step(1)}><ChevronRight size={17}/></button>
    </div>
    <div className="rail-item-caption"><span>{selected.name}</span><small className={selected.owned ? 'source-owned' : 'source-new'}>{selected.owned ? '衣橱' : `待购 ¥${selected.price}`}</small></div>
  </section>;
}

export default function StyleStudio(p: Props) {
  const [mode, setMode] = useState<'dress' | 'canvas' | 'boards'>(p.initialMode||'dress');
  const [source, setSource] = useState('全部单品');
  const [focusSlot, setFocusSlot] = useState<Slot>('coat');
  const [positions, setPositions] = useState(p.layout ?? initialPositions);
  useEffect(()=>{p.onLayoutChange(positions)},[positions]);
  const [canvasHelp, setCanvasHelp] = useState(true);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ slot: Slot; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const getItem = (id: string) => p.items.find(x => x.id === id) ?? p.items[0];
  const newItems = Object.values(p.outfit).map(getItem).filter(x => !x.owned);
  const beginDrag = (e: PointerEvent<HTMLDivElement>, slot: Slot) => {
    if (p.locked.includes(slot) || (e.target as HTMLElement).closest('.canvas-pin')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusSlot(slot);
    drag.current = { slot, startX: e.clientX, startY: e.clientY, x: positions[slot].x, y: positions[slot].y, moved: false };
    justDragged.current = false;
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, bounds = canvas.current?.getBoundingClientRect();
    if (!d || !bounds) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) < 5) return;
    d.moved = true;
    setPositions(old => ({ ...old, [d.slot]: { ...old[d.slot], x: Math.max(15, Math.min(85, d.x + dx / bounds.width * 100)), y: Math.max(13, Math.min(87, d.y + dy / bounds.height * 100)) } }));
  };
  const finishDrag = () => { justDragged.current = !!drag.current?.moved; drag.current = null; };
  const candidates = (slot: Slot) => p.items.filter(g => g.category === categoryFor[slot] && (source === '全部单品' || source === '我的衣橱' && g.owned || source === '我的收藏' && p.favorites.includes(g.id)));
  const shuffleRows = () => { for (const slot of mainSlots) { if (p.locked.includes(slot)) continue; const options = candidates(slot); if(options.length>1) { const i=options.findIndex(g=>g.id===p.outfit[slot]); p.onChange(options[(i+1)%options.length].id,slot); } } };
  const switchSource = (value: string) => {
    setSource(value);
    for (const slot of mainSlots) {
      if (p.locked.includes(slot)) continue;
      const options = p.items.filter(g => g.category === categoryFor[slot] && (value === '全部单品' || value === '我的衣橱' && g.owned || value === '我的收藏' && p.favorites.includes(g.id)));
      if (options.length && !options.some(x => x.id === p.outfit[slot])) p.onChange(options[0].id, slot);
    }
  };
  return <div className="styling-studio">
    <header className="studio-header"><button className="studio-icon" aria-label="回到今日搭配" onClick={p.onHome}><ArrowLeft size={21}/></button><div><h1>调整搭配</h1><span>完成后回到今日搭配</span></div><button className="lime-save" onClick={()=>p.onSave(positions)}>完成<Check size={15}/></button></header>
    <div className="studio-tabs" role="tablist" aria-label="搭配方式">{([{ id: 'dress', label: '滑动搭配' }, { id: 'canvas', label: '自由画布' }, { id: 'boards', label: '灵感板' }] as const).map(x => <button key={x.id} role="tab" aria-selected={mode === x.id} className={mode === x.id ? 'active' : ''} onClick={() => setMode(x.id)}>{x.label}</button>)}</div>
    {mode === 'dress' && <>
      <div className="studio-filter"><SlidersHorizontal size={16}/><div>{['全部单品', '我的衣橱', '我的收藏'].map(x => <button className={source === x ? 'active' : ''} key={x} onClick={() => switchSource(x)}>{x}</button>)}</div></div>
      <div className="clothes-rows">{mainSlots.map(slot => <ClothesRail key={slot} slot={slot} choices={candidates(slot)} selected={getItem(p.outfit[slot])} locked={p.locked.includes(slot)} renderItem={p.renderItem} onChange={p.onChange} onToggleLock={p.onToggleLock}/>)}</div>
      <div className="small-pieces">{(['top', 'bag'] as Slot[]).map(slot => <button key={slot} onClick={() => p.onPickSlot(slot)}>{p.renderItem(getItem(p.outfit[slot]))}<span>{slot === 'top' ? '内搭' : '配饰'}</span><Plus size={13}/></button>)}<button className="shuffle-control" disabled={mainSlots.every(s=>p.locked.includes(s))} onClick={shuffleRows}><Shuffle size={18}/><span>换个组合</span></button></div>
      <p className="swipe-hint">左右滑动挑选 · 固定喜欢的，继续换其他</p>
    </>}
    {mode === 'canvas' && <>
      <div className="canvas-toolbar"><span><Expand size={14}/>拖动衣服，自由摆放</span><button onClick={() => setPositions(initialPositions)}><RotateCcw size={14}/>整理画布</button></div>
      <div className="interactive-canvas" ref={canvas}>
        {(['coat', 'top', 'bottom', 'shoes', 'bag'] as Slot[]).map(slot => {
          const pos = positions[slot], pinned = p.locked.includes(slot);
          return <div key={slot} className={`canvas-garment ${focusSlot === slot ? 'canvas-focused' : ''}`} style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.width}%`, transform: `translate(-50%, -50%) rotate(${pos.rotation}deg)`, zIndex: focusSlot === slot ? 6 : slot === 'bag' ? 5 : 2 }} onPointerDown={e => beginDrag(e, slot)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onClick={e=>{if((e.target as HTMLElement).closest('.canvas-pin'))return;if(!justDragged.current){setFocusSlot(slot);p.onPickSlot(slot);}justDragged.current=false;}}>
            <button className="canvas-image" aria-label={`画布选择${slotNames[slot]}`} >{p.renderItem(getItem(p.outfit[slot]))}</button>
            <button className={`canvas-pin ${pinned ? 'pinned' : ''}`} aria-label={`画布${pinned ? '取消固定' : '固定'}${slotNames[slot]}`} onClick={() => p.onToggleLock(slot)}><Pin size={13} fill={pinned ? 'currentColor' : 'none'}/></button>
          </div>;
        })}
        <span className="canvas-signature">made by you.</span>
      </div>
      {canvasHelp && <div className="canvas-tip">拖动调整位置，轻点替换单品。<button aria-label="关闭画布提示" onClick={() => setCanvasHelp(false)}><X size={14}/></button></div>}
    </>}
    {mode === 'boards' && <div className="studio-moodboard"><span className="eyebrow">YOUR NEXT DIRECTION</span><h2>先收集喜欢，<br/>再试成自己的样子。</h2><div className="mood-pictures"><img src="/images/editorial.jpg" alt="都市轮廓灵感"/><img src="/images/city.jpg" alt="复古穿搭灵感"/></div><button onClick={p.onBrowse}><ImagePlus size={18}/>寻找下一件灵感<ChevronRight size={16}/></button><p>收藏的风格与单品会保留在「我的」。</p></div>}
    <footer className="studio-footer"><div className="outfit-origin"><span>{newItems.length ? `${newItems.length} 件待购单品` : '这一套，衣橱里就有'}</span><strong>{newItems.length ? `新增 ¥${newItems.reduce((sum, x) => sum + x.price, 0)}` : '无需补购'}</strong></div><div><button className="browse-outfit" onClick={p.onBrowse}><Plus size={16}/>找搭配单品</button><button className="try-outfit" onClick={p.onTryOn}><Sparkles size={17}/>看看上身<ChevronRight size={15}/></button></div></footer>
  </div>;
}
