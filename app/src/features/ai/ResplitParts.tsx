// 让 AI 重新拆, what the screen shows (ResplitReading / ResplitNewQuestion / ResplitReview mockups). Pure views
// over the proposal and the review's plan (resplitPlan.ts), so the dev gallery can show them with sample data;
// app/project/[id]/resplit.tsx holds the requests.
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPoints } from '@shared/planning';
import type { Highlighter } from '@shared/constants';
import type { AiResplitBrief, AiResplitKeptQuestion, AiResplitProposal, AiResplitQuestion } from '@shared/types';
import { Card, List, SectionHeader } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Rich } from '@/components/Rich';
import { AppBar } from '@/components/Screen';
import { SwipeDelete } from '@/components/SwipeDelete';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { Hint } from '@/features/wizard/Field';
import { Checks, DashedLine, KindTile, TextLink } from '@/features/wizard/parts';
import { SubLine, useHardwareBack } from '@/features/wizard/WizardScreen';
import { useI18n } from '@/i18n';
import type { TaskChip } from '@/lib/status';
import { makeStyles, useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';
import { AiTag } from './parts';
import { ChoiceCard, hoursText } from './ChoiceCard';
import { AiDocScan } from './Scan';
import type { ReviewDraft, ReviewPlan, ReviewTask } from './resplitPlan';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.paper },
    content: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 18, gap: 18, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
    foot: { marginTop: 'auto', paddingTop: 6, gap: 10 },
    stats: { flexDirection: 'row', gap: 8, paddingVertical: 14, paddingHorizontal: 10 },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
    grow: { flex: 1, minWidth: 0, gap: 3 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    wsH: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
    wsTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
    plRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, backgroundColor: c.card },
    struck: { gap: 6 },
    chg: { gap: 6, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.card2 },
    bullet: { flexDirection: 'row', gap: 8 },
    dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: c.ink2 },
    no: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12, backgroundColor: c.card2 },
    quote: { marginTop: 6, paddingVertical: 2, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: c.hl.gum.base },
    counter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: c.grapeSoft,
    },
  }),
);

/** A member as these views need them (the package owner's name and highlighter). */
export type Person = { name: string; color: Highlighter };

/**
 * The re-split screen's frame: the app bar (让 AI 重新拆 · {tag} · 只有你看得到), the page, and a footer at
 * the bottom of short pages (`.sticky-foot`). Android Back runs `onBack`.
 */
export function ResplitFrame({ sub, onBack, footer, children }: { sub: string; onBack: () => void; footer?: ReactNode; children: ReactNode }) {
  const s = useStyles();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  useHardwareBack(onBack);
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <AppBar title={t.ai.resplit.screen.title} sub={sub} onBack={onBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: 28 + insets.bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
          {footer ? <View style={s.foot}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The package number on its owner's colour (`.pkg-num`), or the waiting grey when nobody picked it. */
export function PkgNum({ index, owner, size = 34 }: { index: number; owner: Person | null; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: 'center', justifyContent: 'center', backgroundColor: owner ? c.hl[owner.color].base : c.waiting }}
      aria-hidden>
      <Txt v="num" size={size * 0.44} color={owner ? 'onHl' : 'ink'}>
        {index}
      </Txt>
    </View>
  );
}

// ─── AI reading (ResplitReading) ─────────────────────────────────────────────

export function ResplitReadingBody({ brief, keptCount, waitSec, pollFailed }: { brief: AiResplitBrief | null; keptCount: number; waitSec: number | null; pollFailed: boolean }) {
  const { t } = useI18n();
  const r = t.ai.resplit.reading;
  const read = brief?.fileName ? r.readFile(brief.fileName, brief.lines) : r.readText(brief?.lines ?? null);
  return (
    <>
      <Rich parts={[r.titlePre, { hl: 'lemon', text: r.titleHl }, r.titlePost]} />
      <AiDocScan />
      <Checks
        label={r.label}
        items={[
          { text: read, state: 'done' },
          { text: r.keep(keptCount), state: 'done' },
          { text: r.split, state: 'current' },
          { text: r.match, state: 'waiting' },
          { text: r.place, state: 'waiting' },
        ]}
      />
      <Hint>{waitSec !== null ? r.queued(waitSec) : r.hint}</Hint>
      {pollFailed ? <Hint>{t.ai.resplit.screen.loadFailed}</Hint> : null}
    </>
  );
}

// ─── A new 选择题 (ResplitNewQuestion) ───────────────────────────────────────

export function ResplitQuestionBody({
  question,
  index,
  count,
  picks,
  keptQuestions,
  onToggle,
}: {
  question: AiResplitQuestion;
  index: number;
  count: number;
  picks: string[];
  keptQuestions: AiResplitKeptQuestion[];
  onToggle: (key: string) => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const k = t.ai.choice;
  const q = t.ai.resplit.question;
  const method = question.type === 'METHOD';
  const prompt = question.prompt;
  const rec = question.options.filter((o) => o.recommended);
  const sub = [
    ...keptQuestions.map((x) => q.kept(x.prompt, x.pickedKeys.join(k.keysJoin))),
    rec.length ? (method ? q.rec(rec[0]!.key) : k.recPick(rec.map((o) => o.key).join(k.keysJoin), hoursText(rec.reduce((n, o) => n + o.hours, 0)), false)) : '',
  ]
    .filter(Boolean)
    .join('');
  return (
    <>
      <View>
        <View style={s.no}>
          <Txt v="meta" size={12.5} weight={700} color="ink2">
            {q.no(index + 1, count)}
          </Txt>
        </View>
        <View style={{ marginTop: 8 }}>
          <Rich parts={prompt.length <= 14 ? [q.titlePre, { hl: 'gum', text: prompt }] : [`${q.titlePre}${prompt}`]} size={23} />
        </View>
        {question.quote ? (
          <View style={s.quote}>
            <Txt v="small" size={13} color="ink2">
              {k.quote(question.quote)}
            </Txt>
          </View>
        ) : null}
        {sub ? (
          <View style={{ marginTop: 10 }}>
            <SubLine>{sub}</SubLine>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 12 }} role={method ? 'radiogroup' : undefined} aria-label={prompt}>
        {question.options.map((o) => (
          <ChoiceCard key={o.key} option={o} method={method} on={picks.includes(o.key)} onPress={() => onToggle(o.key)} />
        ))}
      </View>
      {!method ? (
        <View style={s.counter} aria-live="polite">
          <Txt v="small" weight={800} color="grapeText">
            {k.picked}
          </Txt>
          <Txt v="num" size={16} color={picks.length === question.pickCount ? 'grapeText' : 'warn'} tabular>
            {k.count(picks.length, question.pickCount)}
          </Txt>
        </View>
      ) : null}
    </>
  );
}

// ─── The review (ResplitReview) ──────────────────────────────────────────────

/** Packages whose new tasks show at first; the rest fold behind 「任务包 3、4 还有 N 个新任务」. */
const OPEN_PACKAGES = 2;
/** Kept / removed rows shown before 看全部. */
const FIRST_ROWS = 3;

function Line({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.bullet}>
      <View style={s.dot} aria-hidden />
      <Txt v="small" size={13} color="ink2" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

export function ResplitReviewBody({
  proposal,
  plan,
  draft,
  tz,
  deadline,
  person,
  chipOf,
  onEdit,
  onDelete,
  onAdd,
}: {
  proposal: AiResplitProposal;
  plan: ReviewPlan;
  draft: ReviewDraft;
  tz: string;
  deadline: string;
  /** The member by id (package owners, kept tasks' owners). */
  person: (memberId: string | null) => Person | null;
  /** A kept task's status chip (from the project's task). */
  chipOf: (taskId: string) => TaskChip | null;
  onEdit: (task: ReviewTask) => void;
  onDelete: (task: ReviewTask) => void;
  onAdd: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const r = t.ai.resplit.review;
  const dates = useDates(tz);
  const [allKept, setAllKept] = useState(false);
  const [allRemoved, setAllRemoved] = useState(false);
  const [allNew, setAllNew] = useState(false);
  const web = Platform.OS === 'web';

  const kept = proposal.kept;
  const removed = proposal.removed;
  const tasks = plan.tasks;
  // The kept tasks' points move only when the leader's edits or answers change the split (2026-10-02).
  const keptMoved = plan.keptPoints.some((pts, i) => pts !== proposal.kept[i]?.points);
  const groups = proposal.packages.map((p) => ({ index: p.index, owner: person(p.ownerMemberId), tasks: tasks.filter((x) => x.packageIndex === p.index) }));
  const withTasks = groups.filter((g) => g.tasks.length > 0);
  const loose = tasks.filter((x) => x.packageIndex === null);
  const shown = allNew ? withTasks : withTasks.slice(0, OPEN_PACKAGES);
  const folded = withTasks.slice(shown.length);

  const row = (task: ReviewTask) => (
    <SwipeDelete key={task.key} label={t.wizard.plan.swipeDelete} onDelete={() => onDelete(task)}>
      <Pressable
        onPress={() => onEdit(task)}
        role="button"
        aria-label={`${task.title}, ${task.dueAt ? r.rowMeta(formatPoints(task.points), dates.short(task.dueAt)) : r.rowMetaNoDue(formatPoints(task.points))}`}
        style={({ pressed }) => [s.plRow, pressed && { opacity: 0.7 }]}>
        <KindTile emoji={t.labels.kindEmoji[task.kind]} />
        <View style={s.grow}>
          <Txt v="small" weight={700}>
            {task.title}
          </Txt>
          <View style={s.meta}>
            <Txt v="meta" size={12}>
              {task.dueAt ? r.rowMeta(formatPoints(task.points), dates.short(task.dueAt)) : r.rowMetaNoDue(formatPoints(task.points))}
            </Txt>
            {task.byLeader ? <Chip tone="grape">{r.byYou}</Chip> : null}
          </View>
        </View>
        <Icon name="chevron" size={18} color={c.muted} />
      </Pressable>
    </SwipeDelete>
  );

  const packageCard = (key: string, head: ReactNode, list: ReviewTask[]) => (
    <Card key={key} style={{ gap: 2, paddingVertical: 12 }}>
      <View style={s.wsH}>
        {head}
        <Txt v="num" size={15} color="grapeText">
          {r.plus(formatPoints(list.reduce((n, x) => n + x.points, 0)))}
        </Txt>
      </View>
      {list.map((task, i) => (
        <View key={task.key}>
          {i > 0 && <DashedLine />}
          {row(task)}
        </View>
      ))}
    </Card>
  );

  // What the new 选择题 were answered with, for 「确认后会这样」.
  const newChoices = proposal.newQuestions
    .map((q) => ({ q, labels: q.options.filter((o) => (draft.answers[q.id] ?? []).includes(o.key)).map((o) => o.label) }))
    .filter((x) => x.labels.length > 0);

  return (
    <>
      <View>
        <Rich parts={[r.titlePre, { hl: 'lilac', text: r.titleHl }]} />
        <View style={{ marginTop: 8 }}>
          <SubLine>{web ? r.subWeb : r.sub}</SubLine>
        </View>
      </View>

      <Card style={s.stats}>
        {[
          { n: String(kept.length), label: r.kept, color: 'ink' as const },
          { n: `−${removed.length}`, label: r.removed, color: 'bad' as const },
          { n: `+${tasks.length}`, label: r.added, color: 'good' as const },
        ].map((x) => (
          <View key={x.label} style={s.stat} accessible aria-label={`${x.label} ${x.n}`}>
            <Txt v="num" size={24} color={x.color} tabular>
              {x.n}
            </Txt>
            <Txt v="meta" center>
              {x.label}
            </Txt>
          </View>
        ))}
      </Card>

      {kept.length > 0 ? (
        <>
          <SectionHeader
            title={r.keptH(kept.length)}
            action={kept.length > FIRST_ROWS ? <TextLink title={allKept ? r.fold : r.all} onPress={() => setAllKept((v) => !v)} /> : undefined}
          />
          <List>
            {(allKept ? kept : kept.slice(0, FIRST_ROWS)).map((k, i) => {
              const chip = chipOf(k.taskId);
              const owner = person(k.ownerMemberId);
              return (
                <View key={k.taskId} style={s.row}>
                  <KindTile emoji={t.labels.kindEmoji[k.kind]} size={36} />
                  <View style={s.grow}>
                    <Txt v="rowTitle">{k.title}</Txt>
                    <View style={s.meta}>
                      {chip ? (
                        <Chip tone={chip.tone}>
                          {chip.emoji} {chip.label}
                        </Chip>
                      ) : null}
                      <Txt v="meta">{[owner?.name, t.wizard.plan.groupPoints(formatPoints(plan.keptPoints[i] ?? k.points))].filter(Boolean).join(' · ')}</Txt>
                    </View>
                  </View>
                  <Chip>{r.unchanged}</Chip>
                </View>
              );
            })}
          </List>
        </>
      ) : null}

      <SectionHeader title={r.addedH(tasks.length)} action={<AiTag />} />
      {shown.map((g) =>
        packageCard(
          `p${g.index}`,
          <View style={s.wsTitle}>
            <PkgNum index={g.index} owner={g.owner} size={26} />
            <Txt v="rowTitle" weight={900} style={{ flexShrink: 1 }}>
              {r.pkgHead(g.index, g.owner?.name ?? null)}
            </Txt>
          </View>,
          g.tasks,
        ),
      )}
      {folded.length > 0 ? (
        <Pressable onPress={() => setAllNew(true)} role="button" style={{ marginTop: -8, marginHorizontal: 4 }}>
          <Txt v="meta">{r.moreNew(folded.map((g) => g.index).join(r.pkgSep), folded.reduce((n, g) => n + g.tasks.length, 0))}</Txt>
        </Pressable>
      ) : null}
      {loose.length > 0
        ? packageCard(
            'loose',
            <Txt v="rowTitle" weight={900} style={{ flex: 1 }}>
              {r.noPkg}
            </Txt>,
            loose,
          )
        : null}
      <View style={{ marginTop: -6, marginHorizontal: 4 }}>
        <TextLink title={r.add} onPress={onAdd} size={13.5} />
      </View>

      {removed.length > 0 ? (
        <>
          <SectionHeader
            title={r.removedH(removed.length)}
            action={removed.length > FIRST_ROWS ? <TextLink title={allRemoved ? r.fold : r.all} onPress={() => setAllRemoved((v) => !v)} /> : undefined}
          />
          <Card style={s.struck}>
            {(allRemoved ? removed : removed.slice(0, FIRST_ROWS)).map((x) => (
              <Txt key={x.taskId} v="small" size={13.5} color="muted" style={{ textDecorationLine: 'line-through' }}>
                {r.removedRow(x.title, formatPoints(x.points))}
              </Txt>
            ))}
            {!allRemoved && removed.length > FIRST_ROWS ? (
              <Txt v="small" size={13.5} color="muted">
                {r.more(removed.length - FIRST_ROWS)}
              </Txt>
            ) : null}
          </Card>
        </>
      ) : null}

      {plan.packages.length > 0 ? (
        <>
          <SectionHeader title={r.pkgsH} />
          <List>
            {plan.packages.map((p) => {
              const owner = person(p.ownerMemberId);
              return (
                <View key={p.index} style={s.row}>
                  <PkgNum index={p.index} owner={owner} />
                  <View style={s.grow}>
                    <Txt v="rowTitle" color={owner ? 'ink' : 'muted'}>
                      {owner?.name ?? r.free}
                    </Txt>
                  </View>
                  <Txt v="small" weight={800} tabular>
                    {r.change(formatPoints(p.pointsBefore), formatPoints(p.pointsAfter))}
                  </Txt>
                </View>
              );
            })}
          </List>
        </>
      ) : null}

      <View style={s.chg}>
        <Txt v="small" size={13.5} weight={700}>
          {r.chgTitle}
        </Txt>
        <Line>{r.chgSwap(removed.length, tasks.length)}</Line>
        <Line>
          {keptMoved ? r.chgPointsMoved : r.chgPointsKept}
          <Txt v="small" size={13} weight={700}>
            {r.chgPointsB}
          </Txt>
          {r.chgPointsPost}
        </Line>
        {proposal.keptQuestions.map((q) => (
          <Line key={q.questionId}>{r.chgKept(q.prompt, q.pickedKeys.join(r.keysJoin))}</Line>
        ))}
        {newChoices.map(({ q, labels }) => (
          <Line key={q.id}>{r.chgNew(q.prompt, labels.join(r.labelSep))}</Line>
        ))}
        <Line>{r.chgNotify}</Line>
      </View>
    </>
  );
}
