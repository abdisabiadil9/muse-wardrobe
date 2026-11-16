import { useState } from 'react';
import { Button } from '@lenso/ui/button';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { TaskController } from '../hooks/useTask';
import { errorMessage } from '../api/client';
const labels: Record<string, string> = {
  queued: '已排队',
  running: '正在处理',
  waiting_tools: '正在读取衣橱',
  needs_input: '再补充一点信息',
  succeeded: '已完成',
  failed: '这次没有完成',
  cancelled: '已取消',
  unconfirmed: '结果待确认',
};
const stages: Record<string, string> = {
  preparing: '正在准备参考图',
  generating: '正在生成试穿图',
  persisting: '正在保存试穿图',
  reading_wardrobe: '正在查看你的衣橱',
  recovering: '正在恢复任务状态',
  executing_tools: '正在核对衣物',
  composing: '正在整理搭配建议',
};
export default function TaskStatus({
  controller: c,
}: {
  controller: TaskController;
}) {
  const [answer, setAnswer] = useState(''),
    [localError, setLocalError] = useState('');
  const task = c.task;
  const active =
    task && ['queued', 'running', 'waiting_tools'].includes(task.status);
  const run = async (fn: () => Promise<unknown>) => {
    setLocalError('');
    try {
      await fn();
    } catch (e) {
      setLocalError(errorMessage(e));
    }
  };
  return (
    <div className="live-task" aria-live="polite">
      {c.submitting && (
        <p>
          <LoaderCircle className="live-spinner" size={16} />
          正在提交请求…
        </p>
      )}
      {task && (
        <>
          <p>
            {active && <LoaderCircle className="live-spinner" size={16} />}
            <strong>
              {task.cancel_requested_at
                ? '正在取消，请等待确认'
                : stages[task.stage || ''] || labels[task.status]}
            </strong>
            {active && task.progress !== null && <span>{task.progress}%</span>}
          </p>
          {task.status === 'unconfirmed' && (
            <p className="live-muted">
              连接中断，生成可能已经发生。先查询状态；再次生成可能产生新的消耗。
            </p>
          )}
          {task.status === 'failed' && (
            <p role="alert">
              {task.error?.message || '本次请求没有成功，现有搭配已保留。'}
            </p>
          )}
          {active && !task.cancel_requested_at && (
            <button className="text-link" onClick={() => void c.cancel()}>
              取消本次请求
            </button>
          )}
          {task.status === 'needs_input' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => c.answer(answer));
              }}
            >
              <label>
                {task.question || '请补充你的搭配要求'}
                <input
                  className="text-input"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <Button
                variant="bordered"
                disabled={!answer.trim() || c.submitting}
                type="submit"
              >
                继续搭配
              </Button>
            </form>
          )}
        </>
      )}
      {(c.error || localError) && <p role="alert">{c.error || localError}</p>}
      {c.error.includes('登录') && (
        <a href="/api/v1/auth/login?return_to=/">重新登录并恢复任务</a>
      )}
      {(c.pending || c.error || task?.status === 'unconfirmed') && (
        <Button
          variant="bordered"
          disabled={c.submitting}
          onClick={() => void run(c.recover)}
          icon={<RefreshCw size={15} />}
        >
          {c.pending ? '恢复上次提交' : '查询最新状态'}
        </Button>
      )}
    </div>
  );
}
