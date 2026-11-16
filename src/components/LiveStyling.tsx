import { useState } from 'react';
import { Button } from '@lenso/ui/button';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  errorMessage,
  type Api,
  type Draft,
  type OutfitProposal,
} from '../api/client';
import type { Garment } from '../data';
import { useTask } from '../hooks/useTask';
import TaskStatus from './TaskStatus';
import { sceneLabels } from '../api/viewModels';
export default function LiveStyling({
  api,
  owner,
  draft,
  items,
  enabled,
  flush,
  onApply,
  renderItem,
}: {
  api: Api;
  owner: string;
  draft: Draft;
  items: Garment[];
  enabled: boolean;
  flush: () => Promise<Draft>;
  onApply: (proposal: OutfitProposal) => Promise<void>;
  renderItem: (g: Garment) => ReactNode;
}) {
  const c = useTask(api, owner, `styling:${draft.scene}`);
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const proposal =
    c.task?.status === 'succeeded' && c.task.result?.kind === 'outfit_proposal'
      ? c.task.result
      : null;
  const stale =
    proposal &&
    (proposal.draft_revision !== draft.revision ||
      c.context?.draftId !== draft.id);
  const active =
    c.task &&
    ['queued', 'running', 'waiting_tools', 'needs_input'].includes(
      c.task.status,
    );
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const snapshot = await flush();
      await c.start(
        '/styling-tasks',
        {
          draft_id: snapshot.id,
          draft_revision: snapshot.revision,
          intent: 'style',
          occasion: sceneLabels[snapshot.scene],
          message,
        },
        {
          scene: snapshot.scene,
          draftId: snapshot.id,
          revision: snapshot.revision,
        },
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!proposal) return;
    setBusy(true);
    setError('');
    try {
      await onApply(proposal);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="sheet-lead">
        从你的已有衣物里，为{sceneLabels[draft.scene]}
        搭一套。先看看建议，喜欢再用。
      </p>
      <label className="live-form">
        今天还有什么想法？
        <input
          className="text-input"
          placeholder="例如：舒服一点，保留这件外套"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
        />
      </label>
      {!enabled && (
        <p className="live-stale">
          AI 搭配服务尚未开通，自由选衣和保存仍可使用。
        </p>
      )}
      {!items.length && (
        <p className="live-stale">先往自己的衣橱添加衣服，再来试试 AI 搭配。</p>
      )}
      <div className="live-actions">
        <Button
          variant="prominent"
          disabled={
            !enabled ||
            !items.length ||
            busy ||
            c.submitting ||
            !!active ||
            c.pending
          }
          onClick={() => void start()}
          icon={<Sparkles size={16} />}
        >
          {c.task?.status === 'unconfirmed'
            ? '重新请求（可能再次消耗）'
            : proposal
              ? '再搭一套'
              : '帮我搭一套'}
        </Button>
      </div>
      <TaskStatus controller={c} />
      {error && (
        <p className="live-stale" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <section className="live-proposal">
          <div className="live-proposal-items">
            {Object.values(proposal.slots).map((ref) => {
              const g = items.find((g) => g.id === ref?.ref_id);
              return g ? (
                <div key={g.id}>
                  {renderItem(g)}
                  <small>{g.name}</small>
                </div>
              ) : null;
            })}
          </div>
          <p>{proposal.reason}</p>
          <p className="live-muted">{proposal.owned_count} 件来自你的衣橱</p>
          {stale ? (
            <p className="live-stale">
              生成后搭配已改变。保留现在的选择，或重新请求一份建议。
            </p>
          ) : (
            <Button
              variant="prominent"
              disabled={busy}
              onClick={() => void apply()}
            >
              用这套搭配
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
