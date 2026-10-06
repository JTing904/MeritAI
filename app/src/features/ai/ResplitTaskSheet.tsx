import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { AiResplitEdit, TaskKind } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { parseActivePoints } from '@/features/project/AddTaskSheet';
import { useDates } from '@/features/wizard/dates';
import { DateTimeField } from '@/features/wizard/DateTimeField';
import { ErrorText, Field, Input } from '@/features/wizard/Field';
import { KindPills } from '@/features/wizard/KindPicker';
import { useI18n } from '@/i18n';
import { makeStyles } from '@/theme';
import type { ReviewTask } from './resplitPlan';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    two: { flexDirection: 'row', gap: 12 },
    pointsCol: { flex: 3, minWidth: 0 },
    dueCol: { flex: 5, minWidth: 0 },
    unit: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center', pointerEvents: 'none' },
  }),
);

export type ResplitTaskValues = { title: string; kind: TaskKind; points: number; dueAt: string | null };

/**
 * 改任务 / 加一个任务 on the re-split review (nothing is saved until 「确认，换成新任务」): name, kind, points
 * (0.1–99.9; rescaled with the rest afterwards) and due date. `task` null adds one. `onSave` gets only what
 * changed for an AI task; the web deletes from here (there is no swipe).
 */
export function ResplitTaskSheet({
  task,
  tz,
  deadline,
  onClose,
  onSave,
  onAdd,
  onDelete,
}: {
  task: ReviewTask | null;
  tz: string;
  deadline: string;
  onClose: () => void;
  /** An AI task's changes (only what changed); a task the leader added takes `values` whole. */
  onSave: (edit: AiResplitEdit, values: ResplitTaskValues) => void;
  onAdd: (values: ResplitTaskValues) => void;
  onDelete: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const a = t.project.addTask;
  const r = t.ai.resplit.edit;
  const dates = useDates(tz);
  const [title, setTitle] = useState(task?.title ?? '');
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'DOC');
  const startPoints = task ? formatPoints(task.points) : '';
  const [pointsText, setPointsText] = useState(startPoints);
  const [dueAt, setDueAt] = useState<string | null>(task?.dueAt ?? null);
  const [tried, setTried] = useState(false);

  const points = parseActivePoints(pointsText);
  const nameError = tried && !title.trim() ? a.nameMissing : null;
  const pointsError = tried && points === null ? a.pointsInvalid : null;
  // The AI's tasks always have a date; only the leader's own may go without one.
  const clearable = !task || task.byLeader;

  const save = () => {
    setTried(true);
    if (!title.trim() || points === null) return;
    if (!task) onAdd({ title: title.trim(), kind, points, dueAt });
    else {
      const edit: AiResplitEdit = {};
      if (title.trim() !== task.title) edit.title = title.trim();
      if (kind !== task.kind) edit.kind = kind;
      // Untouched points stay the proposal's own weight (the shown value is already rescaled).
      if (pointsText !== startPoints) edit.points = points;
      if (dueAt && dueAt !== task.dueAt) edit.dueAt = dueAt;
      onSave(edit, { title: title.trim(), kind, points, dueAt });
    }
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title={task ? r.editTitle : r.addTitle}>
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
          <Field label={a.due} small={clearable ? a.dueSmall : undefined}>
            <DateTimeField
              value={dueAt}
              onChange={setDueAt}
              tz={tz}
              mode="datetime"
              max={deadline}
              label={a.due}
              placeholder={a.duePlaceholder}
              format={dates.dateTime}
              clearLabel={clearable ? a.clearDue : undefined}
            />
          </Field>
        </View>
      </View>
      {pointsError ? <ErrorText>{pointsError}</ErrorText> : null}
      <Txt v="meta">{r.hint}</Txt>
      <View style={{ gap: 10, marginTop: 4 }}>
        <Button title={task ? t.wizard.task.save : a.add} block onPress={save} />
        {task ? (
          <Button
            title={r.delete}
            kind="danger"
            block
            onPress={() => {
              onDelete();
              onClose();
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}
