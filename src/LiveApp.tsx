import { useCallback, useEffect, useRef, useState } from 'react';
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
import AIConversation from './components/AIConversation';
import { readConversationTaskIndex } from './conversation';
import {
  InspirationPage,
  MyStylePage,
  LookDetail,
  LookGrid,
  sameLook,
  type LookCard,
} from './components/StyleContent';
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
  type Scene,
  type Task,
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
  wireLayout,
} from './api/viewModels';
import {
  garments as demoGarments,
  slotNames,
  type Garment,
  type Outfit,
  type Slot,
} from './data';
import './live.css';

type Page =
  'today' | 'closet' | 'outfit' | 'tryon' | 'mine' | 'discover' | 'ai' | 'look';
type HistoryEntry = { task: Task; scene: Scene; sourceTaskId?: string };
type Sheet = 'picker' | 'add' | null;
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
        'ai',
        'look',
      ].includes(value)
        ? (value as Page)
        : 'today';
    }),
    [scene, setScene] = useState<Scene>(() => {
      const value = localRead<Scene>(`${prefix}:scene`, 'daily');
      return scenes.includes(value) ? value : 'daily';
    });
  const [selectedLook, setSelectedLook] = useState<LookCard | null>(() =>
    localRead(`${prefix}:selected-look`, null),
  );
  const selectedLookRef = useRef(selectedLook);
  selectedLookRef.current = selectedLook;
  const [detailOrigin, setDetailOrigin] = useState<Page>(() =>
    localRead(`${prefix}:detail-origin`, 'today'),
  );
  const [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [inspirationFilter, setInspirationFilter] = useState('全部');
  const [inspirationFavorites, setInspirationFavorites] = useState<string[]>(
    () => localRead(`${prefix}:inspiration-favorites`, []),
  );
  const [lookFavorites, setLookFavorites] = useState<string[]>(() =>
    localRead(`${prefix}:look-favorites`, []),
  );
  const [taskHistory, setTaskHistory] = useState<HistoryEntry[]>(() =>
    localRead(`${prefix}:look-history`, []),
  );
  const [savedSnapshots, setSavedSnapshots] = useState<ApiOutfit[]>([]);
  const [proposalSource, setProposalSource] = useState<{
    taskId: string;
    slots: Draft['slots'];
  } | null>(null);
  const unavailableTaskIds = useRef(new Set<string>());
  const taskHistoryRef = useRef(taskHistory);
  taskHistoryRef.current = taskHistory;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const rememberTask = useCallback(
    (task: Task | null, sourceTaskId?: string, target?: Scene) => {
      if (!task) return;
      setTaskHistory((previous) => {
        const old = previous.find((h) => h.task.id === task.id);
        const context = readConversationTaskIndex(localStorage, me.id).contexts[
          task.id
        ];
        const entry = {
          task,
          scene: context?.scene || old?.scene || target || sceneRef.current,
          sourceTaskId: old?.sourceTaskId || sourceTaskId,
        };
        if (old && JSON.stringify(old) === JSON.stringify(entry))
          return previous;
        const next = [entry, ...previous.filter((h) => h.task.id !== task.id)]
          .sort(
            (a, b) =>
              (Date.parse(b.task.created_at || '') || 0) -
              (Date.parse(a.task.created_at || '') || 0),
          )
          .slice(0, 100);
        localWrite(`${prefix}:look-history`, next);
        return next;
      });
    },
    [prefix],
  );
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
    setSavedSnapshots(all);
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
    const controller = new AbortController();
    let busy = false;
    const forget = (id: string) => {
      unavailableTaskIds.current.add(id);
      setTaskHistory((previous) => {
        const next = previous.filter((h) => h.task.id !== id);
        localWrite(`${prefix}:look-history`, next);
        return next;
      });
      if (selectedLookRef.current?.taskId === id) {
        localWrite(`${prefix}:selected-look`, null);
        setSelectedLook(null);
        setPage((p) => (p === 'look' ? 'mine' : p));
      }
    };
    const refresh = async (force = false) => {
      if (
        busy ||
        controller.signal.aborted ||
        document.visibilityState === 'hidden'
      )
        return;
      busy = true;
      const known = taskHistoryRef.current;
      const ids = new Map<
        string,
        { scene: Scene; sourceTaskId?: string; type?: string }
      >();
      for (const h of known) {
        const handled =
          (page === 'ai' && h.task.type === 'styling') ||
          (page === 'tryon' && h.task.type === 'tryon' && h.scene === scene);
        if (
          !unavailableTaskIds.current.has(h.task.id) &&
          !handled &&
          (force ||
            ['queued', 'running', 'waiting_tools'].includes(h.task.status))
        )
          ids.set(h.task.id, {
            scene: h.scene,
            sourceTaskId: h.sourceTaskId,
            type: h.task.type,
          });
      }
      const conversation = readConversationTaskIndex(localStorage, me.id);
      if (page !== 'ai')
        for (const id of conversation.ids || [])
          if (
            !unavailableTaskIds.current.has(id) &&
            !known.some((h) => h.task.id === id)
          )
            ids.set(id, {
              scene: conversation.contexts?.[id]?.scene || sceneRef.current,
              type: 'styling',
            });
      for (const target of scenes)
        for (const kind of ['styling', 'tryon']) {
          if (
            (page === 'ai' && kind === 'styling') ||
            (page === 'tryon' && kind === 'tryon' && target === scene)
          )
            continue;
          const old = localRead<{
            taskId?: string;
            context?: { sourceTaskId?: string };
          }>(`${prefix}:task:${kind}:${target}`, {});
          if (
            old.taskId &&
            !unavailableTaskIds.current.has(old.taskId) &&
            !known.some((h) => h.task.id === old.taskId)
          )
            ids.set(old.taskId, {
              scene: target,
              sourceTaskId: old.context?.sourceTaskId,
              type: kind,
            });
        }
      await Promise.allSettled(
        [...ids].map(async ([id, context]) => {
          try {
            const task = await api.get<Task>(
              `/tasks/${encodeURIComponent(id)}`,
              controller.signal,
            );
            if (!controller.signal.aborted)
              rememberTask(task, context.sourceTaskId, context.scene);
          } catch (e) {
            if (
              !controller.signal.aborted &&
              e instanceof ApiError &&
              [403, 404, 410].includes(e.status)
            )
              forget(id);
          }
        }),
      );
      busy = false;
    };
    void refresh(true);
    const timer = setInterval(() => void refresh(), 4000);
    const foreground = () => void refresh(true);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', foreground);
    };
  }, [api, prefix, page, scene, rememberTask]);
  useEffect(() => {
    void initialize();
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      clearTimeout(toastTimer.current);
    };
  }, [api, me.id]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, behavior: 'instant' });
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
    setProposalSource(null);
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
  const currentTab =
    page === 'look'
      ? detailOrigin
      : page === 'outfit' || page === 'tryon'
        ? 'today'
        : page;
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
  const looks: LookCard[] = [
    ...taskHistory.flatMap<LookCard>(
      ({ task, scene: target, sourceTaskId }) => {
        if (task.status !== 'succeeded' || !task.result) return [];
        const result = task.result;
        if (
          result.kind === 'tryon_result' &&
          ['deleting', 'deleted'].includes(result.result_asset.status)
        )
          return [];
        if (result.kind === 'outfit_proposal') {
          const preview = taskHistory.find(
            (h) =>
              h.task.status === 'succeeded' &&
              h.task.result?.kind === 'tryon_result' &&
              h.task.result.mode === 'outfit' &&
              sameLook(h.task.result.slots, result.slots),
          );
          const image =
            preview?.task.result?.kind === 'tryon_result'
              ? preview.task.result.result_asset
              : undefined;
          return [
            {
              id: task.id,
              taskId: task.id,
              title: `${sceneLabels[target]}的新想法`,
              scene: target,
              slots: result.slots,
              reason: result.reason,
              kind: 'proposal' as const,
              image,
              createdAt: task.created_at,
            },
          ];
        }
        return [
          {
            id: task.id,
            taskId: task.id,
            sourceTaskId,
            title: `${sceneLabels[target]} · ${result.mode === 'single' ? '单件' : '整套'}预览`,
            scene: target,
            slots: result.slots,
            reason:
              result.mode === 'single'
                ? '只替换生成时所选的单件；其他穿着来自人物原图。'
                : '由人物原图和这套衣物生成的 AI 外观预览。',
            kind: 'generated' as const,
            image: result.result_asset,
            createdAt: task.created_at,
          },
        ];
      },
    ),
    ...savedSnapshots.map((o) => ({
      id: o.id,
      title: `${sceneLabels[o.snapshot.scene]} · 我的搭配`,
      scene: o.snapshot.scene,
      slots: o.snapshot.slots,
      layout: o.snapshot.canvas_layout,
      reason: '你保存下来的衣橱组合，随时可以再穿。',
      kind: 'saved' as const,
      createdAt: o.created_at,
    })),
  ];
  const openLook = (look: LookCard) => {
    look = looks.find((l) => l.id === look.id) || look;
    const origin = page === 'look' ? detailOrigin : page;
    setDetailOrigin(origin);
    localWrite(`${prefix}:detail-origin`, origin);
    localWrite(`${prefix}:selected-look`, look);
    setSelectedLook(look);
    setDetailError('');
    navigate('look');
  };
  const applyLook = async (look: LookCard) => {
    const target = look.scene;
    const current = await flush(target);
    const valid = validateProposal(
      {
        kind: 'outfit_proposal',
        task_id: look.taskId || look.id,
        proposal_id: look.id,
        draft_revision: current.revision,
        garment_ids: [],
        slots: look.slots,
        reason: look.reason,
        owned_count: 0,
        new_cost_fen: 0,
      },
      current,
      rawItems,
    );
    const accepted =
      sameLook(current.slots, valid) &&
      (!look.layout ||
        JSON.stringify(look.layout) === JSON.stringify(current.canvas_layout))
        ? current
        : await api.patch<Draft>(`/outfit-drafts/${target}`, {
            expected_revision: current.revision,
            slots: Object.fromEntries(
              Object.entries(valid).map(([slot, ref]) => [
                slot,
                {
                  ...ref,
                  locked: current.slots[slot as Slot]?.locked || false,
                },
              ]),
            ),
            canvas_layout: wireLayout(look.layout ?? current.canvas_layout),
          });
    servers.current[target] = accepted;
    setDraft(accepted);
    setScene(target);
    if (look.kind === 'proposal') {
      const next = { ...recommendations, [target]: accepted };
      setRecommendations(next);
      localWrite(`${prefix}:recommendations`, next);
    }
    setProposalSource(
      look.kind === 'proposal' && look.taskId
        ? { taskId: look.taskId, slots: look.slots }
        : look.sourceTaskId
          ? { taskId: look.sourceTaskId, slots: look.slots }
          : null,
    );
    return accepted;
  };
  const detailAction = async (action: 'adopt' | 'adjust' | 'tryon') => {
    if (!selectedLook) return;
    setDetailBusy(true);
    setDetailError('');
    try {
      const accepted = await applyLook(selectedLook);
      if (action === 'adopt') {
        await api.post<ApiOutfit>(
          '/outfits',
          { draft_id: accepted.id, draft_revision: accepted.revision },
          `look-${me.id}-${selectedLook.id}-${accepted.revision}`,
        );
        await loadSaved();
        notify('已用这套，并保存到我的搭配');
        navigate('today');
      } else navigate(action === 'adjust' ? 'outfit' : 'tryon');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const target = selectedLook.scene;
        servers.current[target] = await api.get<Draft>(
          `/outfit-drafts/${target}`,
        );
        conflictRef.current = target;
        setConflict(target);
        setScene(target);
        setSyncError(
          '云端版本已变化。当前调整和这份搭配都已保留，请先处理版本冲突。',
        );
      }
      setDetailError(errorMessage(e));
    } finally {
      setDetailBusy(false);
    }
  };
  const render = () => {
    if (page === 'ai') {
      const proposalPreviews = Object.fromEntries(
        taskHistory.flatMap(({ task }) => {
          if (task.result?.kind !== 'outfit_proposal') return [];
          const proposal = task.result;
          const preview = taskHistory.find(
            (h) =>
              h.task.status === 'succeeded' &&
              h.task.result?.kind === 'tryon_result' &&
              h.task.result.mode === 'outfit' &&
              sameLook(h.task.result.slots, proposal.slots),
          );
          const result = preview?.task.result;
          return result?.kind === 'tryon_result'
            ? [
                [
                  task.id,
                  {
                    asset: result.result_asset,
                    mode: result.mode,
                    taskId: preview!.task.id,
                  },
                ],
              ]
            : [];
        }),
      );
      return (
        <AIConversation
          proposalPreviews={proposalPreviews}
          api={api}
          owner={me.id}
          draft={d}
          items={items}
          enabled={capabilities.ai_styling}
          flush={() => flush(scene)}
          renderItem={renderItem}
          initialPrompt={initialPrompt}
          onPromptConsumed={() => setInitialPrompt('')}
          onTaskChange={rememberTask}
          onOpenProposal={(task) => {
            rememberTask(task);
            const result = task.result;
            const target =
              readConversationTaskIndex(localStorage, me.id).contexts[task.id]
                ?.scene ||
              taskHistory.find((h) => h.task.id === task.id)?.scene ||
              scene;
            if (result?.kind === 'outfit_proposal')
              openLook({
                id: task.id,
                taskId: task.id,
                title: `${sceneLabels[target]}的新想法`,
                scene: target,
                slots: result.slots,
                reason: result.reason,
                kind: 'proposal',
              });
          }}
        />
      );
    }
    if (page === 'look' && selectedLook) {
      const liveTask = taskHistory.find(
        (h) => h.task.id === selectedLook.taskId,
      )?.task;
      if (
        liveTask?.result?.kind === 'tryon_result' &&
        ['deleting', 'deleted'].includes(liveTask.result.result_asset.status)
      )
        return (
          <div className="content-page">
            <p className="content-note">这张上身图已不可用。</p>
            <button
              className="content-secondary"
              onClick={() => navigate(detailOrigin)}
            >
              返回
            </button>
          </div>
        );
      const look = looks.find((l) => l.id === selectedLook.id) || selectedLook;
      const source = looks.find((l) => l.id === look.sourceTaskId);
      return (
        <LookDetail
          look={look}
          items={items}
          renderItem={renderItem}
          favorite={lookFavorites.includes(look.id)}
          onFavorite={() => {
            const next = lookFavorites.includes(look.id)
              ? lookFavorites.filter((id) => id !== look.id)
              : [...lookFavorites, look.id];
            setLookFavorites(next);
            localWrite(`${prefix}:look-favorites`, next);
          }}
          onBack={() => navigate(detailOrigin)}
          current={sameLook(drafts[look.scene]?.slots || {}, look.slots)}
          busy={detailBusy}
          error={detailError}
          onAdopt={() => void detailAction('adopt')}
          onAdjust={() => void detailAction('adjust')}
          onTryOn={() => void detailAction('tryon')}
          onSource={source ? () => openLook(source) : undefined}
          onRetain={
            look.image
              ? () => {
                  setDetailBusy(true);
                  setDetailError('');
                  void api
                    .post<MediaAsset>(`/media/${look.image!.id}/retain`)
                    .then(() => notify('上身图已保存'))
                    .catch((e) => setDetailError(errorMessage(e)))
                    .finally(() => setDetailBusy(false));
                }
              : undefined
          }
        />
      );
    }

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
          onSave={() => navigate('mine')}
          onConfirm={() => void confirm()}
          onTryOn={() => navigate('tryon')}
          onCloset={() => navigate('closet')}
          onScene={changeScene}
          customized={customized}
          onRestoreScene={restore}
          onInspiration={() => {
            setInspirationFilter('全部');
            navigate('discover');
          }}
          onAI={() => navigate('ai')}
          feed={
            <section className="home-look-feed">
              <header>
                <h2>为你留住的新想法</h2>
                <button onClick={() => navigate('ai')}>
                  继续聊聊 <ArrowRight size={13} />
                </button>
              </header>
              {looks.filter((l) => l.kind === 'proposal').length ? (
                <LookGrid
                  looks={looks.filter((l) => l.kind === 'proposal').slice(0, 6)}
                  items={items}
                  renderItem={renderItem}
                  onOpen={openLook}
                />
              ) : (
                <p>
                  和 AI 聊聊今天的安排。每一套建议都会留在这里，喜欢再用到今天。
                </p>
              )}
            </section>
          }
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
            const selected = looks.find((l) => l.id === look.id);
            if (selected) openLook(selected);
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
          onBrowse={() => navigate('ai')}
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
          sourceTaskId={
            proposalSource && sameLook(proposalSource.slots, d.slots)
              ? proposalSource.taskId
              : undefined
          }
          onTaskChange={(task, source) => rememberTask(task, source, scene)}
        />
      );
    if (page === 'discover')
      return (
        <InspirationPage
          key={inspirationFilter}
          initialFilter={inspirationFilter}
          favorites={inspirationFavorites}
          onFavorite={(id) => {
            const next = inspirationFavorites.includes(id)
              ? inspirationFavorites.filter((x) => x !== id)
              : [...inspirationFavorites, id];
            setInspirationFavorites(next);
            localWrite(`${prefix}:inspiration-favorites`, next);
          }}
          onUse={(text) => {
            setInitialPrompt(text);
            navigate('ai');
          }}
        />
      );
    return (
      <MyStylePage
        name={me.display_name}
        items={items}
        looks={looks}
        lookFavorites={lookFavorites}
        inspirationFavorites={inspirationFavorites}
        renderItem={renderItem}
        onOpen={openLook}
        onCloset={() => navigate('closet')}
        onInspiration={() => {
          setInspirationFilter('已收藏');
          navigate('discover');
        }}
      >
        <details className="live-account-card">
          <summary>账户与本机记录</summary>
          <p className="live-muted">
            搭配与衣橱保存在当前账号。AI
            历史索引与收藏保存在此浏览器，换设备不会自动同步。
          </p>
          <p className="live-muted">
            本机有 {localUploads.length} 件你在演示中添加的衣物。
          </p>
          <Button
            variant="bordered"
            disabled={!localUploads.length || importBusy}
            onClick={() => void importLocal()}
          >
            {importBusy ? '正在同步…' : '同步我添加的衣物'}
          </Button>
          {importMessage && (
            <p role="status" className="live-muted">
              {importMessage}
            </p>
          )}
          <p className="live-muted">
            AI 搭配：{capabilities.ai_styling ? '已接入' : '尚未配置'} ·
            图片试穿：{capabilities.image_tryon ? '已接入' : '尚未配置'}
          </p>
          <Button variant="bordered" onClick={onDemo}>
            查看交互演示
          </Button>
        </details>
      </MyStylePage>
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
          <MobileTabBar
            current={currentTab}
            onNavigate={(p) => navigate(p)}
            onAI={() => navigate('ai')}
          />
          {toast && (
            <div className="toast" role="status">
              <CheckCheck size={17} />
              <span>{toast}</span>
            </div>
          )}
          <WardrobeSheet
            open={!!sheet}
            title={
              sheet === 'add'
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
