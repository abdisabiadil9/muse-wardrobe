import { useEffect, useRef, useState } from 'react';
import { Button } from '@lenso/ui/button';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CheckCheck,
  ImagePlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
} from 'lucide-react';
import TodayHome from './components/TodayHome';
import WardrobePicker from './components/WardrobePicker';
import ClosetGallery from './components/ClosetGallery';
import StyleStudio, { type CanvasLayout } from './components/StyleStudio';
import { MobileTabBar, WardrobeSheet } from './components/MobileChrome';
import LiveStyling from './components/LiveStyling';
import LiveTryOn from './components/LiveTryOn';
import LiveGarmentImage from './components/LiveGarmentImage';
import {
  ApiError,
  errorMessage,
  newKey,
  type Api,
  type ApiGarment,
  type ApiOutfit,
  type Capabilities,
  type Draft,
  type MediaAsset,
  type Me,
  type OutfitProposal,
  type Scene,
} from './api/client';
import {
  draftBody,
  draftContent,
  draftSlots,
  sceneKey,
  sceneLabels,
  scenes,
  slots,
  toGarment,
  toOutfit,
  toSaved,
  validateProposal,
} from './api/viewModels';
import {
  garments as demoGarments,
  slotNames,
  type Garment,
  type Outfit,
  type Slot,
} from './data';
import './live.css';

type Page = 'today' | 'closet' | 'outfit' | 'tryon' | 'mine' | 'discover';
type Sheet = 'picker' | 'styling' | 'add' | null;
type Saved = ReturnType<typeof toSaved>;
type Props = {
  api: Api;
  me: Me;
  capabilities: Capabilities;
  onDemo: () => void;
};
type PendingGarment = {
  key: string;
  body: {
    name: string;
    category: Slot;
    image_asset_id: string;
    source: 'upload';
  };
};
const localRead = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
const localWrite = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional UI preferences must not prevent cloud access. */
  }
};
const today = () => new Date().toLocaleDateString('en-CA');
const isSame = (a: Draft, b: Draft) => draftContent(a) === draftContent(b);

export default function LiveApp({ api, me, capabilities, onDemo }: Props) {
  const prefix = `muse-live:${me.id}`;
  const [page, setPage] = useState<Page>(() => {
      const value =
        new URLSearchParams(location.search).get('screen') ||
        localRead(`${prefix}:page`, 'today');
      return [
        'today',
        'closet',
        'outfit',
        'tryon',
        'mine',
        'discover',
      ].includes(value)
        ? (value as Page)
        : 'today';
    }),
    [scene, setScene] = useState<Scene>(() => {
      const value = localRead<Scene>(`${prefix}:scene`, 'daily');
      return scenes.includes(value) ? value : 'daily';
    });
  const [sheet, setSheet] = useState<Sheet>(null),
    [pickerSlot, setPickerSlot] = useState<Slot>('coat'),
    [pickerMode, setPickerMode] = useState<'single' | 'outfit'>('outfit');
  const [drafts, setDrafts] = useState<Partial<Record<Scene, Draft>>>({}),
    [rawItems, setRawItems] = useState<ApiGarment[]>([]),
    [items, setItems] = useState<Garment[]>([]),
    [saved, setSaved] = useState<Saved[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() =>
    localRead(`${prefix}:favorites`, []),
  );
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [syncError, setSyncError] = useState(''),
    [conflict, setConflict] = useState<Scene | null>(null),
    [toast, setToast] = useState('');
  const [confirmed, setConfirmed] = useState<Record<string, string>>(() =>
    localRead(`${prefix}:confirmed`, {}),
  );
  const [recommendations, setRecommendations] = useState<
    Partial<Record<Scene, Draft>>
  >(() => localRead(`${prefix}:recommendations`, {}));
  const pendingGarmentRef = useRef<PendingGarment | null>(
    localRead(`${prefix}:pending-garment`, null),
  );
  const [hasPendingGarment, setHasPendingGarment] = useState(
    !!pendingGarmentRef.current,
  );
  const [uploadFile, setUploadFile] = useState<File | null>(null),
    [uploadName, setUploadName] = useState(
      pendingGarmentRef.current?.body.name || '',
    ),
    [uploadCategory, setUploadCategory] = useState<Slot>(
      pendingGarmentRef.current?.body.category || 'coat',
    ),
    [uploadPreview, setUploadPreview] = useState(''),
    [uploadBusy, setUploadBusy] = useState(false),
    [uploadError, setUploadError] = useState('');
  const [importBusy, setImportBusy] = useState(false),
    [importMessage, setImportMessage] = useState('');
  const draftsRef = useRef(drafts),
    servers = useRef<Partial<Record<Scene, Draft>>>({}),
    work = useRef<Partial<Record<Scene, Promise<Draft>>>>({}),
    timers = useRef<Partial<Record<Scene, ReturnType<typeof setTimeout>>>>({});
  const conflictRef = useRef<Scene | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scroller = useRef<HTMLDivElement>(null);
  draftsRef.current = drafts;
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };
  const saveLocal = (next: Partial<Record<Scene, Draft>>) => {
    try {
      localStorage.setItem(
        `${prefix}:drafts`,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(next).filter(
              ([key, d]) =>
                d &&
                servers.current[key as Scene] &&
                !isSame(d, servers.current[key as Scene]!),
            ),
          ),
        ),
      );
    } catch {
      setSyncError('本机恢复空间不足，请保持页面打开直到云端保存完成。');
    }
  };
  const setDraft = (next: Draft) => {
    const all = { ...draftsRef.current, [next.scene]: next };
    draftsRef.current = all;
    setDrafts(all);
    saveLocal(all);
  };
  const loadItems = async () => {
    let cursor: string | null = null;
    const all: ApiGarment[] = [];
    do {
      const response: { data: ApiGarment[]; next_cursor: string | null } =
        await api.get<{ data: ApiGarment[]; next_cursor: string | null }>(
          `/garments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
      all.push(...response.data);
      cursor = response.next_cursor;
    } while (cursor);
    const images = await Promise.allSettled(
      all.map((g) => api.get<MediaAsset>(`/media/${g.image_asset_id}`)),
    );
    setRawItems(all);
    setItems(
      all.map((g, i) =>
        toGarment(
          g,
          images[i].status === 'fulfilled'
            ? images[i].value.download_url || ''
            : '',
        ),
      ),
    );
    return all;
  };
  const loadSaved = async () => {
    let cursor: string | null = null;
    const all: ApiOutfit[] = [];
    do {
      const response: { data: ApiOutfit[]; next_cursor: string | null } =
        await api.get<{ data: ApiOutfit[]; next_cursor: string | null }>(
          `/outfits?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
      all.push(...response.data);
      cursor = response.next_cursor;
    } while (cursor);
    setSaved(all.map(toSaved));
  };
  const initialize = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const results = await Promise.all([
        Promise.all(scenes.map((s) => api.get<Draft>(`/outfit-drafts/${s}`))),
        loadItems(),
        loadSaved(),
      ]);
      const fresh = Object.fromEntries(
        results[0].map((d) => [d.scene, d]),
      ) as Record<Scene, Draft>;
      servers.current = fresh;
      const local = localRead<Partial<Record<Scene, Draft>>>(
        `${prefix}:drafts`,
        {},
      );
      const restored = { ...fresh };
      for (const s of scenes) {
        const old = local[s];
        if (old && old.id === fresh[s].id && !isSame(old, fresh[s])) {
          restored[s] = old;
          if (old.revision !== fresh[s].revision) {
            setConflict(s);
            conflictRef.current = s;
            setSyncError(
              '本机有未保存的调整，云端版本也已变化。请选择保留哪一份。',
            );
          }
        }
      }
      draftsRef.current = restored;
      setDrafts(restored);
      for (const s of scenes) {
        if (
          !isSame(restored[s], fresh[s]) &&
          restored[s].revision === fresh[s].revision
        )
          timers.current[s] = setTimeout(() => {
            void flush(s).catch(() => {});
          }, 400);
      }
    } catch (e) {
      setLoadError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void initialize();
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      clearTimeout(toastTimer.current);
    };
  }, [api, me.id]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setSheet(null);
    localWrite(`${prefix}:page`, page);
    const url = new URL(location.href);
    url.searchParams.set('screen', page);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [page, prefix]);
  useEffect(() => {
    localWrite(`${prefix}:scene`, scene);
  }, [prefix, scene]);
  useEffect(() => {
    localWrite(`${prefix}:favorites`, favorites);
  }, [prefix, favorites]);
  useEffect(() => {
    if (!uploadFile) {
      setUploadPreview('');
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setUploadPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);
  const flush = (target: Scene): Promise<Draft> => {
    if (work.current[target]) return work.current[target]!;
    const run = (async () => {
      if (conflictRef.current === target)
        throw new Error('请先处理当前场景的版本冲突。');
      const initial = draftsRef.current[target],
        initialServer = servers.current[target];
      if (!initial || !initialServer)
        throw new Error('搭配还在加载，请稍后再试。');
      let current: Draft = initial,
        server: Draft = initialServer;
      while (!isSame(current, server)) {
        const sent: Draft = { ...current, revision: server.revision };
        try {
          const updated: Draft = await api.patch<Draft>(
            `/outfit-drafts/${target}`,
            draftBody(sent),
          );
          servers.current[target] = updated;
          const latest = draftsRef.current[target]!;
          setDraft(
            isSame(latest, sent)
              ? updated
              : { ...latest, revision: updated.revision },
          );
          server = updated;
          current = draftsRef.current[target]!;
          setSyncError('');
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            servers.current[target] = await api.get<Draft>(
              `/outfit-drafts/${target}`,
            );
            conflictRef.current = target;
            setConflict(target);
          }
          setSyncError(errorMessage(e));
          throw e;
        }
      }
      return server;
    })();
    work.current[target] = run;
    void run.then(
      () => {
        delete work.current[target];
      },
      () => {
        delete work.current[target];
      },
    );
    return run;
  };
  const edit = (update: (d: Draft) => Draft, target: Scene = scene) => {
    const current = draftsRef.current[target];
    if (!current) return;
    setDraft(update(current));
    clearTimeout(timers.current[target]);
    timers.current[target] = setTimeout(() => {
      void flush(target).catch(() => {});
    }, 400);
  };
  const changeScene = (name: string) => {
    const next = sceneKey(name);
    void flush(scene).catch(() => {});
    setScene(next);
  };
  const pick = (slot?: Slot) => {
    setPickerSlot(slot || 'coat');
    setPickerMode(slot ? 'single' : 'outfit');
    setSheet('picker');
  };
  const updateOutfit = (outfit: Outfit) =>
    edit((d) => ({ ...d, slots: draftSlots(outfit, rawItems, d.slots) }));
  const toggleFavorite = (id: string) =>
    setFavorites((old) =>
      old.includes(id) ? old.filter((v) => v !== id) : [...old, id],
    );
  const saveOutfit = async () => {
    const d = await flush(scene);
    if (!Object.keys(d.slots).length)
      throw new Error('先选几件衣服，再保存这套搭配。');
    const saveKey = `${prefix}:save:${d.id}:${d.revision}`;
    let key = localStorage.getItem(saveKey);
    if (!key) {
      key = newKey();
      localStorage.setItem(saveKey, key);
    }
    await api.post<ApiOutfit>(
      '/outfits',
      { draft_id: d.id, draft_revision: d.revision },
      key,
    );
    await loadSaved();
    notify('已保存到我的搭配');
  };
  const confirm = async () => {
    try {
      await saveOutfit();
      const d = draftsRef.current[scene]!;
      const next = { ...confirmed, [scene]: `${today()}:${draftContent(d)}` };
      setConfirmed(next);
      localWrite(`${prefix}:confirmed`, next);
    } catch (e) {
      notify(errorMessage(e));
    }
  };
  const applyProposal = async (proposal: OutfitProposal) => {
    const d = await flush(scene);
    const proposed = validateProposal(proposal, d, rawItems);
    try {
      const accepted = await api.patch<Draft>(`/outfit-drafts/${scene}`, {
        expected_revision: d.revision,
        slots: proposed,
        canvas_layout: d.canvas_layout,
      });
      servers.current[scene] = accepted;
      setDraft(accepted);
      const next = { ...recommendations, [scene]: accepted };
      setRecommendations(next);
      localWrite(`${prefix}:recommendations`, next);
      setSheet(null);
      notify('已用这套建议，仍可自由换衣');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        servers.current[scene] = await api.get<Draft>(
          `/outfit-drafts/${scene}`,
        );
        conflictRef.current = scene;
        setConflict(scene);
        setSyncError(
          '云端搭配已更新，当前选择和 AI 建议均已保留。请先处理版本冲突。',
        );
        throw new Error(
          '搭配版本已变化。这份建议没有应用，关闭面板后可处理版本冲突。',
        );
      }
      throw e;
    }
  };
  const restore = () => {
    const rec = recommendations[scene];
    if (!rec) return;
    const valid = Object.values(rec.slots).every((ref) =>
      rawItems.some((g) => g.id === ref?.ref_id),
    );
    if (!valid) {
      notify('推荐中的衣物已不可用，请重新生成建议');
      return;
    }
    edit((d) => ({ ...d, slots: rec.slots, canvas_layout: rec.canvas_layout }));
    notify('已恢复这个场景最近的推荐');
  };
  const resolve = (useCloud: boolean) => {
    const target = conflictRef.current;
    if (!target) return;
    const cloud = servers.current[target]!;
    if (useCloud) setDraft(cloud);
    else setDraft({ ...draftsRef.current[target]!, revision: cloud.revision });
    conflictRef.current = null;
    setConflict(null);
    setSyncError('');
    if (!useCloud) void flush(target).catch(() => {});
  };
  const addPhoto = async () => {
    if ((!uploadFile || !uploadName.trim()) && !pendingGarmentRef.current)
      return;
    setUploadBusy(true);
    setUploadError('');
    try {
      let pending = pendingGarmentRef.current;
      if (!pending) {
        const asset = await api.upload(uploadFile!, 'garment');
        pending = {
          key: newKey(),
          body: {
            name: uploadName.trim(),
            category: uploadCategory,
            image_asset_id: asset.id,
            source: 'upload',
          },
        };
        localStorage.setItem(
          `${prefix}:pending-garment`,
          JSON.stringify(pending),
        );
        pendingGarmentRef.current = pending;
        setHasPendingGarment(true);
      }
      await api.post<ApiGarment>('/garments', pending.body, pending.key);
      localStorage.removeItem(`${prefix}:pending-garment`);
      pendingGarmentRef.current = null;
      setHasPendingGarment(false);
      await loadItems();
      setUploadFile(null);
      setUploadName('');
      setSheet(null);
      notify('已加入你的云端衣橱');
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setUploadBusy(false);
    }
  };
  const localUploads =
    localRead<{ uploads: Garment[] }>('muse-mobile-v1', { uploads: [] })
      .uploads || [];
  const importLocal = async () => {
    setImportBusy(true);
    setImportMessage('');
    let done = 0;
    const failures: string[] = [];
    const mappings = localRead<Record<string, string>>(
      `${prefix}:imported`,
      {},
    );
    const importAssets = localRead<Record<string, string>>(
      `${prefix}:import-assets`,
      {},
    );
    try {
      const backup = localStorage.getItem('muse-mobile-v1');
      if (backup && !localStorage.getItem(`${prefix}:local-backup`))
        localStorage.setItem(`${prefix}:local-backup`, backup);
      for (const g of localUploads) {
        if (mappings[g.id]) continue;
        try {
          let image = g.image;
          if (!image) {
            const source = demoGarments.find(
              (x) =>
                (g.sprite !== undefined && x.sprite === g.sprite) ||
                (g.essential !== undefined && x.essential === g.essential) ||
                (g.statement !== undefined && x.statement === g.statement),
            );
            if (source) image = `/assets/garments/${source.id}.png`;
          }
          if (!image) throw new Error('待补照片');
          let assetId = importAssets[g.id];
          if (!assetId) {
            const response = await fetch(image);
            if (!response.ok) throw new Error('照片不可用');
            const blob = await response.blob();
            const asset = await api.upload(blob, 'garment');
            assetId = asset.id;
            importAssets[g.id] = assetId;
            localStorage.setItem(
              `${prefix}:import-assets`,
              JSON.stringify(importAssets),
            );
          }
          const slot = slots.find((s) => slotNames[s] === g.category) || 'coat';
          const created = await api.post<ApiGarment>(
            '/garments',
            {
              name: g.name,
              category: slot,
              color: g.color,
              material: g.material,
              ...(g.garmentKind
                ? { garment_kind: g.garmentKind }
                : g.name.includes('围巾')
                  ? { garment_kind: 'scarf' }
                  : {}),
              image_asset_id: assetId,
              source: 'upload',
            },
            `import-${me.id}-${g.id}`,
          );
          mappings[g.id] = created.id;
          localStorage.setItem(`${prefix}:imported`, JSON.stringify(mappings));
          done++;
        } catch (e) {
          failures.push(`${g.name}：${errorMessage(e)}`);
        }
      }
      await loadItems();
      setImportMessage(
        `已同步 ${done} 件。本机原记录与备份保留。${failures.length ? ` ${failures.length} 件未完成：${failures.join('；')}` : ''}`,
      );
    } catch (e) {
      setImportMessage(errorMessage(e));
    } finally {
      setImportBusy(false);
    }
  };
  const d = drafts[scene];
  if (loading || !d)
    return (
      <div className="live-connection">
        <h1>你的衣橱</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <Button variant="prominent" onClick={() => void initialize()}>
              重新加载
            </Button>
            {loadError.includes('登录') && (
              <a href="/api/v1/auth/login?return_to=/">重新登录</a>
            )}
          </>
        ) : (
          <>
            <LoaderCircle className="live-spinner" />
            <p>正在读取衣橱与搭配…</p>
          </>
        )}
      </div>
    );
  const outfit = toOutfit(d.slots),
    locked = slots.filter((slot) => d.slots[slot]?.locked),
    layout = Object.keys(d.canvas_layout).length
      ? (d.canvas_layout as CanvasLayout)
      : undefined;
  const currentTab = page === 'outfit' || page === 'tryon' ? 'today' : page;
  const dirty = servers.current[scene] && !isSame(d, servers.current[scene]!);
  const rec = recommendations[scene];
  const customized = !!rec && !isSame(d, rec);
  const renderItem = (g: Garment, className?: string) => (
    <LiveGarmentImage
      item={g}
      assetId={rawItems.find((item) => item.id === g.id)?.image_asset_id}
      api={api}
      className={className}
    />
  );
  const navigate = (next: Page) => {
    void flush(scene).catch(() => {});
    setPage(next);
  };
  const render = () => {
    if (page === 'today')
      return (
        <TodayHome
          live
          outfit={outfit}
          items={items}
          scene={sceneLabels[scene]}
          layout={layout}
          confirmed={confirmed[scene] === `${today()}:${draftContent(d)}`}
          renderItem={renderItem}
          onPick={pick}
          onEdit={() => navigate('outfit')}
          onSave={() => navigate('closet')}
          onConfirm={() => void confirm()}
          onTryOn={() => navigate('tryon')}
          onCloset={() => navigate('closet')}
          onScene={changeScene}
          customized={customized}
          onRestoreScene={restore}
          onInspiration={() => navigate('discover')}
          onAI={() => setSheet('styling')}
          aiStatus={
            capabilities.ai_styling
              ? '由你决定是否采纳 · 不自动改衣'
              : '搭配服务尚未开通'
          }
        />
      );
    if (page === 'closet')
      return (
        <ClosetGallery
          onChoose={() => pick()}
          items={items}
          saved={saved}
          favorites={favorites}
          renderItem={renderItem}
          onOpen={(id) => {
            const g = rawItems.find((x) => x.id === id);
            if (g) {
              pick(g.category);
            }
          }}
          onAdd={() => {
            setUploadError('');
            setSheet('add');
          }}
          onOutfit={(look) => {
            if (!look) {
              pick();
              return;
            }
            const target = sceneKey(look.scene);
            edit(
              (d) => ({
                ...d,
                slots: draftSlots(look.outfit, rawItems, d.slots),
                canvas_layout: look.canvasLayout || {},
              }),
              target,
            );
            setScene(target);
            navigate('today');
          }}
          onFavorite={toggleFavorite}
        />
      );
    if (page === 'outfit')
      return (
        <StyleStudio
          key={scene}
          initialMode="canvas"
          onHome={() => navigate('today')}
          outfit={outfit}
          items={items}
          locked={locked}
          favorites={favorites}
          renderItem={renderItem}
          onChange={(id, slot) =>
            edit((current) => ({
              ...current,
              slots: draftSlots(
                { ...toOutfit(current.slots), [slot]: id },
                rawItems,
                current.slots,
              ),
            }))
          }
          onToggleLock={(slot) =>
            edit((d) =>
              d.slots[slot]
                ? {
                    ...d,
                    slots: {
                      ...d.slots,
                      [slot]: {
                        ...d.slots[slot]!,
                        locked: !d.slots[slot]!.locked,
                      },
                    },
                  }
                : d,
            )
          }
          onPickSlot={(slot) => pick(slot)}
          layout={layout}
          onLayoutChange={(next) =>
            edit((d) => ({ ...d, canvas_layout: next }))
          }
          onShuffle={() => {}}
          onSave={async () => {
            try {
              await saveOutfit();
              navigate('today');
            } catch (e) {
              notify(errorMessage(e));
            }
          }}
          onTryOn={() => navigate('tryon')}
          onBrowse={() => setSheet('styling')}
          onSaved={() => navigate('closet')}
        />
      );
    if (page === 'tryon')
      return (
        <LiveTryOn
          key={scene}
          api={api}
          owner={me.id}
          draft={d}
          items={items}
          enabled={capabilities.image_tryon}
          flush={() => flush(scene)}
          onBack={() => navigate('today')}
          onSaveOutfit={saveOutfit}
        />
      );
    if (page === 'discover')
      return (
        <div className="live-page">
          <h1>寻找一点灵感</h1>
          <p className="lead">先从自己的衣橱出发。</p>
          <div className="live-account-card">
            <Sparkles size={24} />
            <h2>给已有衣服换个搭法</h2>
            <p className="live-muted">
              AI 建议只使用你确认加入的衣物，喜欢后再应用到今日搭配。
            </p>
            <Button
              variant="prominent"
              onClick={() => {
                setPage('today');
                setTimeout(() => setSheet('styling'), 0);
              }}
            >
              试试 AI 搭配
            </Button>
          </div>
          <div className="live-account-card">
            <h2>浏览风格演示</h2>
            <p className="live-muted">
              编辑灵感、商品、价格与购买建议仍是演示内容，不读取或改动你的云端衣橱。
            </p>
            <Button variant="bordered" onClick={onDemo}>
              打开演示内容
            </Button>
          </div>
        </div>
      );
    return (
      <div className="live-page">
        <h1>我的风格日记</h1>
        <p className="lead">{me.display_name}</p>
        <div className="live-account-card">
          <h2>自己的衣服，随时再搭</h2>
          <p>
            {items.length} 件衣物 · {saved.length} 套搭配
          </p>
          <Button variant="bordered" onClick={() => navigate('closet')}>
            查看我的衣橱
          </Button>
        </div>
        <div className="live-account-card">
          <h2>同步本机衣物</h2>
          <p className="live-muted">
            找到 {localUploads.length}{' '}
            件你在演示中添加的衣物。点击后上传到当前账号；原记录与本机备份保留，已有演示搭配不会被覆盖。
          </p>
          <Button
            variant="bordered"
            disabled={!localUploads.length || importBusy}
            onClick={() => void importLocal()}
          >
            {importBusy ? '正在同步…' : '同步我添加的衣物'}
          </Button>
          {importMessage && (
            <p className="live-muted" role="status">
              {importMessage}
            </p>
          )}
        </div>
        <div className="live-account-card">
          <h2>服务状态</h2>
          <p className="live-muted">
            AI 搭配：{capabilities.ai_styling ? '已接入' : '尚未配置'}
            <br />
            图片试穿：{capabilities.image_tryon ? '已接入' : '尚未配置'}
          </p>
          <Button variant="bordered" onClick={onDemo}>
            查看交互演示
          </Button>
        </div>
      </div>
    );
  };
  return (
    <div className="presentation">
      <aside className="demo-pane">
        <a
          className="desktop-wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('today');
          }}
        >
          muse<span>✳</span>
        </a>
        <span className="desktop-label">PERSONAL STYLE, REIMAGINED</span>
        <h1>
          今天穿什么，
          <br />
          <em>从你的衣橱开始。</em>
        </h1>
        <p>
          已有衣物，自由组合。
          <br />
          喜欢 AI 的建议，再用在今天。
        </p>
        <div className="demo-divider" />
        <div className="demo-steps">
          {[
            {
              page: 'today',
              title: '今日搭配',
              detail: '三个场景，保留各自的选择',
            },
            { page: 'closet', title: '我的衣橱', detail: '上传自己的衣物照片' },
            {
              page: 'tryon',
              title: '图片试穿',
              detail: '用人物原图预览当前搭配',
            },
            { page: 'mine', title: '我的记录', detail: '保存喜欢的每一套' },
          ].map((step, i) => (
            <button
              key={step.page}
              className={page === step.page ? 'active' : ''}
              onClick={() => navigate(step.page as Page)}
            >
              <span className="demo-step-number">0{i + 1}</span>
              <div>
                <b>{step.title}</b>
                <small>{step.detail}</small>
              </div>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
        <p className="desktop-footnote">
          云端衣橱 · {me.display_name}
          <br />
          模型只在你主动点击后运行。
        </p>
      </aside>
      <div className="device-area">
        <div className="phone">
          <div className="device-status">
            <span>9:41</span>
            <i />
            <span>
              <span className="signal">▮▮▮</span>
              <span className="battery" />
            </span>
          </div>
          <div ref={scroller} className={`app-content page-${page}`}>
            {(syncError || conflict) && (
              <div className="live-banner live-error" role="alert">
                {syncError}
                {conflict ? (
                  <div>
                    <button onClick={() => resolve(true)}>载入云端版本</button>
                    <button onClick={() => resolve(false)}>
                      保留本机调整并重新保存
                    </button>
                  </div>
                ) : (
                  <button onClick={() => void flush(scene).catch(() => {})}>
                    重试保存
                  </button>
                )}
                {syncError.includes('登录') && (
                  <a href="/api/v1/auth/login?return_to=/">重新登录</a>
                )}
              </div>
            )}
            {dirty && !syncError && (
              <div className="live-banner" role="status">
                调整已保留，正在同步…
              </div>
            )}
            {render()}
          </div>
          <MobileTabBar current={currentTab} onNavigate={(p) => navigate(p)} />
          {toast && (
            <div className="toast" role="status">
              <CheckCheck size={17} />
              <span>{toast}</span>
            </div>
          )}
          <WardrobeSheet
            open={!!sheet}
            title={
              sheet === 'styling'
                ? 'AI 帮我搭'
                : sheet === 'add'
                  ? '添加自己的衣物'
                  : pickerMode === 'single'
                    ? '换件衣服'
                    : '从衣橱选衣'
            }
            onClose={() => setSheet(null)}
          >
            {sheet === 'picker' && (
              <WardrobePicker
                outfit={outfit}
                items={items}
                initialSlot={pickerSlot}
                mode={pickerMode}
                renderItem={renderItem}
                onApply={(value) => {
                  try {
                    updateOutfit(value);
                    setSheet(null);
                    setPage('today');
                  } catch (e) {
                    notify(errorMessage(e));
                  }
                }}
                onAdd={() => setSheet('add')}
              />
            )}
            {sheet === 'styling' && (
              <LiveStyling
                key={scene}
                api={api}
                owner={me.id}
                draft={d}
                items={items}
                enabled={capabilities.ai_styling}
                flush={() => flush(scene)}
                onApply={applyProposal}
                renderItem={renderItem}
              />
            )}
            {sheet === 'add' && (
              <div className="live-form">
                {hasPendingGarment && (
                  <p className="live-stale">
                    有一件衣物添加结果待确认。点击恢复添加将核对同一请求，不会重复添加。
                  </p>
                )}
                <p className="sheet-lead">
                  照片会上传到当前账号的私人衣橱，供搭配和试穿使用。
                </p>
                {uploadPreview ? (
                  <img
                    className="upload-preview"
                    style={{ maxHeight: 240, objectFit: 'contain' }}
                    src={uploadPreview}
                    alt="准备加入衣橱的照片"
                  />
                ) : (
                  <div
                    className="live-photo-empty"
                    style={{ aspectRatio: '2/1' }}
                  >
                    <ImagePlus size={32} />
                    <span>拍摄清楚的单件衣物</span>
                  </div>
                )}
                <label className="live-file-label">
                  {uploadFile ? '更换衣物照片' : '选择衣物照片'}
                  <input
                    type="file"
                    disabled={hasPendingGarment}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setUploadFile(f);
                        setUploadName(f.name.replace(/\.[^.]+$/, ''));
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
                <label>
                  给它一个名字
                  <input
                    className="text-input"
                    disabled={hasPendingGarment}
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <label>
                  放到哪个分类
                  <select
                    className="text-input"
                    disabled={hasPendingGarment}
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value as Slot)}
                  >
                    {slots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slotNames[slot]}
                      </option>
                    ))}
                  </select>
                </label>
                {uploadError && (
                  <p role="alert" className="live-stale">
                    {uploadError}
                  </p>
                )}
                <Button
                  variant="prominent"
                  disabled={
                    uploadBusy ||
                    (!hasPendingGarment && (!uploadFile || !uploadName.trim()))
                  }
                  onClick={() => void addPhoto()}
                  icon={<Plus size={17} />}
                >
                  {uploadBusy
                    ? '正在保存…'
                    : hasPendingGarment
                      ? '恢复上次添加'
                      : '上传并加入我的衣橱'}
                </Button>
              </div>
            )}
          </WardrobeSheet>
        </div>
        <div className="device-caption">
          <span className="caption-dot" />
          MUSE · YOUR WARDROBE<span>EXPLORE. STYLE. REPEAT.</span>
        </div>
      </div>
    </div>
  );
}
