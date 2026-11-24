import { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, newKey, type Api } from '../api/client';
import type { InspirationRequest, InspirationTask } from '../inspiration';
type RecordState = {
  id?: string;
  key: string;
  request: InspirationRequest;
  pending: boolean;
};
export function useInspiration(api: Api, owner: string) {
  const storageKey = `muse-live:${owner}:inspiration-request`;
  const read = () => {
    try {
      const r = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return r &&
        typeof r.key === 'string' &&
        typeof r.pending === 'boolean' &&
        r.request &&
        ['search', 'note'].includes(r.request.action) &&
        typeof r.request.style_id === 'string' &&
        (!r.id || typeof r.id === 'string')
        ? (r as RecordState)
        : null;
    } catch {
      return null;
    }
  };
  const [record, setRecord] = useState<RecordState | null>(read);
  const [task, setTask] = useState<InspirationTask | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const current = useRef(record);
  current.current = record;
  const persist = (next: RecordState | null) => {
    current.current = next;
    setRecord(next);
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next));
      else localStorage.removeItem(storageKey);
    } catch {
      /* task still recoverable in current page */
    }
  };
  useEffect(() => {
    setRecord(read());
    setTask(null);
    setError('');
  }, [storageKey]);
  useEffect(() => {
    if (!record?.id) return;
    const id = record.id,
      controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.get<InspirationTask>(
          `/tasks/${id}`,
          controller.signal,
        );
        if (controller.signal.aborted || current.current?.id !== id) return;
        setTask(next);
        setError('');
        if (
          !['succeeded', 'failed', 'cancelled', 'unconfirmed'].includes(
            next.status,
          )
        )
          timer = setTimeout(poll, 3500);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(errorMessage(e));
          timer = setTimeout(poll, 10000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, record?.id, pollVersion]);
  const dispatch = async (next: RecordState) => {
    setSending(true);
    setError('');
    try {
      const reply = await api.post<{ task_id: string; status: string }>(
        '/inspiration-tasks',
        next.request,
        next.key,
      );
      if (!reply.task_id) throw new Error('未收到任务标识，请恢复原请求');
      if (current.current?.key === next.key)
        persist({ ...next, id: reply.task_id, pending: false });
    } catch (e) {
      setError(errorMessage(e));
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        current.current?.key === next.key
      )
        persist(null);
    } finally {
      setSending(false);
    }
  };
  const start = async (request: InspirationRequest) => {
    if (current.current?.pending) {
      setError('上一次请求尚未确认，请先恢复原请求');
      return;
    }
    const next = { key: newKey(), request, pending: true };
    persist(next);
    setTask(null);
    await dispatch(next);
  };
  const recover = async () => {
    if (!record) return;
    if (record.pending) return dispatch(record);
    if (task?.status === 'unconfirmed') {
      setSending(true);
      setError('');
      try {
        await api.post(`/inspiration-tasks/${task.id}/reconcile`, {}, newKey());
        setTask(null);
        setPollVersion((v) => v + 1);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setSending(false);
      }
    }
  };
  const busy =
    sending ||
    Boolean(
      record?.id &&
      (!task || ['queued', 'running', 'waiting_tools'].includes(task.status)),
    );
  return {
    task,
    record,
    error,
    sending,
    busy,
    start,
    recover,
    pending: Boolean(record?.pending),
  };
}
