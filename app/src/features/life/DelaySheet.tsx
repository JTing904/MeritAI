import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DelayInput, TaskDetail } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { effectiveDue } from '@/features/task/model';
import { useDates } from '@/features/wizard/dates';
import { DatePickerSheet } from '@/features/wizard/DatePickerSheet';
import { Field, Hint, NoteBox } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { appNow } from '@/lib/lifecycle';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';
import { DateBox } from './DateBox';
import { daysBetween, endOfDayAfter, plusDays } from './dates';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 2,
      borderColor: c.line,
      backgroundColor: c.card,
      borderRadius: 12,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    chipOn: { borderColor: c.grape, backgroundColor: c.grapeSoft },
  }),
);

/**
 * How many days the task has been held up: the prerequisite's days past its due (0 when it isn't past
 * it, or there is none). The PREREQ_BLOCKED notification passes its own count instead.
 */
export function blockedDaysOf(detail: TaskDetail): number {
  const prereq = detail.prereq;
  if (!prereq || prereq.finished) return 0;
  return Math.max(0, daysBetween(appNow(), prereq.dueAt, detail.project.timezone));
}

/**
 * 一键延后 (DelaySheet mockup; leader, unfinished task): the new due date starts at the current one plus
 * the days blocked (or 1), with chips +1 / +blocked / +7; never past the project deadline. Mount it to open it.
 */
export function DelaySheet({
  detail,
  blockedDays,
  onClose,
  onChange,
  onError,
}: {
  detail: TaskDetail;
  /** From the notification; recomputed from the prerequisite otherwise. */
  blockedDays?: number;
  onClose: () => void;
  onChange: (detail: TaskDetail) => void;
  onError: (err: unknown) => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const k = t.life.delay;
  const { request } = useSession();
  const { show } = useToast();
  const tz = detail.project.timezone;
  const dates = useDates(tz);
  const task = detail.task;
  const deadline = detail.project.deadline;
  const deadlineMs = new Date(deadline).getTime();
  // The due date the sheet opened with (a reload behind it must not move the base under the chips).
  const [from] = useState(() => effectiveDue(detail));
  const fromMs = new Date(from).getTime();
  const [blocked] = useState(() => (blockedDays && blockedDays > 0 ? blockedDays : blockedDaysOf(detail)));
  const atDeadline = fromMs >= deadlineMs;

  const clamp = (iso: string) => (new Date(iso).getTime() > deadlineMs ? deadline : iso);
  // An overdue task counts its +N from today (23:59), so the new date is never already past.
  const [openedAt] = useState(appNow);
  const overdue = fromMs <= openedAt.getTime();
  const shift = (n: number) => (overdue ? endOfDayAfter(openedAt, n, tz) : plusDays(from, n, tz));
  const shiftDays = (iso: string) => daysBetween(iso, overdue ? openedAt : from, tz);
  const chips = useMemo(() => [...new Set([1, blocked, 7].filter((n) => n > 0))].sort((a, b) => a - b), [blocked]);
  const [picked, setPicked] = useState<string>(() => clamp(shift(blocked > 0 ? blocked : 1)));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const later = daysBetween(picked, from, tz);
  const notLater = new Date(picked).getTime() <= fromMs;
  const inPast = new Date(picked).getTime() <= appNow().getTime();
  const prereq = detail.prereq && !detail.prereq.finished ? detail.prereq : null;
  const self = detail.owner?.memberId === detail.project.viewerMemberId;
  const notified = detail.owner && detail.owner.active && !self ? detail.owner.name : null;
  const fieldError =
    error ?? (atDeadline ? null : notLater ? t.errors.DELAY_NOT_LATER : inPast ? t.errors.DELAY_IN_PAST : null);

  const confirm = async () => {
    if (busy || notLater || inPast || atDeadline) return;
    setBusy(true);
    try {
      const body: DelayInput = { dueAt: picked };
      const next = await request<TaskDetail>(
        `/projects/${encodeURIComponent(detail.project.id)}/tasks/${encodeURIComponent(task.id)}/delay`,
        { method: 'POST', body },
      );
      onChange(next);
      show(k.done(dates.date(picked)));
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DELAY_NOT_LATER' || code === 'DELAY_IN_PAST' || code === 'DUE_AFTER_DEADLINE') setError(t.errors[code]);
      else {
        onError(err);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={k.title}>
      <Txt v="body" weight={800} size={17}>
        {k.heading(task.title)}
      </Txt>
      {prereq ? (
        <NoteBox tone="warn">
          {k.blocked(prereq.title, prereq.ownerName, blocked, detail.owner?.name ?? null, task.title)}
        </NoteBox>
      ) : null}

      {atDeadline ? (
        <NoteBox tone="warn">{k.atDeadline}</NoteBox>
      ) : (
        <>
          <Field label={k.label(task.title)} error={fieldError}>
            <DateBox
              text={dates.long(picked)}
              small={later > 0 ? k.was(dates.date(from), later) : dates.date(from)}
              change={k.change}
              label={k.label(task.title)}
              invalid={!!fieldError}
              onPress={() => setPickerOpen(true)}
            />
          </Field>
          <View style={s.chips} role="group" aria-label={k.chips}>
            {chips.map((n) => {
              const target = shift(n);
              const on = picked === clamp(target) && shiftDays(picked) === n;
              const beyond = new Date(target).getTime() > deadlineMs;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setError(null);
                    setPicked(clamp(target));
                  }}
                  disabled={beyond}
                  role="button"
                  aria-pressed={on}
                  aria-disabled={beyond}
                  style={[s.chip, on && s.chipOn, beyond && { opacity: 0.45 }]}>
                  <Txt v="small" size={13} weight={700} color={on ? 'grapeText' : 'ink2'}>
                    {n === blocked ? k.plusBlocked(n) : k.plus(n)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <Hint>{k.hint(dates.date(deadline), notified)}</Hint>
        </>
      )}

      <View style={{ gap: 10, marginTop: 6 }}>
        {atDeadline ? null : (
          <Button title={k.confirm(dates.date(picked))} block loading={busy} disabled={notLater || inPast} onPress={confirm} />
        )}
        <Button title={k.cancel} kind="soft" block onPress={onClose} />
      </View>

      <DatePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={picked}
        onPick={(iso) => {
          setError(null);
          if (iso) setPicked(clamp(iso));
        }}
        tz={tz}
        mode="datetime"
        min={new Date(fromMs)}
        max={deadline}
        presets="task"
      />
    </Sheet>
  );
}
