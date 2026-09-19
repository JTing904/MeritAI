import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ProjectBasics, ProjectBasicsInput, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { DateTimeField } from '@/features/wizard/DateTimeField';
import { Field, Hint, Input } from '@/features/wizard/Field';
import { ZoneSheet } from '@/features/wizard/ZoneSheet';
import { toIso, toWall } from '@/features/wizard/zoned';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';

type Form = {
  name: string;
  shortCode: string;
  groupLabel: string;
  courseName: string;
  deadline: string;
  timezone: string;
};

type Edit = Pick<ProjectBasicsInput, 'name' | 'shortCode' | 'groupLabel' | 'courseName' | 'deadline' | 'timezone'>;

const styles = StyleSheet.create({
  two: { flexDirection: 'row', gap: 12 },
  half: { flex: 1, minWidth: 0 },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});

// 「改」 is one line of small text: widen its touch area to about 44px (as in the wizard's step 1).
const ZONE_HIT = { top: 6, bottom: 20, left: 12, right: 12 };

const formOf = (b: ProjectBasics): Form => ({
  name: b.name,
  shortCode: b.shortCode ?? '',
  groupLabel: b.groupLabel ?? '',
  courseName: b.courseName ?? '',
  deadline: b.deadline,
  timezone: b.timezone,
});

const orNull = (v: string) => v.trim() || null;

/** Task titles named in a toast: long ones are cut so the list stays short (as in the wizard). */
const shortTitle = (title: string) => {
  const chars = [...title];
  return chars.length > 20 ? `${chars.slice(0, 19).join('')}…` : title;
};

/**
 * 编辑 on 项目信息 (leader): name, the three tag fields, the deadline and the project time zone.
 * Team size and 「只管理」 can't change once the plan is confirmed, so they aren't here.
 * Mount it to open it: the form starts from the project as it is at that moment.
 */
export function ProjectInfoSheet({
  project,
  onClose,
  onSaved,
  onError,
}: {
  project: ProjectView;
  onClose: () => void;
  onSaved: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const w = t.members.info;
  const { request } = useSession();
  const { show } = useToast();
  // A background reload while editing must not wipe what was typed: the form keeps its own copy.
  const [initial] = useState<Form>(() => formOf(project.basics));
  const [form, setForm] = useState<Form>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [serverDeadlineError, setServerDeadlineError] = useState<string | null>(null);
  const dates = useDates(form.timezone);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const deadlineChanged = form.deadline !== initial.deadline;
  const errors = {
    name: form.name.trim() ? null : w.nameRequired,
    // An unchanged deadline may already be past (the project is running late): only a new one must be ahead.
    deadline:
      deadlineChanged && new Date(form.deadline).getTime() <= Date.now() ? t.errors.DEADLINE_IN_PAST : serverDeadlineError,
  };
  const valid = !errors.name && !errors.deadline;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const shown = (key: keyof typeof errors) => (tried || (key === 'deadline' && deadlineChanged) ? errors[key] : null);

  const onZone = (tz: string) =>
    setForm((f) => ({
      ...f,
      timezone: tz,
      // Keep the wall-clock time the leader sees ("11月6日 23:59") in the new zone.
      deadline: toIso(toWall(f.deadline, f.timezone), tz),
    }));

  const save = async () => {
    setTried(true);
    if (!valid || busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    const body: Edit = {
      name: form.name.trim(),
      shortCode: orNull(form.shortCode),
      groupLabel: orNull(form.groupLabel),
      courseName: orNull(form.courseName),
      deadline: form.deadline,
      timezone: form.timezone,
    };
    try {
      const view = await request<ProjectView>(`/projects/${encodeURIComponent(project.basics.id)}`, { method: 'PATCH', body });
      // A new deadline re-spreads the scheduled due dates and pulls later ones in: say which moved.
      const moved = view.adjustedTasks ?? [];
      onSaved(view);
      show(moved.length > 0 ? w.savedMoved(t.wizard.basics.adjusted(moved.map((task) => shortTitle(task.title)))) : w.saved);
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DEADLINE_IN_PAST' || code === 'DUE_AFTER_DEADLINE') setServerDeadlineError(t.errors[code]);
      else {
        onError(err);
        // No longer the leader, or the project is gone: nothing left to edit. Otherwise keep the typing to retry.
        if (code === 'FORBIDDEN' || code === 'NOT_FOUND') onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={w.title}>
      <Field label={w.name} error={shown('name')}>
        <Input
          label={w.name}
          value={form.name}
          onChangeText={(v) => set('name', v)}
          maxLength={80}
          invalid={!!shown('name')}
          returnKeyType="next"
        />
      </Field>

      <View style={styles.two}>
        <View style={styles.half}>
          <Field label={w.shortCode} small={w.optional}>
            <Input
              label={w.shortCode}
              value={form.shortCode}
              onChangeText={(v) => set('shortCode', v)}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
            />
          </Field>
        </View>
        <View style={styles.half}>
          <Field label={w.groupLabel} small={w.optional}>
            <Input label={w.groupLabel} value={form.groupLabel} onChangeText={(v) => set('groupLabel', v)} maxLength={30} />
          </Field>
        </View>
      </View>

      <Field label={w.course} small={w.courseSmall}>
        <Input label={w.course} value={form.courseName} onChangeText={(v) => set('courseName', v)} maxLength={80} />
      </Field>

      <Field
        label={w.deadline}
        error={shown('deadline')}
        hint={
          <View style={styles.zoneRow}>
            <Hint>{`${w.zone(dates.zone())} · `}</Hint>
            <Pressable
              onPress={() => setZoneOpen(true)}
              role="button"
              aria-label={`${w.zoneSheet}: ${w.zoneChange}`}
              hitSlop={ZONE_HIT}>
              <Txt v="meta" weight={700} color="grapeText">
                {w.zoneChange}
              </Txt>
            </Pressable>
            <Hint>{` · ${w.zoneOthers}`}</Hint>
          </View>
        }>
        <DateTimeField
          value={form.deadline}
          onChange={(v) => {
            setServerDeadlineError(null);
            // The field has no clear button, so a value always comes back; keep the old one otherwise.
            if (v) set('deadline', v);
          }}
          tz={form.timezone}
          mode="datetime"
          label={w.deadline}
          placeholder={w.deadlinePlaceholder}
          format={dates.long}
          invalid={!!shown('deadline')}
          onChangeZone={() => setZoneOpen(true)}
        />
      </Field>

      <Button title={w.save} block loading={busy} onPress={save} style={{ marginTop: 6 }} />

      {/* Inside this sheet so the zone list opens on top of it. */}
      <ZoneSheet visible={zoneOpen} value={form.timezone} onClose={() => setZoneOpen(false)} onPick={onZone} />
    </Sheet>
  );
}
