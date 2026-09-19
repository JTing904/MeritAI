import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { packageCount } from '@shared/planning';
import type { DraftView, ProjectBasicsInput } from '@shared/types';
import { Button } from '@/components/Button';
import { List } from '@/components/Card';
import { Toggle } from '@/components/Controls';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useDates } from './dates';
import { DateTimeField } from './DateTimeField';
import { Field, Hint, Input } from './Field';
import { goStep, wizardHref } from './nav';
import { Stepper } from './Stepper';
import { useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';
import { ZoneSheet } from './ZoneSheet';
import { deviceTimeZone, toIso, toWall } from './zoned';

type Form = {
  name: string;
  shortCode: string;
  groupLabel: string;
  courseName: string;
  deadline: string | null;
  timezone: string;
  teamSize: number;
  leaderManages: boolean;
  repo: string;
};

const styles = StyleSheet.create({
  two: { flexDirection: 'row', gap: 12 },
  half: { flex: 1, minWidth: 0 },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});

// 「改」 is one line of small text: widen its touch area to about 44px, reaching down into the gap
// before the next field rather than up over the deadline input (6px away).
const ZONE_HIT = { top: 6, bottom: 20, left: 12, right: 12 };

function initialForm(draft?: DraftView): Form {
  const b = draft?.basics;
  return {
    name: b?.name ?? '',
    shortCode: b?.shortCode ?? '',
    groupLabel: b?.groupLabel ?? '',
    courseName: b?.courseName ?? '',
    deadline: b?.deadline ?? null,
    timezone: b?.timezone ?? deviceTimeZone(),
    teamSize: b?.teamSize ?? 5,
    leaderManages: b?.leaderManages ?? false,
    repo: b?.repoFullName ?? '',
  };
}

/** "https://github.com/a/b.git" or "a/b" → "a/b"; '' → null; anything else → undefined (invalid). */
export function normalizeRepo(raw: string): string | null | undefined {
  const v = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (!v) return null;
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v) ? v : undefined;
}

const orNull = (v: string) => v.trim() || null;

/** Task titles named in a toast: long ones are cut so the list stays short. */
const shortTitle = (title: string) => {
  const chars = [...title];
  return chars.length > 20 ? `${chars.slice(0, 19).join('')}…` : title;
};

/**
 * Step 1 (New1 mockup). Without a draft it creates one on 下一步 (POST /projects);
 * with one (继续编辑 or 上一步 from step 2) it saves changes (PATCH).
 */
export function BasicsStep({ draft }: { draft?: DraftView }) {
  const { t } = useI18n();
  const w = t.wizard.basics;
  const { request } = useSession();
  const { show } = useToast();
  const initial = useMemo(() => initialForm(draft), [draft]);
  const [form, setForm] = useState<Form>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [serverDeadlineError, setServerDeadlineError] = useState<string | null>(null);
  const dates = useDates(form.timezone);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const repo = normalizeRepo(form.repo);
  const errors = {
    name: form.name.trim() ? null : w.nameRequired,
    deadline: !form.deadline
      ? w.deadlineRequired
      : new Date(form.deadline).getTime() <= Date.now()
        ? t.errors.DEADLINE_IN_PAST
        : serverDeadlineError,
    repo: repo === undefined ? w.repoInvalid : null,
  };
  const valid = !errors.name && !errors.deadline && !errors.repo;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const packages = packageCount(form.teamSize, form.leaderManages);

  const body = (): ProjectBasicsInput => ({
    name: form.name.trim(),
    shortCode: orNull(form.shortCode),
    groupLabel: orNull(form.groupLabel),
    courseName: orNull(form.courseName),
    deadline: form.deadline!,
    timezone: form.timezone,
    teamSize: form.teamSize,
    leaderManages: form.leaderManages,
    repoFullName: repo ?? null,
  });

  /** Creates or updates the draft; returns its id, or null after showing the error. */
  const save = async (draftStep: number): Promise<string | null> => {
    try {
      if (!draft) {
        const created = await request<DraftView>('/projects', { method: 'POST', body: body() });
        return created.basics.id;
      }
      if (dirty || draft.basics.draftStep !== draftStep) {
        const saved = await request<DraftView>(`/projects/${draft.basics.id}`, { method: 'PATCH', body: { ...body(), draftStep } });
        // A new deadline re-spreads the scheduled due dates and pulls later ones in.
        const moved = saved.adjustedTasks ?? [];
        if (moved.length > 0) show(w.adjusted(moved.map((task) => shortTitle(task.title))));
      }
      return draft.basics.id;
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DEADLINE_IN_PAST' || code === 'DUE_AFTER_DEADLINE') setServerDeadlineError(t.errors[code]);
      else show(t.errors[code]);
      return null;
    }
  };

  const next = async () => {
    setTried(true);
    if (!valid) return;
    setBusy(true);
    const id = await save(2);
    setBusy(false);
    if (id) goStep(wizardHref.input(id));
  };

  const close = useWizardClose({
    needsConfirm: draft ? true : dirty,
    copy: { body: draft ? t.wizard.close.bodyDraft : valid ? t.wizard.close.bodySave : t.wizard.close.bodyDiscard },
    beforeLeave: async () => {
      // Keep what was typed when it can be saved; an unsaveable edit leaves the last saved draft as it was.
      if (!valid || (draft && !dirty)) return;
      return (await save(1)) !== null;
    },
  });

  const onZone = (tz: string) =>
    setForm((f) => ({
      ...f,
      timezone: tz,
      // Keep the wall-clock time the leader picked ("11月6日 23:59") in the new zone.
      deadline: f.deadline ? toIso(toWall(f.deadline, f.timezone), tz) : null,
    }));

  // Errors show after the first 下一步, except a picked deadline that is already past (shown at once).
  const shown = (key: keyof typeof errors) => (tried || (key === 'deadline' && form.deadline) ? errors[key] : null);

  return (
    <WizardScreen
      step={1}
      onClose={close.requestClose}
      footer={<Button title={t.wizard.next} block loading={busy} onPress={next} />}>
      <WizardTitle parts={[w.titlePre, { hl: 'mint', text: w.titleHl }]} />

      <Field label={w.name} error={shown('name')}>
        <Input
          label={w.name}
          value={form.name}
          onChangeText={(v) => set('name', v)}
          placeholder={w.namePlaceholder}
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
        small={w.deadlineSmall}
        error={shown('deadline')}
        hint={
          <View style={styles.zoneRow}>
            <Hint>{`${w.zone(dates.zone())} · `}</Hint>
            <Pressable onPress={() => setZoneOpen(true)} role="button" aria-label={`${w.zoneSheet}: ${w.zoneChange}`} hitSlop={ZONE_HIT}>
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
            set('deadline', v);
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

      <Field label={w.teamSize} small={w.teamSizeSmall}>
        <Stepper
          value={form.teamSize}
          min={2}
          max={8}
          onChange={(v) => set('teamSize', v)}
          lessLabel={w.teamLess}
          moreLabel={w.teamMore}
        />
      </Field>

      <List>
        <View style={styles.setRow}>
          <View style={styles.grow}>
            <Txt v="text" weight={700}>
              {w.manageOnly}
            </Txt>
            <Txt v="meta" size={12}>
              {w.manageOnlySub(packageCount(form.teamSize, true))}
            </Txt>
          </View>
          <Toggle label={w.manageOnly} value={form.leaderManages} onChange={(v) => set('leaderManages', v)} />
        </View>
      </List>
      <Hint>{form.leaderManages ? w.packagesHintManage(packages) : w.packagesHint(packages)}</Hint>

      <Field label={w.repo} small={w.repoSmall} error={shown('repo')}>
        <Input
          label={w.repo}
          value={form.repo}
          onChangeText={(v) => set('repo', v)}
          placeholder={w.repoPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={140}
          invalid={!!shown('repo')}
        />
      </Field>

      <ZoneSheet visible={zoneOpen} value={form.timezone} onClose={() => setZoneOpen(false)} onPick={onZone} />
      {close.closeSheet}
    </WizardScreen>
  );
}
