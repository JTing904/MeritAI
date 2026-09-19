import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ProjectView, TaskInput, TaskKind } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { DateTimeField } from '@/features/wizard/DateTimeField';
import { ErrorText, Field, Input } from '@/features/wizard/Field';
import { KindPills } from '@/features/wizard/KindPicker';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';
import { InlineText, packageById } from './parts';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    two: { flexDirection: 'row', gap: 12 },
    // The due date needs more room than the points (「10月30日 23:59」 plus its ✕), as in the wizard.
    pointsCol: { flex: 3, minWidth: 0 },
    dueCol: { flex: 5, minWidth: 0 },
    unit: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center', pointerEvents: 'none' },
  }),
);

/** 0.1–99.9 分 typed → tenths (1–999); null when it isn't a number in range. */
export function parseActivePoints(text: string): number | null {
  const v = text.trim().replace(',', '.').replace(/分|pts?$/i, '').trim();
  if (!/^\d{1,2}(\.\d)?$/.test(v)) return null;
  const tenths = Math.round(Number(v) * 10);
  return tenths >= 1 && tenths <= 999 ? tenths : null;
}

/**
 * 加一个任务 on an ACTIVE project (AddTaskActive mockup). The server puts it into the lightest package,
 * gives it exactly the typed points and rescales every other task so the total stays 100.
 */
export function AddTaskSheet({
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
  const s = useStyles();
  const { t } = useI18n();
  const a = t.project.addTask;
  const { request } = useSession();
  const { show } = useToast();
  const { id, timezone: tz, deadline } = project.basics;
  const dates = useDates(tz);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TaskKind>('DOC');
  const [pointsText, setPointsText] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);

  const points = parseActivePoints(pointsText);
  const nameError = tried && !title.trim() ? a.nameMissing : null;
  const pointsError = tried && points === null ? a.pointsInvalid : null;
  const lightest = packageById(project, project.lightestPackageId);

  const add = async () => {
    setTried(true);
    if (!title.trim() || points === null || busy) return;
    const input: TaskInput = { title: title.trim(), kind, points, dueAt };
    setBusy(true);
    try {
      const view = await request<ProjectView>(`/projects/${id}/tasks`, { method: 'POST', body: input });
      onChange(view);
      show(a.added);
      onClose();
    } catch (err) {
      if (errorCode(err) === 'DUE_AFTER_DEADLINE') setDueError(t.errors.DUE_AFTER_DEADLINE);
      else onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={busy ? () => {} : onClose} title={a.title}>
      <Field label={a.name} error={nameError}>
        <Input label={a.name} value={title} onChangeText={setTitle} maxLength={120} invalid={!!nameError} />
      </Field>

      <Field label={a.kind}>
        <KindPills value={kind} onChange={setKind} label={a.kind} />
      </Field>

      <View style={s.two}>
        <View style={s.pointsCol}>
          <Field label={a.points}>
            <View>
              <Input
                label={a.points}
                value={pointsText}
                onChangeText={setPointsText}
                keyboardType="decimal-pad"
                maxLength={4}
                invalid={!!pointsError}
                style={{ paddingRight: 40 }}
              />
              <View style={s.unit}>
                <Txt v="body" color="muted">
                  {a.unit}
                </Txt>
              </View>
            </View>
          </Field>
        </View>
        <View style={s.dueCol}>
          <Field label={a.due} small={a.dueSmall}>
            <DateTimeField
              value={dueAt}
              onChange={(v) => {
                setDueError(null);
                setDueAt(v);
              }}
              tz={tz}
              mode="datetime"
              max={deadline}
              label={a.due}
              placeholder={a.duePlaceholder}
              format={dates.dateTime}
              clearLabel={a.clearDue}
              invalid={!!dueError}
            />
          </Field>
        </View>
      </View>
      {pointsError ? <ErrorText>{pointsError}</ErrorText> : null}
      {dueError ? <ErrorText>{dueError}</ErrorText> : null}

      <InlineText parts={a.where(lightest?.index ?? null)} v="small" color="ink2" />

      <View style={{ marginTop: 4 }}>
        <Button title={a.add} block loading={busy} onPress={add} />
      </View>
    </Sheet>
  );
}
