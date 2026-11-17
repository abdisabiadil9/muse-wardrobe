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
  conversationHistoryKey,
  conversationTitle,
  newConversationThread,
  updateConversationThread,
  eventText,
  mergeNativeEvents,
  mergeTask,
  readConversationHistory,
  taskIsWorking,
  type ConversationHistory,
  type ConversationThread,
  type ConversationTask,
  type NativeConversationEvent,
  type PendingMessage,
} from "../conversation";

type NativePage = {
  data: NativeConversationEvent[];
  next_cursor: string | null;
};
export function useConversation(api: Api, owner: string) {
  const [history, setHistory] = useState<ConversationHistory>(() =>
    readConversationHistory(localStorage, owner),
  );
  const record = history.threads.find(
    (thread) => thread.id === history.activeId,
  )!;
  const [tasks, setTasks] = useState<Record<string, ConversationTask>>({});
  const [events, setEvents] = useState<
    Record<string, NativeConversationEvent[]>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submittingIds, setSubmittingIds] = useState<string[]>([]);
  const historyRef = useRef(history),
    tasksRef = useRef(tasks),
    eventsRef = useRef(events);
  const ownerRef = useRef(owner);
  const loadedOwner = useRef(owner);
  ownerRef.current = owner;
  const busy = useRef(new Set<string>());
  const cursors = useRef<Record<string, string>>({});
  const incompleteReads = useRef(new Set<string>());
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const save = useCallback(
    (next: ConversationHistory) => {
      localStorage.setItem(conversationHistoryKey(owner), JSON.stringify(next));
      historyRef.current = next;
      setHistory(next);
    },
    [owner],
  );
  const updateThread = (
    id: string,
    update: (thread: ConversationThread) => ConversationThread,
  ) => save(updateConversationThread(historyRef.current, id, update));
  const setError = (id: string, message: string) =>
    setErrors((current) => ({ ...current, [id]: message }));
  const acceptTask = useCallback((task: ConversationTask) => {
    const next = {
      ...tasksRef.current,
      [task.id]: mergeTask(tasksRef.current[task.id], task),
    };
    tasksRef.current = next;
    setTasks(next);
  }, []);
  useEffect(() => {
    save(
      loadedOwner.current === owner
        ? historyRef.current
        : readConversationHistory(localStorage, owner),
    );
    loadedOwner.current = owner;
    tasksRef.current = {};
    eventsRef.current = {};
    cursors.current = {};
    incompleteReads.current = new Set();
    setSubmittingIds([]);
    setTasks({});
    setEvents({});
    setErrors({});
    busy.current = new Set();
  }, [owner, save]);
  const idKey = history.threads.flatMap((thread) => thread.ids).join(",");
  useEffect(() => {
    const controller = new AbortController();
    let polling = false,
      syncAgain = false;
    let notificationTimer: ReturnType<typeof setTimeout> | undefined;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const streams = new Map<string, AbortController>();
    const retryAt = new Map<string, number>();
    const sequences = new Map<string, number>();
    const notify = () => {
      if (notificationTimer) return;
      notificationTimer = setTimeout(() => {
        notificationTimer = undefined;
        void sync();
      }, 120);
    };
    const manageStreams = () => {
      const active = historyRef.current.threads.find(
        (t) => t.id === historyRef.current.activeId,
      );
      const ids =
        document.visibilityState === "visible"
          ? (active?.ids || [])
              .filter(
                (id) =>
                  tasksRef.current[id] && taskIsWorking(tasksRef.current[id]),
              )
              .slice(-2)
          : [];
      for (const [id, stream] of streams)
        if (!ids.includes(id)) {
          stream.abort();
          streams.delete(id);
        }
      for (const id of ids) {
        if (streams.has(id) || (retryAt.get(id) || 0) > Date.now()) continue;
        const stream = new AbortController();
        streams.set(id, stream);
        void api
          .stream(id, sequences.get(id) || 0, stream.signal, (seq, payload) => {
            const event = payload?.native_event as
              NativeConversationEvent | undefined;
            if (
              event &&
              typeof event.id === "string" &&
              typeof event.type === "string"
            ) {
              eventsRef.current = {
                ...eventsRef.current,
                [id]: mergeNativeEvents(eventsRef.current[id] || [], [event]),
              };
              setEvents(eventsRef.current);
            }
            sequences.set(id, seq);
            notify();
          })
          .catch(() => {
            /* Snapshot reads remain available on mobile disconnects. */
          })
          .finally(() => {
            if (streams.get(id) === stream) streams.delete(id);
            retryAt.set(id, Date.now() + 3000);
            if (!controller.signal.aborted && !stream.signal.aborted) {
              const retry = setTimeout(() => {
                retries.delete(retry);
                void sync();
              }, 3100);
              retries.add(retry);
            }
          });
      }
    };
    const refreshOne = async (id: string) => {
      if (!tasksRef.current[id]) incompleteReads.current.add(id);
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
      if (controller.signal.aborted) return;
      if (polling) {
        syncAgain = true;
        return;
      }
      polling = true;
      try {
        const ids = [
          ...new Set(
            historyRef.current.threads.flatMap((thread) => thread.ids),
          ),
        ].filter(
          (id) =>
            all ||
            incompleteReads.current.has(id) ||
            !tasksRef.current[id] ||
            taskIsWorking(tasksRef.current[id]) ||
            tasksRef.current[id].status === "unconfirmed",
        );
        const results = await Promise.allSettled(ids.map(refreshOne));
        if (!controller.signal.aborted) {
          for (const thread of historyRef.current.threads) {
            const relevant = results.filter((_, index) =>
              thread.ids.includes(ids[index]),
            );
            const failure = relevant.find(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            );
            if (relevant.length && !thread.pending)
              setError(thread.id, failure ? errorMessage(failure.reason) : "");
          }
        }
      } finally {
        polling = false;
        if (!controller.signal.aborted) {
          manageStreams();
          if (syncAgain) {
            syncAgain = false;
            notify();
          }
        }
      }
    };
    syncRef.current = () => sync(true);
    void sync(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 15000);
    const reconnect = () => {
      manageStreams();
      if (document.visibilityState === "visible") void sync(true);
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      controller.abort();
      for (const stream of streams.values()) stream.abort();
      clearTimeout(notificationTimer);
      for (const retry of retries) clearTimeout(retry);
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [api, owner, idKey, history.activeId, acceptTask]);
  const dispatch = async (pending: PendingMessage, threadId: string) => {
    if (busy.current.has(threadId)) return;
    const requestOwner = owner;
    const requestBusy = busy.current;
    requestBusy.add(threadId);
    setSubmittingIds([...requestBusy]);
    setError(threadId, "");
    try {
      const accepted = await api.post<{ task_id: string }>(
        pending.path,
        pending.body,
        pending.key,
      );
      if (ownerRef.current !== requestOwner) return;
      if (!accepted?.task_id)
        throw new Error("提交结果尚未确认，请恢复上次提交。");
      updateThread(threadId, (current) => ({
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
        updatedAt: new Date().toISOString(),
      }));
      // Same-task needs_input continuations also need a fresh snapshot immediately.
      if (tasksRef.current[accepted.task_id])
        acceptTask({ ...tasksRef.current[accepted.task_id], status: "queued" });
      void syncRef.current();
    } catch (failure) {
      if (ownerRef.current !== requestOwner) return;
      setError(threadId, errorMessage(failure));
      if (
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408
      )
        updateThread(threadId, (current) => ({
          ...current,
          pending: undefined,
        }));
      throw failure;
    } finally {
      requestBusy.delete(threadId);
      if (ownerRef.current === requestOwner) setSubmittingIds([...requestBusy]);
    }
  };
  const send = async (
    message: string,
    draft: Draft,
    threadId = historyRef.current.activeId,
  ) => {
    const current = historyRef.current.threads.find(
      (thread) => thread.id === threadId,
    );
    if (!current) throw new Error("对话已不可用，请新建对话。");
    if (busy.current.has(threadId) || current.pending)
      throw new Error("请先恢复上次提交。");
    if (
      current.ids.some(
        (id) => !tasksRef.current[id] || incompleteReads.current.has(id),
      )
    )
      throw new Error("正在恢复对话，请稍候再发送。");
    const ordered = current.ids
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
        user: current.messages[task.id] || "",
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
        ? current.contexts[waiting.id]
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
    updateThread(threadId, (thread) => ({
      ...thread,
      pending,
      title: thread.ids.length ? thread.title : conversationTitle(message),
      updatedAt: pending.createdAt,
    }));
    await dispatch(pending, threadId);
  };
  const recover = async () => {
    const current = historyRef.current.threads.find(
      (thread) => thread.id === historyRef.current.activeId,
    )!;
    if (current.pending) await dispatch(current.pending, current.id);
    else await syncRef.current();
  };
  const cancel = async (id: string) => {
    const requestOwner = owner;
    const threadId = historyRef.current.threads.find((thread) =>
      thread.ids.includes(id),
    )?.id;
    try {
      const task = await api.post<ConversationTask>(
        `/tasks/${encodeURIComponent(id)}/cancel`,
      );
      if (ownerRef.current !== requestOwner) return;
      acceptTask(task);
      if (ownerRef.current === requestOwner && threadId) setError(threadId, "");
    } catch (failure) {
      if (ownerRef.current === requestOwner && threadId)
        setError(threadId, errorMessage(failure));
    }
  };
  const newConversation = () => {
    const empty = historyRef.current.threads.find(
      (thread) => !thread.ids.length && !thread.pending,
    );
    const thread = empty || newConversationThread();
    save({
      ...historyRef.current,
      activeId: thread.id,
      threads: empty
        ? historyRef.current.threads
        : [thread, ...historyRef.current.threads],
    });
  };
  const selectConversation = (id: string) => {
    if (historyRef.current.threads.some((thread) => thread.id === id))
      save({ ...historyRef.current, activeId: id });
  };
  return {
    activeId: record.id,
    conversations: history.threads,
    newConversation,
    selectConversation,
    allTasks: Object.values(tasks),
    tasks: record.ids.map((id) => tasks[id]).filter(Boolean),
    events: Object.fromEntries(record.ids.map((id) => [id, events[id] || []])),
    messages: record.messages,
    pending: record.pending,
    submitting: submittingIds.includes(record.id),
    error: errors[record.id] || "",
    send,
    recover,
    cancel,
    loading:
      !errors[record.id] &&
      record.ids.some((id) => !tasks[id] || incompleteReads.current.has(id)),
    empty: !record.ids.length && !record.pending,
  };
}
