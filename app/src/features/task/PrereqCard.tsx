import { View } from 'react-native';
import { Card } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { isFinished, useLocalDates } from '@/features/project/parts';
import { NoteBox } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import type { TaskCtx } from './model';
import { CardHead, LineText, TextLink } from './parts';

/**
 * 前置任务 (boards 1–9): what this task waits for (a yellow reminder, never a block) and who waits for it.
 * The owner and the leader get 我在等别的任务…, also on an empty card (§15 #3; not once the task is
 * finished); others see nothing then.
 */
export function PrereqCard({ ctx, onChange }: { ctx: TaskCtx; onChange: () => void }) {
  const { t } = useI18n();
  const k = t.task.prereq;
  const dates = useLocalDates();
  const { detail } = ctx;
  const { prereq, waitedBy } = detail;
  // A finished task has nothing left to wait for: no empty card and no link then.
  const canEdit = ctx.running && (ctx.mine || ctx.leader) && !isFinished(ctx.task);

  if (!prereq && waitedBy.length === 0 && !canEdit) return null;

  const change = canEdit ? <TextLink title={k.change} onPress={onChange} disabled={ctx.busy !== null} /> : null;
  const who = (name: string | null) => name ?? k.noOwner;

  return (
    <Card style={{ gap: 8 }}>
      {/* The link sits in the header unless the warn box needs the space (board 1: it goes under the hint). */}
      <CardHead title={k.title} action={prereq && !prereq.finished ? undefined : (change ?? undefined)} />
      {prereq && !prereq.finished ? (
        <>
          <NoteBox tone="warn">{k.waiting(prereq.title, who(prereq.ownerName), prereq.status === 'REVIEWING', dates.date(prereq.dueAt))}</NoteBox>
          {ctx.mine ? <Txt v="meta">{k.hint(prereq.title)}</Txt> : null}
          {change ? <View style={{ alignSelf: 'flex-start', marginLeft: -4 }}>{change}</View> : null}
        </>
      ) : null}
      {prereq && prereq.finished ? (
        <LineText>{k.done(prereq.title, who(prereq.ownerName), prereq.finishedAt ? dates.date(prereq.finishedAt) : null)}</LineText>
      ) : null}
      {waitedBy.map((w) => {
        const name = who(w.ownerName);
        return <LineText key={w.taskId}>{k.waitedBy(w.title, w.ownerMemberId === ctx.viewerId ? k.whoYou(name) : name)}</LineText>;
      })}
      {waitedBy.length > 0 ? <Txt v="meta">{k.waitedHint}</Txt> : null}
    </Card>
  );
}
