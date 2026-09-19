import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PrereqInput, TaskView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { isFinished, memberById, OptRow, useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import type { TaskCtx } from './model';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    tile: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  }),
);

const dueOf = (task: TaskView, deadline: string) => task.dueAt ?? deadline;

/**
 * 我在等哪个任务？ (board 16): every unfinished task of the project but this one, soonest due first, then
 * 不用等. One prerequisite at a time; 确定 saves the choice (nothing is sent when it didn't change).
 */
export function PrereqSheet({ ctx, onClose }: { ctx: TaskCtx; onClose: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.prereq.sheet;
  const dates = useLocalDates();
  const { project, task, detail } = ctx;
  const current = detail.prereq?.taskId ?? null;
  const [choice, setChoice] = useState<string | null>(current);
  const busy = ctx.busy === 'prereq';

  const deadline = project.basics.deadline;
  const options = project.tasks
    .filter((x) => x.id !== task.id && !isFinished(x))
    .sort((a, b) => dueOf(a, deadline).localeCompare(dueOf(b, deadline)) || a.order - b.order);

  const save = async () => {
    if (choice === current) return onClose();
    const picked = options.find((x) => x.id === choice) ?? null;
    const body: PrereqInput = { prereqTaskId: choice };
    await ctx.run('prereq', `${ctx.base}/prereq`, { method: 'PUT', body }, {
      done: () => {
        ctx.toast(picked ? k.set(picked.title) : k.cleared);
        onClose();
      },
    });
  };

  return (
    <Sheet visible onClose={onClose} title={k.title}>
      <Txt v="small" color="ink2">
        {k.text}
      </Txt>
      {options.length === 0 ? <Txt v="meta">{k.empty}</Txt> : null}
      {options.map((x) => {
        const owner = memberById(project, x.ownerMemberId);
        const due = dates.date(dueOf(x, deadline));
        const sub = !owner ? k.noOwner(due) : x.status === 'REVIEWING' ? k.reviewing(owner.name) : k.due(owner.name, due);
        return (
          <OptRow
            key={x.id}
            leading={
              owner ? (
                <Avatar name={owner.name} hl={owner.color} decorative />
              ) : (
                <View style={s.tile} aria-hidden>
                  <Txt v="text" weight={900} color="muted">
                    ?
                  </Txt>
                </View>
              )
            }
            title={x.title}
            sub={sub}
            subExtra={x.status === 'REVIEWING' && x.late ? <Chip tone="bad">{k.late}</Chip> : undefined}
            selected={choice === x.id}
            onPress={() => setChoice(x.id)}
            disabled={busy}
          />
        );
      })}
      <OptRow
        leading={
          <View style={[s.tile, { backgroundColor: 'transparent' }]} aria-hidden>
            <Icon name="close" size={22} color={c.muted} />
          </View>
        }
        title={k.none}
        sub={k.noneSub}
        selected={choice === null}
        onPress={() => setChoice(null)}
        disabled={busy}
      />
      <View style={{ marginTop: 4, gap: 8 }}>
        <Button title={k.confirm} block loading={busy} onPress={save} />
        <Txt v="meta" center>
          {k.hint}
        </Txt>
      </View>
    </Sheet>
  );
}
