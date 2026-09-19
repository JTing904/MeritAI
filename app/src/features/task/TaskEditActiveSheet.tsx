import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { ProjectView, TaskKind, TaskPatchInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { DateTimeField } from '@/features/wizard/DateTimeField';
import { ErrorText, Field, Input } from '@/features/wizard/Field';
import { KindPills } from '@/features/wizard/KindPicker';
import { parsePoints } from '@/features/wizard/ManualEditor';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { TaskCtx } from './model';

const styles = StyleSheet.create({
  unit: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  locked: { opacity: 0.5 },
});

type Form = { title: string; kind: TaskKind; points: string; dueAt: string | null; description: string };

/**
 * 改任务 for a running project: the leader edits name, type (until evidence was handed in), points (until
 * the task started), due date and description; the owner 改说明 (description only). Sends only what
 * changed; answers with the ProjectView.
 */
export function TaskEditActiveSheet({
  ctx,
  onClose,
  onSaved,
}: {
  ctx: TaskCtx;
  onClose: () => void;
  onSaved: (project: ProjectView) => void;
}) {
  const { t } = useI18n();
  const k = t.task.edit;
  const { request } = useSession();
  const { show } = useToast();
  const { task, project, leader } = ctx;
  const { deadline, timezone: tz } = project.basics;
  const dates = useDates(tz);
  const [form, setForm] = useState<Form>({
    title: task.title,
    kind: task.kind,
    points: formatPoints(task.points),
    dueAt: task.dueAt,
    description: task.description ?? '',
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const kindLocked = task.attemptCount > 0 || task.hasEvidence || task.status === 'REVIEWING';
  const pointsLocked = task.locked;
  const points = parsePoints(form.points);
  const pointsOk = points !== null && points <= 999;
  const titleError = leader && tried && !form.title.trim() ? k.nameMissing : null;
  const pointsError = leader && tried && !pointsLocked && !pointsOk ? k.pointsInvalid : null;

  const save = async () => {
    setTried(true);
    const patch: TaskPatchInput = {};
    const description = form.description.trim() || null;
    if (description !== task.description) patch.description = description;
    if (leader) {
      const title = form.title.trim();
      if (!title || (!pointsLocked && !pointsOk)) return;
      if (title !== task.title) patch.title = title;
      if (!kindLocked && form.kind !== task.kind) patch.kind = form.kind;
      if (!pointsLocked && points !== null && points !== task.points) patch.points = points;
      if (form.dueAt !== task.dueAt) patch.dueAt = form.dueAt;
    }
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try {
      onSaved(await request<ProjectView>(`/projects/${project.basics.id}/tasks/${task.id}`, { method: 'PATCH', body: patch }));
      show(k.saved);
      onClose();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DUE_AFTER_DEADLINE') setDueError(t.errors[code]);
      else ctx.onError(err);
    } finally {
      setBusy(false);
    }
  };

  const description = (
    <Field label={k.desc} small={k.descSmall}>
      <Input
        label={k.desc}
        value={form.description}
        onChangeText={(v) => set('description', v)}
        multiline
        maxLength={2000}
        style={{ minHeight: 84 }}
      />
    </Field>
  );

  return (
    <Sheet visible onClose={onClose} title={leader ? k.title : k.titleDesc}>
      {leader ? (
        <>
          <Field label={k.name} error={titleError}>
            <Input label={k.name} value={form.title} onChangeText={(v) => set('title', v)} maxLength={120} invalid={!!titleError} />
          </Field>
          <Field label={k.kind} hint={kindLocked ? k.kindLocked : undefined}>
            <View
              style={kindLocked && styles.locked}
              pointerEvents={kindLocked ? 'none' : 'auto'}
              aria-disabled={kindLocked}
              {...(kindLocked ? { importantForAccessibility: 'no-hide-descendants' as const } : {})}>
              <KindPills value={form.kind} onChange={(v) => set('kind', v)} label={k.kind} />
            </View>
          </Field>
          <Field label={k.points} error={pointsError} hint={pointsLocked ? k.pointsLocked : undefined}>
            <View>
              <Input
                label={k.points}
                value={form.points}
                onChangeText={(v) => set('points', v)}
                keyboardType="decimal-pad"
                maxLength={5}
                editable={!pointsLocked}
                invalid={!!pointsError}
                style={[{ paddingRight: 40 }, pointsLocked && styles.locked]}
              />
              <View style={styles.unit} pointerEvents="none">
                <Txt v="body" color="muted">
                  {k.unit}
                </Txt>
              </View>
            </View>
          </Field>
          <Field label={k.due} small={k.dueSmall}>
            <DateTimeField
              value={form.dueAt}
              onChange={(v) => {
                setDueError(null);
                set('dueAt', v);
              }}
              tz={tz}
              mode="datetime"
              max={deadline}
              label={k.due}
              placeholder={k.duePlaceholder}
              format={dates.dateTime}
              clearLabel={k.clearDue}
              invalid={!!dueError}
            />
          </Field>
          {dueError ? <ErrorText>{dueError}</ErrorText> : null}
          {description}
        </>
      ) : (
        description
      )}
      <View style={{ marginTop: 4 }}>
        <Button title={k.save} block loading={busy} onPress={save} />
      </View>
    </Sheet>
  );
}
