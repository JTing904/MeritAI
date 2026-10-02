import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { AttemptView } from '@shared/types';
import { AI_REVIEWS_PER_TASK_DAY } from '@shared/constants';
import { Button } from '@/components/Button';
import { Card, SectionHeader } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { fallbackKey, modelName } from '@/features/ai/models';
import { AiScanCard } from '@/features/ai/Scan';
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
    // M6 `.fallback`: the AI couldn't grade, the leader does.
    fallback: { gap: 8, borderRadius: 20, padding: 16, backgroundColor: c.warnSoft },
    // M6 `.override`: 你是组长 · 推翻评级 under an AI grade.
    override: { gap: 6, borderWidth: 2, borderColor: c.overrideBorder, backgroundColor: c.card, borderRadius: 18, padding: 14 },
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
  const { detail, task, mine, leader, running, ended, busy } = ctx;
  const leaderName = detail.project.leaderName ?? '';

  if (shown.status === 'DRAFT') return null;

  if (shown.status === 'PENDING') {
    const grading = leader && !mine;
    const owner = detail.owner?.name ?? '';
    // M6: the AI is on it (「✨ AI 审核中」): the scanning card; the page polls the task every 5 s meanwhile.
    if (shown.aiState === 'QUEUED' || shown.aiState === 'RUNNING') {
      return (
        <>
          <SectionHeader title={k.title} />
          <AiScanCard title={t.ai.reviewing.title} hint={mine ? t.ai.reviewing.hintMine : t.ai.reviewing.hintOthers} />
          {mine && detail.aiReviewsLeftToday !== null ? (
            <Txt v="meta" style={{ marginTop: -8 }}>
              {t.ai.reviewing.left(detail.aiReviewsLeftToday, AI_REVIEWS_PER_TASK_DAY)}
            </Txt>
          ) : null}
        </>
      );
    }
    // M6: the AI couldn't (or wasn't allowed today): the leader grades; everyone else is told so.
    const fell = shown.aiState === 'FAILED' || shown.aiState === 'SKIPPED' ? fallbackKey(shown.aiFailReason) : null;
    if (fell && !grading) {
      return (
        <>
          <SectionHeader title={k.title} />
          <View style={s.fallback}>
            <Txt v="body" weight={700} color="warn">
              {t.ai.fallback.title[fell](leaderName)}
            </Txt>
            <Txt v="small">{mine ? t.ai.fallback.bodyMine : t.ai.fallback.bodyOthers}</Txt>
          </View>
        </>
      );
    }
    return (
      <>
        <SectionHeader title={k.title} />
        <Card style={{ gap: grading ? 8 : 6 }}>
          <Txt v="text" weight={700}>
            {grading ? k.toGrade : k.pending}
          </Txt>
          {grading && fell ? (
            <Txt v="small" color="warn" weight={600}>
              {t.ai.fallback.leader[fell]}
            </Txt>
          ) : null}
          <Txt v="meta">
            {grading
              ? k.toGradeHint(owner, shown.submittedAt ? dateTimeLabel(shown.submittedAt, t.labels.when) : '', shown.evidence.length)
              : mine
                ? k.pendingMine(leaderName)
                : k.pendingOthers(leaderName)}
          </Txt>
          {/* An ENDED project still lets the leader grade what was handed in before it ended. */}
          {grading && (running || ended) ? <Button title={k.grade} block disabled={busy !== null} onPress={onGrade} /> : null}
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
  const byAi = shown.gradedByAi;
  let by: string;
  if (byAi) by = t.ai.result.by(modelName(shown.aiModel, shown.aiProvider), stamp, shown.no);
  else if (grade === 'SELF' || shown.meeting) by = k.byMeeting(stamp);
  else if (shown.selfGraded) by = k.bySelf(stamp);
  else if (shown.outsideApp) by = k.byOutside(grader, when ? dates.date(when) : '');
  else by = k.by(grader, stamp, shown.no);

  const change = liveChange(shown);
  const note = shown.gradeNote?.trim() || null;
  // The AI's reasons and suggestions come as lists (its summary is the note); a leader's reasons are lines of the note.
  let reasons: string[] | null = null;
  if (byAi) reasons = shown.aiReasons.length > 0 ? shown.aiReasons : null;
  else if (note && (grade === 'HALF' || grade === 'FAIL')) reasons = note.split('\n').filter((l) => l.trim() !== '');
  const suggestions = byAi ? shown.aiSuggestions : [];

  // M6 (TaskAiHalf): under an AI 拿一半 / 不通过, who sees the reasons and what's left today.
  let aiHint: string | null = null;
  if (byAi && (grade === 'HALF' || grade === 'FAIL') && !change) {
    const left = mine && detail.aiReviewsLeftToday !== null;
    aiHint =
      t.ai.result.shared +
      (left ? t.ai.result.left(detail.aiReviewsLeftToday!) : '') +
      (left && grade === 'HALF' && canRedo ? t.ai.result.keep(formatPoints(earnedFor(task.points, 'HALF'))) : '') +
      (left ? t.ai.result.end : '');
  }

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
              {byAi ? t.ai.result.reasons : k.reasons}
            </Txt>
            <Bullets lines={reasons} color="ink" />
          </>
        ) : note ? (
          <>
            <Txt v="label" size={12.5}>
              {byAi ? t.ai.result.summary : k.comment}
            </Txt>
            <View style={s.note}>
              <Txt v="small">{note}</Txt>
            </View>
          </>
        ) : null}
        {suggestions.length > 0 ? (
          <>
            <Txt v="label" size={12.5}>
              {t.ai.result.suggestions}
            </Txt>
            <View style={[s.note, { gap: 4 }]} role="list">
              {suggestions.map((line, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6 }} role="listitem">
                  <Txt v="small" tabular>
                    {i + 1}.
                  </Txt>
                  <Txt v="small" style={{ flex: 1 }}>
                    {line}
                  </Txt>
                </View>
              ))}
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
          <Button
            title={byAi ? t.ai.result.redo : task.grade === 'HALF' ? k.redoHalf : k.redoFail}
            kind="soft"
            block
            disabled={busy !== null}
            onPress={onRedo}
          />
        ) : null}
      </View>
      {aiHint ? (
        <Txt v="meta" style={{ marginTop: -8 }}>
          {aiHint}
        </Txt>
      ) : hint ? (
        <Txt v="meta" style={{ marginTop: -8 }}>
          {hint}
        </Txt>
      ) : null}
      {byAi && leader && !mine && running ? (
        // M6 (TaskAiHalf): the leader may override the AI like any grade, with a reason everyone sees.
        <View style={s.override}>
          <Txt v="small" weight={700}>
            {t.ai.result.overrideTitle}
          </Txt>
          <Txt v="meta">{t.ai.result.overrideHint}</Txt>
          <View style={{ alignSelf: 'flex-start', marginLeft: -4 }}>
            <TextLink title={`${k.override} ›`} onPress={() => onOverride(shown)} disabled={busy !== null} />
          </View>
        </View>
      ) : leader && !mine && running ? (
        <View style={{ alignSelf: 'flex-start', marginTop: -8 }}>
          <TextLink title={k.override} onPress={() => onOverride(shown)} disabled={busy !== null} />
        </View>
      ) : byAi && !leader && running && !change && leaderName ? (
        <Txt v="meta" style={{ marginTop: -8 }}>
          {t.ai.result.overrideMember(leaderName)}
        </Txt>
      ) : null}
    </>
  );
}
