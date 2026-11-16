import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Layers, Sparkles } from "lucide-react";
import { Button } from "@lenso/ui/button";
import { SegmentedControl } from "@lenso/ui/segmented-control";
import {
  errorMessage,
  type Api,
  type Draft,
  type MediaAsset,
  type SlotName,
  type Task,
} from "../api/client";
import { slotNames, type Garment } from "../data";
import { useTask } from "../hooks/useTask";
import TaskStatus from "./TaskStatus";
import { tryonRequest } from "../api/viewModels";
import {
  exampleModels,
  personInputKeys,
  preparePersonAsset,
  restorePersonSelection,
  samePersonInput,
  type PersonSelection,
  type PersonSource,
} from "../tryonInput";

type Props = {
  api: Api;
  owner: string;
  draft: Draft;
  items: Garment[];
  enabled: boolean;
  flush: () => Promise<Draft>;
  onBack: () => void;
  onSaveOutfit: () => Promise<void>;
  sourceTaskId?: string;
  onTaskChange?: (task: Task | null, sourceTaskId?: string) => void;
};
export default function LiveTryOn(p: Props) {
  const c = useTask(p.api, p.owner, `tryon:${p.draft.scene}`);
  const inputKeys = personInputKeys(p.owner);
  const onTaskChangeRef = useRef(p.onTaskChange); onTaskChangeRef.current = p.onTaskChange;
  useEffect(() => { onTaskChangeRef.current?.(c.task, c.context?.sourceTaskId); }, [c.task, c.context?.sourceTaskId]);
  const cacheKey = inputKeys.upload;
  const [selection, setSelection] = useState<PersonSelection>(() => {
    try {
      return restorePersonSelection(
        JSON.parse(localStorage.getItem(inputKeys.selection) || "null"),
        localStorage.getItem(cacheKey),
      );
    } catch {
      return restorePersonSelection(null, localStorage.getItem(cacheKey));
    }
  });
  const [mode, setMode] = useState<"single" | "outfit">("outfit"),
    [target, setTarget] = useState<SlotName>(
      p.draft.slots.top
        ? "top"
        : (Object.keys(p.draft.slots)[0] as SlotName) || "coat",
    );
  const restoredSelectionTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    const taskId = c.taskId;
    const taskMode = c.context?.mode;
    const taskTarget = c.context?.targetSlot;
    if (!taskId || !taskMode || restoredSelectionTask.current === taskId)
      return;
    if (
      taskMode === "single" &&
      (!taskTarget || !Object.hasOwn(slotNames, taskTarget))
    )
      return;
    // Restore once per task; later status updates must keep the user's edits.
    restoredSelectionTask.current = taskId;
    setMode(taskMode);
    if (taskMode === "single") setTarget(taskTarget as SlotName);
  }, [c.taskId, c.context?.mode, c.context?.targetSlot]);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [person, setPerson] = useState<MediaAsset | null>(null),
    [original, setOriginal] = useState<MediaAsset | null>(null),
    [result, setResult] = useState<MediaAsset | null>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showOriginal, setShowOriginal] = useState(false),
    [retained, setRetained] = useState(false),
    [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const id = localStorage.getItem(cacheKey);
    if (id)
      void p.api
        .get<MediaAsset>(`/media/${id}`)
        .then(setPerson)
        .catch(() => {
          setError(
            "上次上传的照片暂不可用。可稍后重试、重新上传，或选择示例模特。",
          );
        });
  }, [p.api, cacheKey]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const id = c.context?.personAssetId;
    if (id)
      void p.api
        .get<MediaAsset>(`/media/${id}`)
        .then(setOriginal)
        .catch(() => setOriginal(null));
  }, [p.api, c.context?.personAssetId]);
  const tryonResult =
    c.task?.status === "succeeded" && c.task.result?.kind === "tryon_result"
      ? c.task.result
      : null;
  useEffect(() => {
    setRetained(false);
    setShowOriginal(false);
    setResult(tryonResult?.result_asset || null);
    if (tryonResult)
      void p.api
        .get<MediaAsset>(`/media/${tryonResult.result_asset.id}`)
        .then(setResult)
        .catch((e) => setError(errorMessage(e)));
  }, [p.api, tryonResult?.result_asset.id]);
  const rememberSelection = (next: PersonSelection) => {
    localStorage.setItem(inputKeys.selection, JSON.stringify(next));
    setSelection(next);
  };
  const chooseSource = (source: PersonSource) => {
    rememberSelection({
      source,
      pendingUpload:
        source === "upload" &&
        (!!file || (selection.source === "upload" && selection.pendingUpload)),
    });
    setConsent(false);
    setError("");
    setMessage("");
  };
  const select = (next?: File) => {
    if (!next) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(next.type) ||
      next.size > 10 * 1024 * 1024
    ) {
      setError("请选择不超过 10 MB 的 JPG、PNG 或 WebP 照片。");
      return;
    }
    setError("");
    setFile(next);
    rememberSelection({ source: "upload", pendingUpload: true });
    setConsent(false);
  };
  const active =
    c.task &&
    ["queued", "running", "waiting_tools", "needs_input"].includes(
      c.task.status,
    );
  const generate = async () => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!consent) throw new Error("请先确认照片使用说明。");
      if (!Object.keys(p.draft.slots).length)
        throw new Error("先从衣橱为今日搭配选择衣服。");
      const draft = await p.flush();
      if (mode === "single" && !draft.slots[target])
        throw new Error("请选择一件当前搭配中的衣服。");
      const asset = await preparePersonAsset({
        selection,
        file,
        personalAsset: person,
        modelAssetId:
          selection.source === "upload"
            ? undefined
            : localStorage.getItem(inputKeys[selection.source]),
        api: p.api,
      });
      if (selection.source === "upload") {
        localStorage.setItem(cacheKey, asset.id);
        if (mounted.current) {
          setPerson(asset);
          setFile(null);
          rememberSelection({ source: "upload", pendingUpload: false });
        }
      } else {
        localStorage.setItem(inputKeys[selection.source], asset.id);
      }
      await c.start(
        "/tryon-tasks",
        tryonRequest(draft, asset.id, mode, target),
        {
          scene: draft.scene,
          sourceTaskId: p.sourceTaskId,
          draftId: draft.id,
          revision: draft.revision,
          personAssetId: asset.id,
          personSource: selection.source,
          mode,
          targetSlot: mode === "single" ? target : undefined,
        },
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const retain = async () => {
    if (!result) return;
    setError("");
    try {
      const asset = await p.api.post<MediaAsset>(`/media/${result.id}/retain`);
      setResult(asset);
      setRetained(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const refreshImage = async (asset: MediaAsset, isOriginal = false) => {
    try {
      const next = await p.api.get<MediaAsset>(`/media/${asset.id}`);
      if (isOriginal) setOriginal(next);
      else setResult(next);
    } catch {
      setError("图片链接暂不可用，请查询最新任务状态。");
    }
  };
  const selectedLabel =
    selection.source === "upload"
      ? "我的照片"
      : `${exampleModels[selection.source].label} · AI 示例`;
  const taskSource = c.context?.personSource || "upload";
  const resultPersonLabel =
    taskSource === "upload"
      ? "上传的人物照片"
      : `${exampleModels[taskSource].label} AI 示例`;
  const selectedPreview =
    selection.source === "upload"
      ? selection.pendingUpload && !file
        ? undefined
        : preview || person?.download_url
      : exampleModels[selection.source].image;
  const differentInput =
    !!result && !samePersonInput(selection, person?.id, c.context);
  const display = result
    ? showOriginal
      ? original?.download_url
      : result.download_url
    : selectedPreview;
  const stale =
    tryonResult &&
    (tryonResult.draft_id !== p.draft.id ||
      tryonResult.draft_revision !== p.draft.revision);
  return (
    <div className="live-page">
      <header className="live-tryon-header">
        <button onClick={p.onBack} aria-label="返回今日搭配">
          <ArrowLeft size={21} />
        </button>
        <h1>看看上身的感觉</h1>
      </header>
      <fieldset className="live-person-sources">
        <legend>选择试穿人物</legend>
        <div className="live-person-grid">
          {(["female", "male"] as const).map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={selection.source === source}
              disabled={busy || c.submitting}
              className={selection.source === source ? "selected" : ""}
              onClick={() => chooseSource(source)}
            >
              <img
                src={exampleModels[source].image}
                alt={`${exampleModels[source].label} AI 示例`}
              />
              <strong>{exampleModels[source].label}</strong>
              <small>AI 示例</small>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={selection.source === "upload"}
            disabled={busy || c.submitting}
            className={selection.source === "upload" ? "selected" : ""}
            onClick={() => chooseSource("upload")}
          >
            {preview || person?.download_url ? (
              <img src={preview || person?.download_url} alt="我的人物照片" />
            ) : (
              <span className="live-person-upload-icon">
                <Camera size={26} />
              </span>
            )}
            <strong>我的照片</strong>
            <small>
              {file ? "已选择新照片" : person ? "上次上传" : "自行上传"}
            </small>
          </button>
        </div>
        <p className="live-muted">
          示例模特仅用于看搭配外观，不能预估你的真实身材或合身程度。
        </p>
      </fieldset>
      {display ? (
        <img
          className="live-photo"
          src={display}
          alt={
            result
              ? showOriginal
                ? "生成时的人物原图"
                : "AI 生成的试穿外观预览"
              : `待试穿人物：${selectedLabel}`
          }
          onError={() => {
            if (result)
              void refreshImage(
                showOriginal && original ? original : result,
                showOriginal,
              );
          }}
        />
      ) : (
        <div className="live-photo-empty">
          <Camera size={34} />
          <strong>用自己的照片试穿</strong>
          <span>
            正面全身照，光线清晰
            <br />
            先选衣服，再看看上身的感觉
          </span>
        </div>
      )}
      {result && (
        <div className="live-result-bar">
          <span>
            {tryonResult?.mode === "single" ? "单件" : "整套"} AI 外观预览 ·
            非尺码依据
          </span>
          <button
            disabled={!original?.download_url}
            onClick={() => setShowOriginal(!showOriginal)}
          >
            <Layers size={14} />
            {showOriginal ? "看试穿图" : "对比原图"}
          </button>
        </div>
      )}
      {result && (
        <p className="live-photo-label">
          上次生成使用：{resultPersonLabel}。
          {differentInput
            ? `已选择${selectedLabel}，上方仍是旧结果；点击生成后使用新选择。`
            : ""}
        </p>
      )}
      {!result && <p className="live-photo-label">当前人物：{selectedLabel}</p>}
      {stale && (
        <p className="live-stale">
          这张图片对应生成时的搭配。你已调整衣服，可从人物原图重新生成当前这套。
        </p>
      )}
      {selection.source === "upload" && (
        <>
          <label className="live-file-label">
            {file
              ? "已选择新照片 · 可更换"
              : person
                ? "更换人物照片"
                : "选择人物照片"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || c.submitting}
              onChange={(e) => {
                select(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {selection.pendingUpload && !file && (
            <p className="live-stale">
              新照片还没有上传，刷新后请重新选择。不会改用之前的照片生成。
            </p>
          )}
        </>
      )}
      <div style={{ marginTop: 18 }}>
        <SegmentedControl
          aria-label="试穿范围"
          items={[
            { value: "outfit", label: "试穿整套" },
            { value: "single", label: "试穿单件" },
          ]}
          value={mode}
          onValueChange={(v) => {
            if (v) setMode(v as "single" | "outfit");
          }}
          size="lg"
        />
      </div>
      <div className="live-choice-row">
        {Object.entries(p.draft.slots).map(([slot, ref]) => (
          <button
            key={slot}
            className={mode === "outfit" || target === slot ? "active" : ""}
            onClick={() => {
              setMode("single");
              setTarget(slot as SlotName);
            }}
          >
            {p.items.find((g) => g.id === ref?.ref_id)?.name ||
              slotNames[slot as SlotName]}
          </button>
        ))}
      </div>
      <p className="live-muted">
        {mode === "single"
          ? "只替换所选单件，人物照片中的其他穿着保持原样。"
          : "使用人物原图与当前整套衣物重新生成；不会在上一次生成图上叠加换装。"}
      </p>
      <label className="live-checkbox">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          {selection.source === "upload"
            ? "我有权使用这张人物照片，同意将照片与所选衣物提交给图片生成服务，用于本次私人试穿预览。"
            : `我同意将所选${exampleModels[selection.source].label} AI 示例与衣物提交给图片生成服务，用于本次试穿预览。`}
        </span>
      </label>
      {!p.enabled && (
        <p className="live-stale">
          图片试穿服务尚未开通。你仍可整理衣橱与调整搭配。
        </p>
      )}
      {(error || message) && (
        <p
          className={error ? "live-stale" : "live-muted"}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </p>
      )}
      <Button
        variant="prominent"
        disabled={
          !p.enabled ||
          !consent ||
          (selection.source === "upload" &&
            !file &&
            (!person || selection.pendingUpload)) ||
          busy ||
          c.submitting ||
          !!active ||
          c.pending ||
          !Object.keys(p.draft.slots).length
        }
        onClick={() => void generate()}
        icon={<Sparkles size={17} />}
      >
        {busy
          ? "正在准备照片…"
          : c.task?.status === "unconfirmed"
            ? "重新生成（可能再次消耗）"
            : result
              ? "重新生成当前搭配"
              : "生成试穿图"}
      </Button>
      <TaskStatus controller={c} />
      {result && (
        <div className="live-actions">
          <Button
            variant="bordered"
            disabled={retained}
            onClick={() => void retain()}
          >
            {retained ? "试穿图已保存" : "保存试穿图"}
          </Button>
          <Button
            variant="bordered"
            onClick={() =>
              void p
                .onSaveOutfit()
                .then(() => setMessage("当前搭配已保存。"))
                .catch((e) => setError(errorMessage(e)))
            }
          >
            保存当前搭配
          </Button>
        </div>
      )}
    </div>
  );
}
