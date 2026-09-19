import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MAX_EVIDENCE_ITEMS } from '@shared/constants';
import { formatPoints } from '@shared/planning';
import type { GradeInput, GradeOutsideInput, ProjectView, TaskDetail } from '@shared/types';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Toggle } from '@/components/Controls';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useLocalDates } from '@/features/project/parts';
import { EvidenceRow } from '@/features/task/EvidenceRow';
import { openEvidence } from '@/features/task/open';
import { Field, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { dateTimeLabel } from '@/lib/time';
import { makeStyles, useTheme } from '@/theme';
import { effectiveDue, halfPoints, LEADER_GRADES, type LeaderGrade } from './grades';
import { Levels, type LevelOption } from './Levels';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4 },
    rows: { gap: 6 },
    // The mockup's `.empty-ev`: a muted card-2 strip.
    empty: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 15,
      backgroundColor: c.card2,
    },
    setRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
  }),
);

export type GradeSheetProps = {
  project: ProjectView;
  detail: TaskDetail;
  /** pending: 评级 the PENDING attempt (board 10). outside: 代为完成并评级 (board 11). */
  mode: 'pending' | 'outside';
  onClose: () => void;
  /** The TaskDetail the write returned. */
  onChange: (detail: TaskDetail) => void;
  onError: (err: unknown) => void;
};

/** 优秀 / 合格 → 拿满, 拿一半 → half, 不通过 → 0 (the sub-line under each level). */
export function levelOptions(points: number, g: Messages['grade']): LevelOption[] {
  const pts = formatPoints(points);
  const sub: Record<LeaderGrade, string> = { EXCELLENT: g.full(pts), PASS: g.full(pts), HALF: g.half(halfPoints(points)), FAIL: g.fail };
  return LEADER_GRADES.map((grade) => ({ grade, sub: sub[grade] }));
}

/**
 * The leader's grading sheet (M4 spec §10). `pending` grades the handed-in attempt; `outside` marks the task
 * done for an owner who gave the evidence outside the app (组长代为完成), after the leader turns the toggle on.
 * It closes itself when a reload shows the attempt is gone (withdrawn, graded elsewhere) or the task can't
 * be completed that way any more.
 */
export function GradeSheet({ detail, mode, onClose, onChange, onError }: GradeSheetProps) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const g = t.grade;
  const { request } = useSession();
  const { show } = useToast();
  const dates = useLocalDates();

  const [grade, setGrade] = useState<LeaderGrade>('PASS');
  const [note, setNote] = useState('');
  const [outsideNote, setOutsideNote] = useState('');
  const [handedOver, setHandedOver] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { task, owner, current } = detail;
  const pending = current?.status === 'PENDING' ? current : null;
  const valid =
    detail.project.viewerRole === 'LEADER' &&
    (mode === 'pending' ? pending !== null : pending === null && task.status !== 'DONE' && owner !== null && task.kind !== 'MEETING');
  useEffect(() => {
    if (!valid && !busy) onClose();
  }, [valid, busy, onClose]);

  // Nobody hears about it when it's the leader's own task or the owner has left.
  const notified = owner !== null && owner.active && owner.memberId !== detail.project.viewerMemberId ? owner.name : null;
  const ownerName = owner?.name ?? t.project.task.noOwner;
  const due = dates.date(effectiveDue(detail));
  const needsReason = grade === 'HALF' || grade === 'FAIL';

  const open = (e: TaskDetail['attempts'][number]['evidence'][number]) => void openEvidence(request, e, onError, () => show(t.task.evidence.unsafeLink));

  const submit = async () => {
    if (busy) return;
    const trimmed = note.trim();
    if (needsReason && !trimmed) {
      setReasonError(t.errors.GRADE_REASON_REQUIRED);
      return;
    }
    const base = `/projects/${encodeURIComponent(detail.project.id)}/tasks/${encodeURIComponent(task.id)}`;
    setBusy(true);
    try {
      let next: TaskDetail;
      if (mode === 'pending') {
        const body: GradeInput = { grade, note: trimmed || null };
        next = await request<TaskDetail>(`${base}/grade`, { method: 'POST', body });
      } else {
        const body: GradeOutsideInput = { grade, note: trimmed || null, outsideNote: outsideNote.trim() || null };
        next = await request<TaskDetail>(`${base}/grade-outside`, { method: 'POST', body });
      }
      onChange(next);
      if (mode === 'pending') show(notified ? g.done(notified) : g.doneQuiet);
      else show(notified ? g.outside.done(notified) : g.outside.doneQuiet);
      onClose();
    } catch (err) {
      if (errorCode(err) === 'GRADE_REASON_REQUIRED') setReasonError(t.errors.GRADE_REASON_REQUIRED);
      else onError(err);
    } finally {
      setBusy(false);
    }
  };

  const reasonField = (
    <Field label={g.reason} small={g.reasonSmall} error={reasonError}>
      <Input
        label={g.reason}
        value={note}
        onChangeText={(v) => {
          setNote(v);
          setReasonError(null);
        }}
        placeholder={g.reasonPlaceholder}
        multiline
        maxLength={1000}
        invalid={!!reasonError}
        style={{ minHeight: mode === 'pending' ? 80 : 64 }}
      />
    </Field>
  );

  const levels = (
    <Field label={g.level}>
      <Levels
        label={g.level}
        options={levelOptions(task.points, g)}
        value={grade}
        onChange={(v) => {
          setGrade(v);
          setReasonError(null);
        }}
      />
    </Field>
  );

  // Draft items (outside mode) or the handed-in ones (pending): everyone can open them.
  const evidence = (mode === 'pending' ? pending : current)?.evidence ?? [];
  const rows =
    evidence.length > 0 ? (
      <View style={s.rows}>
        {evidence.map((e) => (
          <EvidenceRow key={e.id} evidence={e} onOpen={() => open(e)} />
        ))}
      </View>
    ) : null;

  return (
    <Sheet visible onClose={onClose} title={g.title(task.title)}>
      {mode === 'pending' ? (
        <>
          <View style={s.line}>
            <Txt v="small" color="ink2">
              {g.line(ownerName, pending?.submittedAt ? dateTimeLabel(pending.submittedAt, t.labels.when) : '', evidence.length, due)}
            </Txt>
            {pending?.late ? <Chip tone="bad">{g.late}</Chip> : null}
          </View>
          {rows}
          {levels}
          {reasonField}
          <View style={{ marginTop: 4 }}>
            <Button title={g.submit} block loading={busy} disabled={!valid} onPress={submit} />
          </View>
          <Txt v="meta" center>
            {notified ? g.hint(notified) : g.hintQuiet}
          </Txt>
        </>
      ) : (
        <>
          <Txt v="small" color="ink2">
            {g.outside.line(ownerName, due)}
          </Txt>
          <View style={s.empty}>
            <Icon name="file" size={20} color={c.muted} />
            <Txt v="small" color="muted" style={{ flex: 1 }}>
              {g.outside.empty(evidence.length, detail.storage.maxItems || MAX_EVIDENCE_ITEMS)}
            </Txt>
          </View>
          {rows}
          <View style={s.setRow}>
            <View style={s.grow}>
              <Txt v="text">{g.outside.toggle}</Txt>
              <Txt v="meta" size={12}>
                {g.outside.toggleSmall}
              </Txt>
            </View>
            <Toggle value={handedOver} onChange={setHandedOver} label={g.outside.toggle} />
          </View>
          <Field label={g.outside.note} small={g.outside.noteSmall}>
            <Input
              label={g.outside.note}
              value={outsideNote}
              onChangeText={setOutsideNote}
              multiline
              maxLength={300}
              style={{ minHeight: 56 }}
            />
          </Field>
          {levels}
          {reasonField}
          <View style={{ marginTop: 4 }}>
            <Button title={g.outside.submit} block loading={busy} disabled={!handedOver || !valid} onPress={submit} />
          </View>
          <Txt v="meta" center>
            {notified ? g.outside.hint(notified) : g.outside.hintQuiet}
          </Txt>
        </>
      )}
    </Sheet>
  );
}

