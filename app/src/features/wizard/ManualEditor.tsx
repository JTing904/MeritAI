import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { TaskInput, TaskKind, TaskView } from '@shared/types';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { fontStyle } from '@/theme/fonts';
import { useDates } from './dates';
import { DateTimeField } from './DateTimeField';
import { ErrorText, Input } from './Field';
import { KindChip, KindSheet } from './KindPicker';
import { DashedLine, TextLink } from './parts';

/** One manual-mode task. Points stay as typed text until saved. */
export type ManualRow = {
  key: string;
  title: string;
  kind: TaskKind;
  points: string;
  dueAt: string | null;
  // Carried through unchanged so replacing the plan keeps them.
  description: string | null;
  featureId: string | null;
  milestoneId: string | null;
};

let seq = 0;
const newKey = () => `row-${Date.now()}-${seq++}`;

/** Tenths → the text a leader would type: 200 → "20", 125 → "12.5". */
export const pointsText = (tenths: number) => (tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1));

/** "12.5" → 125; null unless 0.1–100 with at most one decimal. */
export function parsePoints(text: string): number | null {
  const v = text.trim().replace(',', '.').replace(/分|pts?$/i, '').trim();
  if (!/^\d{1,3}(\.\d)?$/.test(v)) return null;
  const tenths = Math.round(Number(v) * 10);
  return tenths >= 1 && tenths <= 1000 ? tenths : null;
}

export const rowsFromTasks = (tasks: TaskView[]): ManualRow[] =>
  [...tasks]
    .sort((a, b) => a.order - b.order)
    .map((task) => ({
      key: task.id,
      title: task.title,
      kind: task.kind,
      points: pointsText(task.points),
      dueAt: task.dueAt,
      description: task.description,
      featureId: task.featureId,
      milestoneId: task.milestoneId,
    }));

export const blankRow = (title = ''): ManualRow => ({
  key: newKey(),
  title,
  kind: 'DOC',
  points: '10',
  dueAt: null,
  description: null,
  featureId: null,
  milestoneId: null,
});

export type ManualResult = { error: string; tasks?: undefined } | { error?: undefined; tasks: TaskInput[] };

/** Validation for 下一步: returns the error text, or the tasks to save. */
export function manualTasks(rows: ManualRow[], m: { titleMissing: string; pointsInvalid: string; empty: string }): ManualResult {
  if (rows.length === 0) return { error: m.empty };
  if (rows.some((r) => !r.title.trim())) return { error: m.titleMissing };
  if (rows.some((r) => parsePoints(r.points) === null)) return { error: m.pointsInvalid };
  const tasks: TaskInput[] = rows.map((r) => ({
    title: r.title.trim(),
    kind: r.kind,
    points: parsePoints(r.points)!,
    dueAt: r.dueAt,
    description: r.description,
    featureId: r.featureId,
    milestoneId: r.milestoneId,
  }));
  return { tasks };
}

export const manualTotal = (rows: ManualRow[]) => rows.reduce((sum, r) => sum + (parsePoints(r.points) ?? 0), 0);

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 20, boxShadow: c.shadow, paddingTop: 4, paddingHorizontal: 16, paddingBottom: 12 },
    task: { gap: 8, paddingVertical: 12 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    mini: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 34,
      paddingHorizontal: 10,
      borderWidth: 2,
      borderRadius: 12,
      backgroundColor: c.card,
    },
    miniInput: { width: 44, padding: 0, textAlign: 'right', fontSize: 13, color: c.ink, ...fontStyle('body', 700) },
    del: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  }),
);

/** Extra touch area that brings the 34px chips of a task row to 44px. */
const HIT_Y = { top: 5, bottom: 5 };

/** Manual mode (Manual mockup): name, kind ▾, points, optional due date and ✕ per task. */
export function ManualEditor({
  rows,
  onChange,
  tz,
  deadline,
  error,
}: {
  rows: ManualRow[];
  onChange: (rows: ManualRow[]) => void;
  tz: string;
  deadline: string;
  error: string | null;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const m = t.wizard.manual;
  const dates = useDates(tz);
  const [kindFor, setKindFor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const pointInputs = useRef(new Map<string, TextInput>());

  const update = (key: string, patch: Partial<ManualRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
      <View style={s.card}>
        {rows.map((row, i) => {
          const n = i + 1;
          const badPoints = parsePoints(row.points) === null;
          return (
            <View key={row.key}>
              {i > 0 && <DashedLine />}
              <View style={s.task}>
                <Input
                  label={m.taskName(n)}
                  value={row.title}
                  onChangeText={(v) => update(row.key, { title: v })}
                  placeholder={m.newTask}
                  maxLength={120}
                  autoFocus={focus === row.key}
                  invalid={!!error && !row.title.trim()}
                />
                <View style={s.meta}>
                  <KindChip value={row.kind} label={m.taskKind(n)} onPress={() => setKindFor(row.key)} />
                  {/* The whole box (not just the digits) focuses the field, so the target is big enough to hit. */}
                  <Pressable
                    onPress={() => pointInputs.current.get(row.key)?.focus()}
                    accessible={false}
                    hitSlop={HIT_Y}
                    style={[s.mini, { borderColor: badPoints ? c.bad : c.line }]}>
                    <TextInput
                      ref={(el) => {
                        if (el) pointInputs.current.set(row.key, el);
                        else pointInputs.current.delete(row.key);
                      }}
                      aria-label={m.taskPoints(n)}
                      aria-invalid={badPoints || undefined}
                      value={row.points}
                      onChangeText={(v) => update(row.key, { points: v })}
                      keyboardType="decimal-pad"
                      maxLength={5}
                      selectTextOnFocus
                      style={s.miniInput}
                    />
                    <Txt v="small" size={13} weight={700}>
                      {m.unit}
                    </Txt>
                  </Pressable>
                  <DateTimeField
                    variant="chip"
                    mode="date"
                    value={row.dueAt}
                    onChange={(v) => update(row.key, { dueAt: v })}
                    tz={tz}
                    max={deadline}
                    label={m.taskDue(n)}
                    placeholder={m.dueNone}
                    format={dates.date}
                    clearLabel={m.clearDue}
                  />
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => onChange(rows.filter((r) => r.key !== row.key))}
                    role="button"
                    aria-label={m.deleteTask(n)}
                    hitSlop={7}
                    collapsable={false}
                    style={({ pressed }) => [s.del, pressed && { backgroundColor: c.card2 }]}>
                    <Icon name="close" size={16} color={c.muted} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}
        <View style={{ paddingTop: rows.length ? 0 : 8 }}>
          <TextLink
            title={m.add}
            size={14}
            onPress={() => {
              const row = blankRow();
              setFocus(row.key);
              onChange([...rows, row]);
            }}
          />
        </View>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <KindSheet
        visible={kindFor !== null}
        onClose={() => setKindFor(null)}
        onPick={(k) => kindFor && update(kindFor, { kind: k })}
      />
    </>
  );
}
