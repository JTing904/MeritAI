import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPoints, formatTotal } from '@shared/planning';
import type { DraftView, ProjectView, SplitLargeInput, TaskView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Icon } from '@/components/Icon';
import { SwipeDelete } from '@/components/SwipeDelete';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { useDates } from './dates';
import { Hint, NoteBox } from './Field';
import { goStep, wizardHref, type PlanFound } from './nav';
import { DashedLine, KindTile, TextLink, TotalChip } from './parts';
import { TaskEditSheet } from './TaskEditSheet';
import { SubLine, useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    grow: { flex: 1, minWidth: 0, gap: 1 },
    wsH: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 2 },
    ms: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tag: { borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: c.ink },
  }),
);

type Editing = { task: TaskView | null; featureId: string | null } | null;
type Group = { key: string; title: string | null; featureId: string | null; tasks: TaskView[] };

/** The plan as 「把大任务拆开」 sees it: which tasks, their points, how many packages. */
const splitKey = (d: DraftView) => `${d.basics.packageCount}|${d.tasks.map((task) => `${task.id}:${task.points}`).join(',')}`;

/** Tasks grouped by feature (features first, in order; loose tasks last), or one flat group. */
function groupTasks(draft: DraftView, otherTitle: string): Group[] {
  const tasks = [...draft.tasks].sort((a, b) => a.order - b.order);
  if (draft.features.length === 0) return [{ key: 'all', title: null, featureId: null, tasks }];
  const groups: Group[] = [...draft.features]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ key: f.id, title: f.name, featureId: f.id, tasks: tasks.filter((t) => t.featureId === f.id) }));
  const known = new Set(draft.features.map((f) => f.id));
  const loose = tasks.filter((t) => !t.featureId || !known.has(t.featureId));
  if (loose.length) groups.push({ key: 'other', title: otherTitle, featureId: null, tasks: loose });
  return groups;
}

/**
 * Step 5 (Plan / Rules mockups): review and edit the plan, then 「分成 N 个任务包」.
 * `found` comes from the brief result (only right after parsing) for the rules info line.
 */
export function PlanStep({
  draft,
  setDraft,
  found,
}: {
  draft: DraftView;
  setDraft: (d: DraftView) => void;
  found?: PlanFound | null;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t, locale } = useI18n();
  const w = t.wizard.plan;
  const { request } = useSession();
  const { show } = useToast();
  const { id, timezone: tz, deadline, packageCount, planSource } = draft.basics;
  const dates = useDates(tz);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [askUneven, setAskUneven] = useState(false);
  // The plan 「把大任务拆开」 could not split any further: its button hides until the plan changes.
  const [stuck, setStuck] = useState<string | null>(null);
  const canSplit = stuck !== splitKey(draft);
  const close = useWizardClose({ needsConfirm: true, copy: { body: t.wizard.close.bodyDraft } });

  const groups = groupTasks(draft, w.other);
  const byFeature = draft.features.length > 0;
  const rules = planSource === 'RULES';
  const milestones = [...draft.milestones].sort((a, b) => a.order - b.order);

  // How 「分成 N 个任务包」 would come out (points already scaled to 100); nothing to warn about without tasks.
  const balance = draft.tasks.length > 0 && draft.balance?.balanced === false ? draft.balance : null;
  const gap = balance
    ? w.gap(
        formatTotal(Math.max(...balance.packagePoints)),
        formatTotal(Math.min(...balance.packagePoints)),
        balance.emptyPackages,
      )
    : '';

  const splitLarge = async () => {
    setSplitting(true);
    try {
      // Part labels in the language on screen (the server doesn't know the app's language setting).
      const body: SplitLargeInput = { locale };
      const next = await request<DraftView>(`/projects/${id}/split-large`, { method: 'POST', body });
      setDraft(next);
      if (next.tasks.length === draft.tasks.length) {
        setStuck(splitKey(next));
        show(w.splitNone);
      } else {
        show(next.balance.balanced ? w.splitDone : w.splitPartly);
      }
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setSplitting(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await request<ProjectView>(`/projects/${id}/confirm`, { method: 'POST' });
      goStep(wizardHref.done(id));
    } catch (err) {
      const code = errorCode(err);
      // Already confirmed (e.g. a double tap that reached the server twice): show the result.
      if (code === 'NOT_A_DRAFT') return goStep(wizardHref.done(id));
      show(t.errors[code]);
      // M6: a 选择题 isn't answered yet: go and answer it.
      if (code === 'CHOICES_REQUIRED') goStep(wizardHref.choices(id));
    } finally {
      setBusy(false);
    }
  };

  const removeTask = async (task: TaskView) => {
    try {
      setDraft(await request<DraftView>(`/projects/${id}/tasks/${task.id}`, { method: 'DELETE' }));
      show(w.deleted(task.title));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    }
  };

  const row = (task: TaskView) => (
    <SwipeDelete key={task.id} label={w.swipeDelete} onDelete={() => void removeTask(task)}>
    <Pressable
      onPress={() => setEditing({ task, featureId: task.featureId })}
      role="button"
      aria-label={`${task.title}, ${w.rowMeta(formatPoints(task.points), dates.short(task.dueAt ?? deadline))}`}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <KindTile emoji={t.labels.kindEmoji[task.kind]} />
      <View style={s.grow}>
        <Txt v="small" weight={700}>
          {task.title}
        </Txt>
        <Txt v="meta" size={12}>
          {w.rowMeta(formatPoints(task.points), dates.short(task.dueAt ?? deadline))}
        </Txt>
      </View>
      <Icon name="chevron" size={20} color={c.muted} />
    </Pressable>
    </SwipeDelete>
  );

  return (
    <WizardScreen
      step={5}
      onBack={() => goStep(draft.questions.length > 0 ? wizardHref.choices(id, draft.questions.length - 1) : wizardHref.input(id))}
      onClose={close.requestClose}
      footer={
        <>
          <TotalChip total={draft.totalPoints} />
          <Button
            title={w.split(packageCount)}
            block
            loading={busy}
            disabled={draft.tasks.length === 0 || splitting}
            onPress={balance ? () => setAskUneven(true) : confirm}
          />
        </>
      }>
      <WizardTitle parts={[w.titlePre, { hl: 'lilac', text: w.titleHl }]} />
      {rules ? (
        <>
          <NoteBox tone="warn">{w.rulesWarn}</NoteBox>
          {found && found.method !== 'AI' ? <NoteBox tone="good">{found.method === 'SCORES' ? w.foundScores(found.found) : w.foundList(found.found)}</NoteBox> : null}
        </>
      ) : (
        <>
          <SubLine>
            {byFeature ? w.subFeatures : planSource === 'AI' ? t.ai.plan.sub : !planSource || planSource === 'MANUAL' ? w.subManual : w.subEdit}
          </SubLine>
          {found?.method === 'AI' ? <NoteBox tone="good">{t.ai.plan.found(found.found)}</NoteBox> : null}
        </>
      )}

      {milestones.length > 0 ? (
        <Card style={{ gap: 8 }}>
          {milestones.map((m) => (
            <View key={m.id} style={s.ms}>
              <View style={s.tag}>
                <Txt v="mono" size={12} weight={700} color="paper">
                  {m.label}
                </Txt>
              </View>
              <Txt v="small" style={{ flex: 1 }}>
                {m.name}
              </Txt>
              <Txt v="mono" color="muted">
                {dates.short(m.dueAt)}
              </Txt>
            </View>
          ))}
        </Card>
      ) : null}

      {groups.map((g) => {
        const sum = g.tasks.reduce((n, task) => n + task.points, 0);
        return (
          <Card key={g.key} style={{ paddingVertical: byFeature ? 12 : 8 }}>
            {g.title ? (
              <View style={s.wsH}>
                <Txt v="rowTitle" weight={900} style={{ flex: 1 }}>
                  {g.title}
                </Txt>
                <Txt v="num" size={15} color="grapeText">
                  {w.groupPoints(formatTotal(sum))}
                </Txt>
              </View>
            ) : null}
            {g.tasks.length === 0 && !byFeature ? (
              <View style={{ paddingVertical: 8 }}>
                <Hint>{w.empty}</Hint>
              </View>
            ) : null}
            {g.tasks.map((task, i) => (
              <View key={task.id}>
                {i > 0 && <DashedLine />}
                {row(task)}
              </View>
            ))}
            <View style={{ paddingTop: 6 }}>
              <TextLink title={w.add} onPress={() => setEditing({ task: null, featureId: g.featureId })} />
            </View>
          </Card>
        );
      })}

      {rules ? <Hint>{w.rulesHint}</Hint> : null}

      {balance ? (
        <NoteBox
          tone="warn"
          action={
            canSplit ? <Button title={w.splitLarge} kind="soft" small block loading={splitting} disabled={busy} onPress={splitLarge} /> : undefined
          }>
          {w.uneven(gap)}
        </NoteBox>
      ) : null}

      {editing ? (
        <TaskEditSheet
          draft={draft}
          task={editing.task}
          featureId={editing.featureId}
          onClose={() => setEditing(null)}
          onSaved={setDraft}
        />
      ) : null}
      <ConfirmSheet
        visible={askUneven}
        title={w.unevenTitle}
        body={canSplit ? w.unevenBody(gap) : w.unevenBodyNoSplit(gap)}
        confirmLabel={w.unevenConfirm}
        onConfirm={confirm}
        onClose={() => setAskUneven(false)}
      />
      {close.closeSheet}
    </WizardScreen>
  );
}
