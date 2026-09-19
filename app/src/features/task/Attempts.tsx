import { StyleSheet, View } from 'react-native';
import type { AttemptView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Card, SectionHeader } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Seg } from '@/components/Controls';
import { Txt } from '@/components/Txt';
import { useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { dateTimeLabel } from '@/lib/time';
import { EvidenceRow } from './EvidenceRow';
import { effectiveDue, type TaskCtx } from './model';
import { openEvidence } from './open';
import { LineText, StatusLine, TextLink } from './parts';

const styles = StyleSheet.create({
  people: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

/**
 * 交证据 as handed in (boards 4–9): one card per attempt, a 第 N 次 switch when there are several.
 * Everyone sees it; the owner withdraws a PENDING attempt here (撤回修改). Meeting attempts show what was
 * decided and who came.
 */
export function Attempts({
  ctx,
  attempts,
  shown,
  onShow,
}: {
  ctx: TaskCtx;
  attempts: AttemptView[];
  shown: AttemptView;
  onShow: (id: string) => void;
}) {
  const { t } = useI18n();
  const k = t.task.attempts;
  const { request } = useSession();
  const dates = useLocalDates();
  const { detail, task, mine, leader, running, busy } = ctx;
  const several = attempts.length > 1;
  const meetingTask = task.kind === 'MEETING';

  let right: string | null;
  if (several) right = k.several(attempts.length);
  else if (meetingTask && shown.evidence.length === 0) right = null;
  else right = shown.status === 'GRADED' ? k.oneNo(shown.no, shown.evidence.length) : k.one(shown.evidence.length);

  const word = (a: AttemptView) =>
    a.status === 'GRADED' && a.grade ? t.labels.grade[a.grade] : a.status === 'PENDING' ? k.pendingWord : k.draftWord;

  const personOf = (id: string) => detail.members.find((m) => m.memberId === id) ?? null;

  let line: string | null = null;
  if (shown.status === 'DRAFT') line = k.draft(shown.evidence.length);
  else if (shown.outsideApp) {
    const at = shown.submittedAt ?? shown.gradedAt;
    line = at ? k.outside(dateTimeLabel(at, t.labels.when)) : null;
  } else if (!shown.meeting && shown.submittedAt) {
    const prefix = shown.status === 'GRADED' || several ? k.no(shown.no) : '';
    line = prefix + k.submittedLine(dateTimeLabel(shown.submittedAt, t.labels.when), dates.date(effectiveDue(detail)));
  }
  const pending = shown.status === 'PENDING';
  const onTime = pending && !shown.late && (mine || leader);

  const meeting = shown.meeting;
  const attendees = meeting ? meeting.attendeeMemberIds.map(personOf).filter((p) => p !== null) : [];
  const absent = meeting
    ? meeting.absentMemberIds.map((id) => personOf(id)?.name ?? ctx.nameOf(id)).filter((n): n is string => !!n)
    : [];

  return (
    <>
      <SectionHeader title={meetingTask ? k.meetingTitle : k.title} action={right ? <Txt v="meta">{right}</Txt> : undefined} />
      {several ? (
        <Seg
          label={k.segLabel}
          value={shown.id}
          onChange={onShow}
          options={attempts.map((a) => ({ value: a.id, label: k.seg(a.no), sub: word(a) }))}
        />
      ) : null}
      <Card style={{ gap: 10 }}>
        {line || onTime || (shown.late && shown.status !== 'DRAFT') ? (
          <StatusLine>
            {line ? <LineText>{line}</LineText> : null}
            {onTime ? <Chip tone="good">{k.onTime}</Chip> : null}
            {shown.late && shown.status !== 'DRAFT' ? <Chip tone="bad">{k.late}</Chip> : null}
          </StatusLine>
        ) : null}
        {shown.evidence.map((e) => (
          <EvidenceRow key={e.id} evidence={e} onOpen={() => void openEvidence(request, e, ctx.onError, () => ctx.toast(t.task.evidence.unsafeLink))} />
        ))}
        {pending ? <Txt v="meta">{mine ? k.hintMine : k.hintOthers}</Txt> : null}
        {pending && mine && running ? (
          <StatusLine>
            <View style={{ marginLeft: -4 }}>
              <TextLink
                title={k.withdraw}
                disabled={busy !== null}
                onPress={() =>
                  void ctx.run('withdraw', `${ctx.base}/withdraw`, { method: 'POST' }, { done: () => ctx.toast(k.withdrawn) })
                }
              />
            </View>
            <Txt v="meta" style={{ flexShrink: 1 }}>
              {k.withdrawHint}
            </Txt>
          </StatusLine>
        ) : null}
        {meeting ? (
          <>
            <View style={{ gap: 4 }}>
              <Txt v="label">{k.summary}</Txt>
              <Txt v="small">{meeting.summary}</Txt>
            </View>
            <View style={{ gap: 6 }}>
              <Txt v="label">{k.attendees}</Txt>
              <View style={styles.people}>
                {attendees.map((p) => (
                  <View key={p.memberId} style={styles.person}>
                    <Avatar name={p.name} hl={p.color} size="sm" decorative />
                    <Txt v="small">{p.name}</Txt>
                  </View>
                ))}
              </View>
              {absent.length > 0 ? <Txt v="meta">{k.absent(absent.join(k.nameSep))}</Txt> : null}
            </View>
          </>
        ) : null}
      </Card>
    </>
  );
}
