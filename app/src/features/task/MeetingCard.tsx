import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { MeetingDoneInput } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { Field, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useTheme } from '@/theme';
import type { TaskCtx } from './model';
import { CheckRow } from './parts';

const styles = StyleSheet.create({
  attend: { gap: 8 },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
});

/**
 * A meeting task for its owner (board 7): no files; one sentence about what was decided, who came (every
 * other active member, all ticked to start; the owner is always present), then 我开完了，标记完成.
 */
export function MeetingCard({ ctx, onDone }: { ctx: TaskCtx; onDone: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.meeting;
  const { detail, task, busy } = ctx;
  const others = detail.members.filter((m) => m.active && m.memberId !== detail.owner?.memberId);
  const [summary, setSummary] = useState('');
  const [absent, setAbsent] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const done = () => {
    const text = summary.trim();
    if (!text) return setError(k.summaryMissing);
    const body: MeetingDoneInput = { summary: text, attendeeMemberIds: others.filter((m) => !absent.has(m.memberId)).map((m) => m.memberId) };
    void ctx.run('meeting', `${ctx.base}/meeting-done`, { method: 'POST', body }, {
      done: (d) => {
        ctx.toast(k.doneToast(formatPoints(d.task.earnedPoints || task.points)));
        onDone();
      },
      fail: (err) => {
        if (errorCode(err) !== 'SUMMARY_REQUIRED') return false;
        setError(k.summaryMissing);
        return true;
      },
    });
  };

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Txt v="text" weight={700}>
          {k.title}
        </Txt>
        <Txt v="meta">{k.hint}</Txt>
      </View>
      <Field label={k.summary} error={error}>
        <Input
          label={k.summary}
          value={summary}
          onChangeText={(v) => {
            setSummary(v);
            setError(null);
          }}
          multiline
          maxLength={500}
          invalid={!!error}
          style={{ minHeight: 88 }}
        />
      </Field>
      {others.length > 0 ? (
        <Field label={k.attendees}>
          <View style={styles.attend} role="group" aria-label={k.attendees}>
            {others.map((m) => {
              const on = !absent.has(m.memberId);
              return (
                <CheckRow key={m.memberId} on={on} onPress={() => toggle(m.memberId)} label={m.name} disabled={busy !== null}>
                  <View style={[styles.person, !on && { opacity: 0.6 }]}>
                    <Avatar name={m.name} hl={m.color} size="sm" decorative />
                    <Txt v="small" color={on ? 'ink' : 'muted'}>
                      {m.name}
                    </Txt>
                  </View>
                </CheckRow>
              );
            })}
          </View>
        </Field>
      ) : null}
      <Txt v="meta">{k.attendeesHint}</Txt>
      <Button
        title={k.done}
        block
        icon={<Icon name="check" size={18} color={c.onGrape} />}
        loading={busy === 'meeting'}
        disabled={busy !== null && busy !== 'meeting'}
        onPress={done}
      />
    </Card>
  );
}
