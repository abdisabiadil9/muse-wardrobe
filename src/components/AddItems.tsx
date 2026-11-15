import { useState, type ReactNode } from 'react';
import { Camera, Check, ChevronRight, Database, Globe, ImagePlus, Link, Plus } from 'lucide-react';
import { type Garment, type Category } from '../data';
type Props = { items: Garment[]; renderItem: (item: Garment) => ReactNode; onPhoto: () => void; onAdd: (items: Garment[]) => void };
export default function AddItems(p: Props) {
  const [tab, setTab] = useState('基础款'), [category, setCategory] = useState('全部'), [selected, setSelected] = useState<string[]>([]), [url, setUrl] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const categories = ['全部', '上装', '下装', '鞋履', '配饰'];
  const database = p.items.filter(x => !x.id.startsWith('upload-') && (category === '全部' || x.category === category));
  const add = () => p.onAdd(p.items.filter(x => selected.includes(x.id)).map((x, i) => ({ ...x, id: `upload-basic-${Date.now()}-${i}`, owned: true, reason: '你从基础款图库确认加入的相似衣物。' })));
  const addUrl = () => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
      if (!name.trim()) { setError('给这件衣服起个名字，方便之后找到。'); return; }
      p.onAdd([{ id: `upload-link-${Date.now()}`, name: name.trim(), en: parsed.hostname, category: '外套' as Category, color: '待补充', price: 0, owned: true, image: '', material: '待补充', style: '我的风格', reason: `用户确认加入的衣物链接：${parsed.href}。商品信息尚未自动读取。` }]);
    } catch { setError('请粘贴完整的 http 或 https 商品链接。'); }
  };
  return <div className="add-items-experience"><div className="add-source-tabs" role="tablist" aria-label="添加方式">{[{ name: '相册', Icon: Camera }, { name: '基础款', Icon: Database }, { name: '链接', Icon: Globe }].map(({ name, Icon }) => <button key={name} role="tab" className={tab === name ? 'active' : ''} aria-selected={tab === name} onClick={() => setTab(name)}><Icon size={22}/><span>{name}</span></button>)}</div>
    {tab === '基础款' && <><div className="basic-intro"><h3>先加入你常穿的基础款</h3><p>选择与你已有衣服相似的款式，之后可以换成自己的照片。</p></div><div className="chips">{categories.map(c => <button className={category === c ? 'active' : ''} onClick={() => setCategory(c)} key={c}>{c}</button>)}</div><div className="basic-items-grid">{database.map(g => <button key={g.id} aria-label={`${selected.includes(g.id) ? '取消选择' : '添加基础款'}${g.name}`} aria-pressed={selected.includes(g.id)} className={selected.includes(g.id) ? 'active' : ''} onClick={() => setSelected(old => old.includes(g.id) ? old.filter(x => x !== g.id) : [...old, g.id])}>{p.renderItem(g)}<span>{g.name}</span><i>{selected.includes(g.id) ? <Check size={14}/> : <Plus size={14}/>}</i></button>)}</div><button className="add-items-confirm" disabled={!selected.length} onClick={add}>加入我的衣橱{selected.length ? `（${selected.length}）` : ''}<ChevronRight size={17}/></button></>}
    {tab === '相册' && <div className="photo-add-panel"><ImagePlus size={40}/><h3>把自己的衣服放进来</h3><p>从手机相册选择一张衣物照片。<br/>照片仅保存在本机。</p><button onClick={p.onPhoto}>选择衣物照片<Plus size={17}/></button></div>}
    {tab === '链接' && <div className="link-add-panel"><Link size={28}/><h3>记录已有衣物的商品链接</h3><p>当前用于保存你确认拥有的衣物；商品信息自动读取留待后端接入。</p><label>商品链接<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" type="url"/></label><label>衣物名称<input value={name} onChange={e => setName(e.target.value)} placeholder="例如：我的蓝色外套"/></label>{error && <p className="field-error" role="alert">{error}</p>}<button className="add-items-confirm" disabled={!url.trim()} onClick={addUrl}>确认拥有并加入<Plus size={17}/></button></div>}
  </div>;
}
