import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonSource } from "../tryonInput";
import {
  ApiError,
  errorMessage,
  isTerminal,
  newKey,
  type Api,
  type Task,
} from "../api/client";
export type TaskContext = {
  scene: string;
  draftId: string;
  revision: number;
  personAssetId?: string;
  personSource?: PersonSource;
  mode?: "single" | "outfit";
  targetSlot?: string;
};
type Pending = {
  path: string;
  body: unknown;
  key: string;
  context: TaskContext;
};
type RecordState = {
  taskId?: string;
  seq: number;
  context?: TaskContext;
  pending?: Pending;
};
export function readTaskRecord(key: string): RecordState {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || { seq: 0 };
  } catch {
    return { seq: 0 };
  }
}
/** Polling/SSE only observe durable work. Mounting, reconnecting and refreshing never start a new task. */
export function useTask(api: Api, owner: string, scope: string) {
  const key = `muse-live:${owner}:task:${scope}`;
  const [record, setRecord] = useState<RecordState>(() => readTaskRecord(key));
  const [task, setTask] = useState<Task | null>(null),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false);
  const recordRef = useRef(record);
  recordRef.current = record;
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const persist = useCallback(
    (next: RecordState) => {
      localStorage.setItem(key, JSON.stringify(next));
      recordRef.current = next;
      setRecord(next);
    },
    [key],
  );
  useEffect(() => {
    setRecord(readTaskRecord(key));
    setTask(null);
    setError("");
  }, [key]);
  useEffect(() => {
    if (!record.taskId) return;
    const controller = new AbortController();
    let busy = false;
    let terminal = false;
    let currentSeq = record.seq;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const next = await api.get<Task>(
          `/tasks/${record.taskId}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setTask(next);
        setError("");
        currentSeq = Math.max(currentSeq, next.last_event_seq);
        persist({ ...recordRef.current, seq: currentSeq });
        terminal = isTerminal(next);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
      } finally {
        busy = false;
      }
    };
    refreshRef.current = refresh;
    const connect = async () => {
      await refresh();
      if (controller.signal.aborted || terminal) return;
      try {
        await api.stream(record.taskId!, currentSeq, controller.signal, () => {
          void refresh();
        });
      } catch {
        /* Snapshot polling continues even if a mobile proxy closes SSE. */
      }
      if (!controller.signal.aborted && !terminal)
        reconnect = setTimeout(connect, 2500);
    };
    void connect();
    const timer = setInterval(() => {
      if (!terminal && document.visibilityState === "visible") void refresh();
    }, 4000);
    const foreground = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", foreground);
    return () => {
      controller.abort();
      clearInterval(timer);
      clearTimeout(reconnect);
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", foreground);
    };
  }, [api, record.taskId, record.pending, key, persist]);
  const send = async (pending: Pending) => {
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api.post<{ task_id: string; status: string }>(
        pending.path,
        pending.body,
        pending.key,
      );
      if (
        !accepted ||
        typeof accepted.task_id !== "string" ||
        !accepted.task_id
      )
        throw new ApiError(0, {
          code: "INVALID_TASK_ACK",
          message: "任务回复不完整，请恢复上次提交。",
          retryable: true,
          request_id: "",
        });
      persist({ taskId: accepted.task_id, seq: 0, context: pending.context });
      setTask(null);
    } catch (e) {
      setError(errorMessage(e));
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408
      ) {
        persist({ ...recordRef.current, pending: undefined });
      }
      throw e;
    } finally {
      setSubmitting(false);
    }
  };
  const start = async (path: string, body: unknown, context: TaskContext) => {
    if (recordRef.current.pending)
      throw new Error("上次提交结果待确认，请先恢复查询。");
    const pending = { path, body, key: newKey(), context };
    persist({ ...recordRef.current, pending });
    await send(pending);
  };
  const recover = async () => {
    if (recordRef.current.pending) {
      await send(recordRef.current.pending);
    } else await refreshRef.current?.();
  };
  const cancel = async () => {
    if (!recordRef.current.taskId) return;
    try {
      const next = await api.post<Task>(
        `/tasks/${recordRef.current.taskId}/cancel`,
      );
      setTask(next);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const answer = async (message: string) => {
    if (!recordRef.current.taskId || task?.status !== "needs_input") return;
    await start(
      `/tasks/${recordRef.current.taskId}/messages`,
      { message },
      recordRef.current.context!,
    );
  };
  return {
    task,
    error,
    submitting,
    context: record.context,
    pending: !!record.pending,
    taskId: record.taskId,
    start,
    recover,
    cancel,
    answer,
    refresh: () => refreshRef.current?.(),
  };
}
export type TaskController = ReturnType<typeof useTask>;
