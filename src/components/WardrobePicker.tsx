import { useState, type ReactNode } from 'react';
import { Button } from '@lenso/ui/button';
import { SegmentedControl } from '@lenso/ui/segmented-control';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, Check, Plus, Search } from 'lucide-react';
import { slotNames, type Garment, type Outfit, type Slot } from '../data';
import { outfitSlots } from './TodayHome';

type Props = { outfit: Outfit; items: Garment[]; initialSlot: Slot; mode: 'single' | 'outfit'; renderItem: (g:Garment) => ReactNode; onApply:(outfit:Outfit)=>void; onAdd:()=>void };
const nativeStyles = stylex.create({ categories: { width: '100%', minHeight: 38 }, apply: { width: '100%', minHeight: 48, borderRadius: 999, fontSize: 15, fontWeight: 600, gap: 12 } });
export default function WardrobePicker(p: Props) {
  const [draft,setDraft]=useState<Outfit>({...p.outfit});
  const [slot,setSlot]=useState<Slot>(p.initialSlot);
  const [query,setQuery]=useState('');
  const available=p.items.filter(g=>g.owned&&g.category===slotNames[slot]&&`${g.name}${g.color}`.includes(query));
  const selected=outfitSlots.map(s=>({slot:s,item:p.items.find(g=>g.id===draft[s])}));
  const pick=(id:string)=>{const next={...draft,[slot]:id};setDraft(next);if(p.mode==='single')p.onApply(next)};
  return <div className={`wardrobe-picker picker-${p.mode}`}>
    <p className="picker-intro">{p.mode==='single'?'选一件喜欢的，直接换到今日搭配里。':'挑一套自己的衣服，选好后回首页看看。'}</p>
    {p.mode==='outfit'&&<div className="picker-selection" aria-label="当前组合">{selected.map(({slot:s,item})=><button key={s} className={s===slot?'active':''} onClick={()=>{setSlot(s);setQuery('')}} aria-label={`选择${slotNames[s]}分类`} aria-pressed={slot===s}><span>{item&&p.renderItem(item)}</span><small>{slotNames[s]}</small>{item&&!item.owned&&<i>待购</i>}</button>)}</div>}
    <div className="picker-categories"><SegmentedControl aria-label="衣橱分类" items={outfitSlots.map(value=>({value,label:slotNames[value]}))} value={slot} onValueChange={value=>{if(value){setSlot(value as Slot);setQuery('')}}} xstyle={nativeStyles.categories} lift={3}/></div>
    <div className="search-field picker-search"><Search size={17}/><input aria-label="搜索选衣单品" placeholder="搜索衣服或颜色" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清除搜索" onClick={()=>setQuery('')}>清除</button>}</div>
    <div className="picker-section-title"><h3>我的{slotNames[slot]}</h3><span>{available.length} 件</span></div>
    <div className="picker-grid">{available.map(g=><button key={g.id} className={draft[slot]===g.id?'selected':''} aria-pressed={draft[slot]===g.id} aria-label={`今日选衣：${g.name}`} onClick={()=>pick(g.id)}><div className="picker-item-image">{p.renderItem(g)}<i>{draft[slot]===g.id?<Check size={15}/>:<Plus size={15}/>}</i></div><span>{g.name}</span><small>{g.color}{draft[slot]===g.id?' · 当前搭配':''}</small></button>)}</div>
    {!available.length&&<div className="picker-empty"><p>{query?'没找到这件衣服，换个关键词试试。':'这个分类还没有衣服。'}</p><button onClick={query?()=>setQuery(''):p.onAdd}>{query?'清除搜索':'添加一件衣服'}</button></div>}
    {p.mode==='outfit'?<div className="picker-footer"><Button variant="prominent" xstyle={nativeStyles.apply} onClick={()=>p.onApply(draft)}>用这套搭配<ArrowRight size={17}/></Button></div>:<div className="picker-single-note">其他单品和排版会保持原样</div>}
  </div>;
}
