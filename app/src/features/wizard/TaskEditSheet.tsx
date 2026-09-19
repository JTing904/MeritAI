import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { DraftView, TaskInput, TaskKind, TaskView } from '@shared/types';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { useDates } from './dates';
import { DateTimeField } from './DateTimeField';
import { ErrorText, Field, Input } from './Field';
import { KindPills } from './KindPicker';
import { parsePoints } from './ManualEditor';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    two: { flexDirection: 'row', gap: 12 },
    // The due date needs more room than the points (「10月30日 23:59」 plus its ✕).
    pointsCol: { flex: 3, minWidth: 0 },
    dueCol: { flex: 5, minWidth: 0 },
    unit: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
    select: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.card,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    options: { borderWidth: 2, borderColor: c.line, borderRadius: 14, overflow: 'hidden' },
    option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, gap: 10 },
  }),
);

type Form = { title: string; kind: TaskKind; points: string; dueAt: string | null; featureId: string | null; description: string };

/**
 * 改任务 / 加一个任务 (EditTask mockup): name, kind, points, optional due date, feature, description.
 * Saves straight to the draft and hands back the updated DraftView.
 */
export function TaskEditSheet({
  draft,
  task,
  featureId,
  onClose,
  onSaved,
}: {
  draft: DraftView;
  /** Null adds a new task. */
  task: TaskView | null;
  /** Feature for a new task added from a feature card. */
  featureId?: string | null;
  onClose: () => void;
  onSaved: (d: DraftView) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const w = t.wizard.task;
  const { request } = useSession();
  const { show } = useToast();
  const { deadline, timezone: tz, id } = draft.basics;
  const dates = useDates(tz);

  const [form, setForm] = useState<Form>({
    title: task?.title ?? '',
    kind: task?.kind ?? 'DOC',
    points: task ? formatPoints(task.points) : '10',
    dueAt: task?.dueAt ?? null,
    featureId: task ? task.featureId : (featureId ?? null),
    description: task?.description ?? '',
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const points = parsePoints(form.points);
  const titleError = tried && !form.title.trim() ? t.wizard.manual.titleMissing : null;
  const pointsError = tried && points === null ? t.wizard.manual.pointsInvalid : null;
  const features = [...draft.features].sort((a, b) => a.order - b.order);
  const featureName = features.find((f) => f.id === form.featureId)?.name ?? w.featureNone;

  const save = async () => {
    setTried(true);
    if (!form.title.trim() || points === null) return;
    const input: TaskInput = {
      title: form.title.trim(),
      kind: form.kind,
      points,
      dueAt: form.dueAt,
      description: form.description.trim() || null,
      featureId: form.featureId,
      milestoneId: task?.milestoneId ?? null,
    };
    // PATCH only what changed, so an untouched field never trips a rule it already passed.
    const patch: Partial<TaskInput> = {};
    if (task) {
      if (input.title !== task.title) patch.title = input.title;
      if (input.kind !== task.kind) patch.kind = input.kind;
      if (input.points !== task.points) patch.points = input.points;
      if (input.dueAt !== task.dueAt) patch.dueAt = input.dueAt;
      if (input.description !== task.description) patch.description = input.description;
      if (input.featureId !== task.featureId) patch.featureId = input.featureId;
      if (Object.keys(patch).length === 0) return onClose();
    }
    setBusy('save');
    try {
      const next = task
        ? await request<DraftView>(`/projects/${id}/tasks/${task.id}`, { method: 'PATCH', body: patch })
        : await request<DraftView>(`/projects/${id}/tasks`, { method: 'POST', body: input });
      onSaved(next);
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DUE_AFTER_DEADLINE') setDueError(t.errors[code]);
      else show(t.errors[code]);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!task) return;
    setBusy('delete');
    try {
      onSaved(await request<DraftView>(`/projects/${id}/tasks/${task.id}`, { method: 'DELETE' }));
      onClose();
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible onClose={busy ? () => {} : onClose} title={task ? w.editTitle : w.addTitle}>
      <Field label={w.name} error={titleError}>
        <Input label={w.name} value={form.title} onChangeText={(v) => set('title', v)} maxLength={120} invalid={!!titleError} />
      </Field>

      <Field label={w.kind}>
        <KindPills value={form.kind} onChange={(k) => set('kind', k)} label={w.kind} />
      </Field>

      <View style={s.two}>
        <View style={s.pointsCol}>
          <Field label={w.points}>
            <View>
              <Input
                label={w.points}
                value={form.points}
                onChangeText={(v) => set('points', v)}
                keyboardType="decimal-pad"
                maxLength={5}
                invalid={!!pointsError}
                style={{ paddingRight: 40 }}
              />
              <View style={s.unit} pointerEvents="none">
                <Txt v="body" color="muted">
                  {t.wizard.manual.unit}
                </Txt>
              </View>
            </View>
          </Field>
        </View>
        <View style={s.dueCol}>
          <Field label={w.due} small={w.dueSmall}>
            <DateTimeField
              value={form.dueAt}
              onChange={(v) => {
                setDueError(null);
                set('dueAt', v);
              }}
              tz={tz}
              mode="datetime"
              max={deadline}
              label={w.due}
              placeholder={w.duePlaceholder}
              format={dates.dateTime}
              clearLabel={t.wizard.manual.clearDue}
              invalid={!!dueError}
            />
          </Field>
        </View>
      </View>
      {pointsError ? <ErrorText>{pointsError}</ErrorText> : null}
      {dueError ? <ErrorText>{dueError}</ErrorText> : null}
      <Txt v="meta">{w.dueHint(dates.date(deadline))}</Txt>

      {features.length > 0 ? (
        <Field label={w.feature}>
          <Pressable
            onPress={() => setFeaturesOpen((o) => !o)}
            role="button"
            aria-label={`${w.feature}: ${featureName}`}
            aria-expanded={featuresOpen}
            style={s.select}>
            <Txt v="body" style={{ flex: 1 }} numberOfLines={1}>
              {featureName}
            </Txt>
            <Txt v="body" color="muted" aria-hidden>
              ▾
            </Txt>
          </Pressable>
          {featuresOpen ? (
            <View style={s.options} role="radiogroup" aria-label={w.feature}>
              {[...features.map((f) => ({ id: f.id as string | null, name: f.name })), { id: null, name: w.featureNone }].map((f) => {
                const on = f.id === form.featureId;
                return (
                  <Pressable
                    key={f.id ?? 'none'}
                    role="radio"
                    aria-checked={on}
                    onPress={() => {
                      set('featureId', f.id);
                      setFeaturesOpen(false);
                    }}
                    collapsable={false}
                    style={({ pressed }) => [s.option, { backgroundColor: pressed ? c.card2 : c.card }]}>
                    <Txt v="text" weight={on ? 700 : 400} style={{ flex: 1 }}>
                      {f.name}
                    </Txt>
                    {on ? <Icon name="check" size={16} color={c.grapeText} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Field>
      ) : null}

      <Field label={w.desc} small={w.descSmall}>
        <Input
          label={w.desc}
          value={form.description}
          onChangeText={(v) => set('description', v)}
          multiline
          maxLength={2000}
          style={{ minHeight: 84 }}
        />
      </Field>

      <View style={{ gap: 10, marginTop: 4 }}>
        <Button title={task ? w.save : w.add} block loading={busy === 'save'} disabled={busy === 'delete'} onPress={save} />
        {task ? (
          <Button title={w.delete} kind="danger" block loading={busy === 'delete'} disabled={busy === 'save'} onPress={remove} />
        ) : null}
      </View>
    </Sheet>
  );
}
