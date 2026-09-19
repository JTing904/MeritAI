import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { AttemptView, Grade, OverrideInput, ProjectView, TaskDetail } from '@shared/types';
import { Button } from '@/components/Button';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useLocalDates } from '@/features/project/parts';
import { Field, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { earnedAfterOverride, gradeTone, halfPoints, isFullGrade, latestLiveChange, type LeaderGrade } from './grades';
import { Levels } from './Levels';
import { levelOptions } from './GradeSheet';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    // The mockup's `.result.sm`: the attempt's current grade on its tone's soft ground.
    now: { gap: 4, borderRadius: 22, paddingVertical: 12, paddingHorizontal: 14 },
    by: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 },
    undo: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  }),
);

export type OverrideSheetProps = {
  project: ProjectView;
  detail: TaskDetail;
  /** The GRADED attempt being overridden (the task page passes the one shown; default the counting one). */
  attempt: AttemptView;
  onClose: () => void;
  /** The TaskDetail the write returned. */
  onChange: (detail: TaskDetail) => void;
  onError: (err: unknown) => void;
};

/** What a grade earns, as the small result line says it (拿满 10.0 分 / 5.0 分 / 0 分). */
function gainOf(points: number, grade: Grade, o: Messages['grade']['override']): string {
  if (isFullGrade(grade)) return o.gainFull(formatPoints(points));
  return grade === 'HALF' ? o.gainHalf(halfPoints(points)) : o.gainFail;
}

/**
 * 推翻评级 (M4 spec §10, board 13): the leader changes a GRADED attempt to any of the four levels, lower ones
 * too, with a reason, after a second confirmation. 撤销上次推翻 walks back the task's latest live override.
 * Closes itself when a reload shows the attempt can't be overridden now (a new submission is waiting).
 */
export function OverrideSheet({ detail, attempt: shown, onClose, onChange, onError }: OverrideSheetProps) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const o = t.grade.override;
  const { request } = useSession();
  const { show } = useToast();
  const dates = useLocalDates();

  const [grade, setGrade] = useState<LeaderGrade | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'undo' | 'override' | null>(null);

  const { task, owner } = detail;
  // The freshest copy of the attempt (the page reloads behind the sheet).
  const attempt = detail.attempts.find((a) => a.id === shown.id) ?? null;
  const valid =
    detail.project.viewerRole === 'LEADER' &&
    attempt !== null &&
    attempt.status === 'GRADED' &&
    attempt.grade !== null &&
    detail.current?.status !== 'PENDING';
  useEffect(() => {
    if (!valid && busy === null) onClose();
  }, [valid, busy, onClose]);
  if (!attempt || attempt.grade === null) return null;
  const current = attempt.grade;

  const viewerId = detail.project.viewerMemberId;
  const mine = owner?.memberId === viewerId;
  // Nobody hears about it when it's the leader's own task or the owner has left.
  const notified = owner !== null && owner.active && !mine ? owner.name : null;
  const nameOf = (memberId: string | null): string | null => {
    if (memberId === viewerId) return null;
    return detail.members.find((m) => m.memberId === memberId)?.name ?? t.project.feed.someone;
  };

  // This attempt's live override (changes are newest first); 撤销 walks back the task's latest one.
  const live = attempt.changes.find((ch) => ch.undoneAt === null) ?? null;
  const latest = latestLiveChange(detail);
  const canUndo = live !== null && latest?.change.id === live.id;

  const several = task.attemptCount > 1 || detail.attempts.filter((a) => a.status === 'GRADED').length > 1;
  const newEarned = grade ? formatPoints(earnedAfterOverride(detail, attempt, grade)) : null;
  const options = levelOptions(task.points, t.grade).map((opt) =>
    opt.grade === current ? { ...opt, sub: o.current, disabled: true } : opt,
  );
  const base = `/projects/${encodeURIComponent(detail.project.id)}/tasks/${encodeURIComponent(task.id)}`;

  const undo = async () => {
    if (busy || !live) return;
    setBusy('undo');
    try {
      const next = await request<TaskDetail>(`${base}/undo-override`, { method: 'POST' });
      onChange(next);
      show(o.undone(t.labels.grade[live.fromGrade]));
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const ask = () => {
    if (busy || !grade) return;
    if (!reason.trim()) {
      setReasonError(t.errors.REASON_REQUIRED);
      return;
    }
    setConfirming(true);
  };

  // ConfirmSheet awaits this and then closes itself; errors are handled here so it never rethrows.
  const apply = async () => {
    if (!grade) return;
    setBusy('override');
    try {
      const body: OverrideInput = { grade, reason: reason.trim(), attemptId: attempt.id };
      const next = await request<TaskDetail>(`${base}/override`, { method: 'POST', body });
      onChange(next);
      const earned = formatPoints(next.task.earnedPoints);
      show(mine ? o.doneYou(earned) : owner ? o.done(owner.name, earned) : o.doneQuiet);
      onClose();
    } catch (err) {
      if (errorCode(err) === 'REASON_REQUIRED') setReasonError(t.errors.REASON_REQUIRED);
      else onError(err);
    } finally {
      setBusy(null);
    }
  };

  const tone = gradeTone(current);
  const soft = { good: c.goodSoft, warn: c.warnSoft, bad: c.badSoft }[tone];
  const gain = gainOf(task.points, current, o);

  return (
    <>
      <Sheet visible={!confirming} onClose={onClose} title={o.title(task.title)}>
        <View style={[s.now, { backgroundColor: soft }]}>
          <Txt v="small" weight={700} color="ink">
            {o.now(t.labels.grade[current], gain, several ? attempt.no : null)}
          </Txt>
          {live ? (
            <View style={s.by}>
              <Txt v="meta" color="ink2">
                {o.by(nameOf(live.byMemberId), dates.date(live.createdAt), t.labels.grade[live.fromGrade], t.labels.grade[live.toGrade])}
              </Txt>
              {canUndo ? (
                <>
                  <Txt v="meta" color="ink2" aria-hidden>
                    {' · '}
                  </Txt>
                  <Pressable
                    onPress={undo}
                    disabled={busy !== null}
                    role="button"
                    aria-busy={busy === 'undo'}
                    hitSlop={8}
                    style={({ pressed }) => [s.undo, (pressed || busy !== null) && { opacity: 0.6 }]}>
                    <Icon name="undo" size={14} color={c.grapeText} />
                    <Txt v="label" size={12.5} color="grapeText">
                      {o.undo}
                    </Txt>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
        <Field label={o.to}>
          <Levels label={o.to} options={options} value={grade} onChange={setGrade} />
        </Field>
        <Field label={o.reason} small={o.reasonSmall} error={reasonError}>
          <Input
            label={o.reason}
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              setReasonError(null);
            }}
            multiline
            maxLength={1000}
            invalid={!!reasonError}
            style={{ minHeight: 80 }}
          />
        </Field>
        <Txt v="meta">{o.hint(notified, newEarned)}</Txt>
        <View style={{ marginTop: 4 }}>
          <Button title={o.submit} block disabled={!grade || busy !== null || !valid} onPress={ask} />
        </View>
      </Sheet>
      <ConfirmSheet
        visible={confirming}
        title={grade ? o.confirmTitle(t.labels.grade[grade]) : ''}
        body={notified ? o.confirmBody(notified) : o.confirmBodyQuiet}
        confirmLabel={o.confirm}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
