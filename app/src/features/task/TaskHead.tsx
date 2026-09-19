import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import { Avatar } from '@/components/Avatar';
import { Chip } from '@/components/Chip';
import { headingLevel } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { taskChip } from '@/lib/status';
import { dateTimeLabel, dueLabel, relativeTime } from '@/lib/time';
import { effectiveDue, type TaskCtx } from './model';
import { LineText, StatusLine, TextLink } from './parts';

const styles = StyleSheet.create({
  head: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  descRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

/**
 * The task's head (boards 1–9): kind, points, due and status chips, the title, the description with
 * 编辑 / 改说明, the owner; then 🔨 已开始 with ↶ 撤销 while the start can still be undone.
 */
export function TaskHead({ ctx, onEdit }: { ctx: TaskCtx; onEdit: () => void }) {
  const { t } = useI18n();
  const k = t.task;
  const { detail, task, project, mine, leader, running, busy } = ctx;
  const chip = taskChip(task, t);
  const keepEmoji = chip.key === 'REVIEWING' || chip.key === 'OVERDUE';
  const owner = detail.owner;
  const editLabel = leader ? k.head.edit : mine ? k.head.editDesc : null;

  const started = task.startedAt !== null && task.status === 'DOING';
  const fresh = detail.attempts.length === 0;
  const canUndo = mine && running && detail.undoStartUntil !== null && fresh;

  return (
    <View style={styles.head}>
      <View style={styles.chips}>
        <Chip hl={project.basics.color}>
          {t.labels.kindEmoji[task.kind]} {t.labels.kind[task.kind]}
        </Chip>
        <Chip tone="grape">{t.labels.contribution(formatPoints(task.points))}</Chip>
        <Chip tone={task.overdue ? 'bad' : 'default'}>{k.head.due(dueLabel(effectiveDue(detail), t.labels.due))}</Chip>
        <Chip tone={chip.tone}>{keepEmoji ? `${chip.emoji} ${chip.label}` : chip.label}</Chip>
      </View>
      <Txt v="hero" size={24} role="heading" {...headingLevel(1)}>
        {task.title}
      </Txt>
      {task.description || (editLabel && running) ? (
        <View style={styles.descRow}>
          <Txt v="text" color="ink2" style={{ flex: 1 }}>
            {task.description ?? ''}
          </Txt>
          {editLabel && running ? <TextLink title={editLabel} onPress={onEdit} disabled={busy !== null} /> : null}
        </View>
      ) : null}
      {owner ? (
        <View style={styles.owner}>
          <Avatar name={owner.name} hl={owner.color} size="sm" decorative />
          <Txt v="small">{mine ? k.head.ownerYou : k.head.owner(owner.name)}</Txt>
        </View>
      ) : (
        <View style={{ alignSelf: 'flex-start' }}>
          <Chip tone="warn">{k.head.noOwner}</Chip>
        </View>
      )}

      {started && task.startedAt ? (
        <>
          <StatusLine style={{ marginTop: 2 }}>
            <LineText>
              {k.started.line(fresh ? relativeTime(task.startedAt, t.labels.relative) : dateTimeLabel(task.startedAt, t.labels.when))}
              {canUndo ? ` · ${k.started.undoable}` : ''}
            </LineText>
            {canUndo ? (
              <TextLink
                title={k.started.undo}
                icon="undo"
                label={k.started.undoLabel}
                onPress={() =>
                  void ctx.run('undo-start', `${ctx.base}/undo-start`, { method: 'POST' }, { done: () => ctx.toast(k.started.undone) })
                }
                disabled={busy !== null}
              />
            ) : null}
          </StatusLine>
          {canUndo ? <Txt v="meta">{k.started.hint}</Txt> : null}
        </>
      ) : null}
    </View>
  );
}
