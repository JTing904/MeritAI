import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { AttemptView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card, SectionHeader } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { dateTimeLabel } from '@/lib/time';
import { makeStyles, useTheme } from '@/theme';
import { bestOther, earnedFor, gradeTone, isFullGrade, liveChange, type TaskCtx } from './model';
import { Bullets, TextLink } from './parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // `.result`
    panel: { borderRadius: 22, padding: 18, gap: 10 },
    // `.result .cmt`
    note: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.card },
  }),
);

/**
 * 评级结果 for the attempt being looked at (boards 4–9): 等组长审核 / 等你评级 while it's PENDING, else the
 * result panel. Its gain line always says what counts for the task (the best attempt), so a worse
 * resubmission never reads as 0 分. The owner gets 修改后重新提交 / 重新提交 until the task has full marks;
 * the leader gets 推翻评级.
 */
export function AttemptResult({
  ctx,
  shown,
  canRedo,
  onRedo,
  onGrade,
  onOverride,
}: {
  ctx: TaskCtx;
  shown: AttemptView;
  /** Show 修改后重新提交 / 重新提交 (the owner, nothing handed in or drafted since). */
  canRedo: boolean;
  onRedo: () => void;
  onGrade: () => void;
  onOverride: (attempt: AttemptView) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.task.result;
  const dates = useLocalDates();
  const { detail, task, mine, leader, running, busy } = ctx;
  const leaderName = detail.project.leaderName ?? '';

  if (shown.status === 'DRAFT') return null;

  if (shown.status === 'PENDING') {
    const grading = leader && !mine;
    const owner = detail.owner?.name ?? '';
    return (
      <>
        <SectionHeader title={k.title} />
        <Card style={{ gap: grading ? 8 : 6 }}>
          <Txt v="text" weight={700}>
            {grading ? k.toGrade : k.pending}
          </Txt>
          <Txt v="meta">
            {grading
              ? k.toGradeHint(owner, shown.submittedAt ? dateTimeLabel(shown.submittedAt, t.labels.when) : '', shown.evidence.length)
              : mine
                ? k.pendingMine(leaderName)
                : k.pendingOthers(leaderName)}
          </Txt>
          {grading && running ? <Button title={k.grade} block disabled={busy !== null} onPress={onGrade} /> : null}
        </Card>
      </>
    );
  }

  const grade = shown.grade;
  if (!grade) return null;
  const tone = gradeTone(grade);
  const pts = formatPoints(task.points);
  const counting = detail.attempts.find((a) => a.id === detail.countingAttemptId) ?? null;

  let gain: string;
  if (shown.counting || !counting) {
    if (isFullGrade(grade)) gain = mine ? k.fullMine(pts) : k.full(pts);
    else if (grade === 'HALF') gain = k.half(formatPoints(earnedFor(task.points, 'HALF')));
    else gain = k.fail;
  } else {
    gain = k.notCounting(t.labels.grade[grade], counting.no, formatPoints(task.earnedPoints));
    if (grade === 'FAIL' && !isFullGrade(counting.grade)) gain += k.canRedo;
  }

  const when = shown.gradedAt ?? shown.submittedAt;
  const stamp = when ? dateTimeLabel(when, t.labels.when) : '';
  const grader = ctx.nameOf(shown.gradedByMemberId) ?? leaderName;
  let by: string;
  if (grade === 'SELF' || shown.meeting) by = k.byMeeting(stamp);
  else if (shown.selfGraded) by = k.bySelf(stamp);
  else if (shown.outsideApp) by = k.byOutside(grader, when ? dates.date(when) : '');
  else by = k.by(grader, stamp, shown.no);

  const change = liveChange(shown);
  const note = shown.gradeNote?.trim() || null;
  const reasons = note && (grade === 'HALF' || grade === 'FAIL') ? note.split('\n').filter((l) => l.trim() !== '') : null;

  // Hints under the panel (boards 5 and 6).
  let hint: string | null = null;
  if (canRedo && task.grade === 'HALF') hint = k.halfHint(formatPoints(earnedFor(task.points, 'HALF')));
  else if (shown.counting && isFullGrade(grade)) {
    const graded = detail.attempts.filter((a) => a.status === 'GRADED').length;
    const other = graded > 1 ? bestOther(detail, shown.id) : null;
    if (other?.grade) hint = k.doneHint(other.no, t.labels.grade[other.grade], formatPoints(earnedFor(task.points, other.grade)), graded);
  }

  return (
    <>
      <SectionHeader title={k.title} />
      <View style={[s.panel, { backgroundColor: { good: c.goodSoft, warn: c.warnSoft, bad: c.badSoft }[tone] }]}>
        <Txt v="grade" color={tone}>
          {t.labels.grade[grade]}
        </Txt>
        <Txt v="small" weight={700}>
          {gain}
        </Txt>
        <Txt v="meta" color="ink2">
          {by}
        </Txt>
        {change ? (
          <Txt v="meta" color="ink2">
            {k.overridden(
              ctx.nameOf(change.byMemberId) ?? leaderName,
              dates.date(change.createdAt),
              t.labels.grade[change.fromGrade],
              t.labels.grade[change.toGrade],
              change.reason,
            )}
          </Txt>
        ) : null}
        {reasons ? (
          <>
            <Txt v="label" size={12.5}>
              {k.reasons}
            </Txt>
            <Bullets lines={reasons} color="ink" />
          </>
        ) : note ? (
          <>
            <Txt v="label" size={12.5}>
              {k.comment}
            </Txt>
            <View style={s.note}>
              <Txt v="small">{note}</Txt>
            </View>
          </>
        ) : null}
        {shown.outsideNote ? (
          <>
            <Txt v="label" size={12.5}>
              {k.outsideNote}
            </Txt>
            <View style={s.note}>
              <Txt v="small">{shown.outsideNote}</Txt>
            </View>
          </>
        ) : null}
        {canRedo ? (
          <Button title={task.grade === 'HALF' ? k.redoHalf : k.redoFail} kind="soft" block disabled={busy !== null} onPress={onRedo} />
        ) : null}
      </View>
      {hint ? (
        <Txt v="meta" style={{ marginTop: -8 }}>
          {hint}
        </Txt>
      ) : null}
      {leader && !mine && running ? (
        <View style={{ alignSelf: 'flex-start', marginTop: -8 }}>
          <TextLink title={k.override} onPress={() => onOverride(shown)} disabled={busy !== null} />
        </View>
      ) : null}
    </>
  );
}
