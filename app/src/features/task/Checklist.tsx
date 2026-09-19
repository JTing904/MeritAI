import { useRef } from 'react';
import type { TaskDetail, TickInput } from '@shared/types';
import { Card } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { isFinished } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import type { TaskCtx } from './model';
import { CardHead, CheckRow, TextLink } from './parts';

/**
 * 做到这些才算完成: the owner ticks (optimistically, put back on failure); the leader and the owner edit.
 * Empty: the owner and the leader see the card with an invitation to write one (§15 #3), others nothing.
 */
export function Checklist({
  ctx,
  setDetail,
  onEdit,
}: {
  ctx: TaskCtx;
  setDetail: (detail: TaskDetail) => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const k = t.task.checklist;
  const { request } = useSession();
  const { detail, running, mine, leader } = ctx;
  const items = [...detail.checklist].sort((a, b) => a.order - b.order);
  const canEdit = running && (mine || leader);
  const canTick = running && mine;
  // Ticks in flight: a second tap on the same row waits for the first answer.
  const pending = useRef(new Set<string>());
  const latest = useRef(detail);
  latest.current = detail;

  // Empty: only an unfinished task invites a checklist (§15 #3).
  if (items.length === 0 && (!canEdit || isFinished(ctx.task))) return null;

  const tick = async (itemId: string, done: boolean) => {
    if (pending.current.has(itemId)) return;
    pending.current.add(itemId);
    const before = latest.current;
    setDetail({ ...before, checklist: before.checklist.map((i) => (i.id === itemId ? { ...i, done } : i)) });
    try {
      const body: TickInput = { done };
      setDetail(await request<TaskDetail>(`${ctx.base}/checklist/${encodeURIComponent(itemId)}/tick`, { method: 'POST', body }));
    } catch (err) {
      const now = latest.current;
      setDetail({ ...now, checklist: now.checklist.map((i) => (i.id === itemId ? { ...i, done: !done } : i)) });
      ctx.onError(err);
    } finally {
      pending.current.delete(itemId);
    }
  };

  const hint = mine ? k.hintOwner : leader ? k.hintLeader : k.hintOthers;

  return (
    <Card style={{ gap: 10 }}>
      <CardHead title={k.title} action={canEdit ? <TextLink title={k.edit} onPress={onEdit} disabled={ctx.busy !== null} /> : undefined} />
      {items.length === 0 ? (
        <Txt v="meta">{k.empty}</Txt>
      ) : (
        <>
          {items.map((item) => (
            <CheckRow key={item.id} on={item.done} onPress={canTick ? () => void tick(item.id, !item.done) : undefined}>
              {item.text}
            </CheckRow>
          ))}
          <Txt v="meta">{hint}</Txt>
        </>
      )}
    </Card>
  );
}
