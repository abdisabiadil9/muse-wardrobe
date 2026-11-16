import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  errorMessage,
  newKey,
  type Api,
  type Draft,
} from "../api/client";
import { sceneLabels } from "../api/viewModels";
import {
  composeStylingMessage,
  conversationStorageKey,
  eventText,
  mergeNativeEvents,
  mergeTask,
  readConversationRecord,
  taskIsWorking,
  type ConversationRecord,
  type ConversationTask,
  type NativeConversationEvent,
  type PendingMessage,
} from "../conversation";

type NativePage = {
  data: NativeConversationEvent[];
  next_cursor: string | null;
};
export function useConversation(api: Api, owner: string) {
  const [record, setRecord] = useState<ConversationRecord>(() =>
    readConversationRecord(localStorage, owner),
  );
  const [tasks, setTasks] = useState<Record<string, ConversationTask>>({});
  const [events, setEvents] = useState<
    Record<string, NativeConversationEvent[]>
  >({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const recordRef = useRef(record),
    tasksRef = useRef(tasks),
    eventsRef = useRef(events);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const busy = useRef(false);
  const cursors = useRef<Record<string, string>>({});
  const incompleteReads = useRef(new Set<string>());
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const save = useCallback(
    (next: ConversationRecord) => {
      // Persist before dispatch so an uncertain request always retains its original key.
      localStorage.setItem(conversationStorageKey(owner), JSON.stringify(next));
      recordRef.current = next;
      setRecord(next);
    },
    [owner],
  );
  const acceptTask = useCallback((task: ConversationTask) => {
    const next = {
      ...tasksRef.current,
      [task.id]: mergeTask(tasksRef.current[task.id], task),
    };
    tasksRef.current = next;
    setTasks(next);
  }, []);
  useEffect(() => {
    let restored = readConversationRecord(localStorage, owner);
    for (const scene of ["daily", "weekend", "meeting"]) {
      try {
        const legacy = JSON.parse(
          localStorage.getItem(`muse-live:${owner}:task:styling:${scene}`) ||
            "null",
        );
        if (
          typeof legacy?.taskId === "string" &&
          !restored.ids.includes(legacy.taskId)
        )
          restored = { ...restored, ids: [...restored.ids, legacy.taskId] };
      } catch {
        /* Ignore a malformed old local record. */
      }
    }
    save(restored);
    tasksRef.current = {};
    eventsRef.current = {};
    cursors.current = {};
    incompleteReads.current = new Set();
    setSubmitting(false);
    setTasks({});
    setEvents({});
    setError("");
    busy.current = false;
  }, [owner, save]);
  const idKey = record.ids.join(",");
  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    const refreshOne = async (id: string) => {
      incompleteReads.current.add(id);
      const task = await api.get<ConversationTask>(
        `/tasks/${encodeURIComponent(id)}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      acceptTask(task);
      let more = true;
      let after = cursors.current[id];
      let pages = 0;
      while (more && !controller.signal.aborted && pages++ < 50) {
        const page = await api.get<NativePage>(
          `/tasks/${encodeURIComponent(id)}/agent-events?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!Array.isArray(page.data))
          throw new Error("对话记录暂时无法读取，请恢复查询。");
        const merged = mergeNativeEvents(
          eventsRef.current[id] || [],
          page.data,
        );
        eventsRef.current = { ...eventsRef.current, [id]: merged };
        setEvents(eventsRef.current);
        const next = page.next_cursor;
        more = !!next && next !== after;
        after = next || page.data.at(-1)?.id || after;
        if (after) cursors.current[id] = after;
      }
      if (!more) incompleteReads.current.delete(id);
    };
    const sync = async (all = false) => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      try {
        const ids = recordRef.current.ids.filter(
          (id) =>
            all ||
            incompleteReads.current.has(id) ||
            !tasksRef.current[id] ||
            taskIsWorking(tasksRef.current[id]) ||
            tasksRef.current[id].status === "unconfirmed",
        );
        const results = await Promise.allSettled(ids.map(refreshOne));
        const failure = results.find(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (
          !controller.signal.aborted &&
          ids.length &&
          !recordRef.current.pending
        )
          setError(failure ? errorMessage(failure.reason) : "");
      } finally {
        polling = false;
      }
    };
    syncRef.current = () => sync(true);
    void sync(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 1200);
    const reconnect = () => {
      if (document.visibilityState === "visible") void sync(true);
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [api, owner, idKey, acceptTask]);
  const dispatch = async (pending: PendingMessage) => {
    if (busy.current) return;
    const requestOwner = owner;
    busy.current = true;
    setSubmitting(true);
    setError("");
    try {
      const accepted = await api.post<{ task_id: string }>(
        pending.path,
        pending.body,
        pending.key,
      );
      if (ownerRef.current !== requestOwner) return;
      if (!accepted?.task_id)
        throw new Error("提交结果尚未确认，请恢复上次提交。");
      const current = recordRef.current;
      save({
        ...current,
        ids: current.ids.includes(accepted.task_id)
          ? current.ids
          : [...current.ids, accepted.task_id],
        messages: {
          ...current.messages,
          ...(pending.path === "/styling-tasks"
            ? { [accepted.task_id]: pending.message }
            : {}),
        },
        answers: current.answers,
        contexts: {
          ...current.contexts,
          ...(pending.context ? { [accepted.task_id]: pending.context } : {}),
        },
        pending: undefined,
      });
      // Same-task needs_input continuations also need a fresh snapshot immediately.
      if (tasksRef.current[accepted.task_id])
        acceptTask({ ...tasksRef.current[accepted.task_id], status: "queued" });
      void syncRef.current();
    } catch (failure) {
      if (ownerRef.current !== requestOwner) return;
      setError(errorMessage(failure));
      if (
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408
      )
        save({ ...recordRef.current, pending: undefined });
      throw failure;
    } finally {
      busy.current = false;
      if (ownerRef.current === requestOwner) setSubmitting(false);
    }
  };
  const send = async (message: string, draft: Draft) => {
    if (busy.current || recordRef.current.pending)
      throw new Error("请先恢复上次提交。");
    const ordered = recordRef.current.ids
      .map((id) => tasksRef.current[id])
      .filter(Boolean);
    const waiting = [...ordered]
      .reverse()
      .find((task) => task.status === "needs_input");
    if (ordered.some(taskIsWorking))
      throw new Error("正在整理上一条建议，请稍候。");
    const prior = ordered
      .filter((task) => task.status === "succeeded")
      .slice(-3)
      .map((task) => ({
        user: recordRef.current.messages[task.id] || "",
        assistant: (eventsRef.current[task.id] || [])
          .filter((event) => event.type === "agent.message")
          .map(eventText)
          .join("\n")
          .slice(-1800),
        outfit:
          task.result?.kind === "outfit_proposal"
            ? {
                garment_ids: task.result.garment_ids,
                reason: task.result.reason,
              }
            : undefined,
      }));
    const contextualMessage = composeStylingMessage(message, prior);
    const pending: PendingMessage = {
      key: newKey(),
      message,
      createdAt: new Date().toISOString(),
      context: waiting
        ? recordRef.current.contexts[waiting.id]
        : { scene: draft.scene, draftId: draft.id, revision: draft.revision },
      path: waiting ? `/tasks/${waiting.id}/messages` : "/styling-tasks",
      body: waiting
        ? { message }
        : {
            draft_id: draft.id,
            draft_revision: draft.revision,
            intent: "style",
            occasion: sceneLabels[draft.scene],
            message: contextualMessage,
          },
    };
    save({ ...recordRef.current, pending });
    await dispatch(pending);
  };
  const recover = async () => {
    if (recordRef.current.pending) await dispatch(recordRef.current.pending);
    else await syncRef.current();
  };
  const cancel = async (id: string) => {
    try {
      acceptTask(
        await api.post<ConversationTask>(
          `/tasks/${encodeURIComponent(id)}/cancel`,
        ),
      );
      setError("");
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  return {
    tasks: record.ids.map((id) => tasks[id]).filter(Boolean),
    events,
    messages: record.messages,
    pending: record.pending,
    submitting,
    error,
    send,
    recover,
    cancel,
    loading: !!record.ids.length && !Object.keys(tasks).length,
    empty: !record.ids.length && !record.pending,
  };
}
