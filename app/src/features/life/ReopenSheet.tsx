import { useState } from 'react';
import { View } from 'react-native';
import { projectTag } from '@shared/format';
import type { ProjectView, ReopenInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { DatePickerSheet } from '@/features/wizard/DatePickerSheet';
import { Field, Hint } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { appNow } from '@/lib/lifecycle';
import { useSession } from '@/lib/session';
import { DateBox } from './DateBox';
import { endOfDayAfter } from './dates';

/** A passed deadline is replaced by one this many days out (23:59), which the leader can change. */
const DEFAULT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 重新打开 (ReopenSheet mockup; leader, ENDED): when the deadline has passed a new one (after today) is
 * required; otherwise the date row is optional and starts from the current deadline. Mount it to open it.
 */
export function ReopenSheet({
  project,
  onClose,
  onChange,
  onError,
}: {
  project: ProjectView;
  onClose: () => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const r = t.life.reopen;
  const { request } = useSession();
  const { show } = useToast();
  const b = project.basics;
  const tz = b.timezone;
  const dates = useDates(tz);
  const tag = projectTag(b.name, b.shortCode);
  const [now] = useState(appNow);
  const passed = new Date(b.deadline).getTime() <= now.getTime();
  // null: keep the current deadline (only while it is still ahead).
  const [picked, setPicked] = useState<string | null>(() => (passed ? endOfDayAfter(now, DEFAULT_DAYS, tz) : null));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = picked ?? b.deadline;
  const tooEarly = picked !== null && new Date(picked).getTime() <= now.getTime();
  const missing = passed && picked === null;
  const fieldError = error ?? (tooEarly ? t.errors.DEADLINE_IN_PAST : null);

  const confirm = async () => {
    if (busy || missing || tooEarly) return;
    setBusy(true);
    try {
      const body: ReopenInput = picked ? { deadline: picked } : {};
      const view = await request<ProjectView>(`/projects/${encodeURIComponent(b.id)}/reopen`, { method: 'POST', body });
      const moved = view.adjustedTasks ?? [];
      onChange(view);
      show(moved.length > 0 ? r.doneMoved(tag, t.wizard.basics.adjusted(moved.map((task) => task.title))) : r.done(tag));
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DEADLINE_REQUIRED' || code === 'DEADLINE_IN_PAST' || code === 'DUE_AFTER_DEADLINE') setError(t.errors[code]);
      else {
        onError(err);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const small = passed || picked !== null ? r.after : r.unchanged;

  return (
    <Sheet visible onClose={onClose} title={r.title}>
      <Txt v="body" weight={800} size={17}>
        {r.heading(tag)}
      </Txt>
      <Txt v="text" color="ink2">
        {passed ? r.passed(dates.date(b.deadline)) : r.ahead(dates.long(b.deadline))}
      </Txt>
      <Field label={passed ? r.label : r.labelOptional} error={fieldError}>
        <DateBox
          text={missing ? r.pick : dates.long(shown)}
          small={small}
          change={r.change}
          label={passed ? r.label : r.labelOptional}
          invalid={!!fieldError}
          onPress={() => setPickerOpen(true)}
        />
      </Field>
      <Hint>{r.hint}</Hint>
      <View style={{ gap: 10, marginTop: 6 }}>
        <Button title={r.confirm} block loading={busy} disabled={missing || tooEarly} onPress={confirm} />
        <Button title={t.common.cancel} kind="soft" block onPress={onClose} />
      </View>
      {/* Inside this sheet so it opens on top of it. Tomorrow at the earliest: 「要在今天之后」. */}
      <DatePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={shown}
        onPick={(iso) => {
          setError(null);
          if (iso) setPicked(iso);
        }}
        tz={tz}
        mode="datetime"
        min={new Date(now.getTime() + DAY_MS)}
        presets="project"
      />
    </Sheet>
  );
}
