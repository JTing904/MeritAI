import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { projectTag } from '@shared/format';
import type { AiResplitProposal, AiResplitState, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { AppBar, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { resetClock } from '@/features/ai/models';
import { ErrCard } from '@/features/ai/parts';
import { ResplitFrame, ResplitQuestionBody, ResplitReadingBody, ResplitReviewBody, type Person } from '@/features/ai/ResplitParts';
import { ResplitTaskSheet } from '@/features/ai/ResplitTaskSheet';
import { answered, applyBody, carryDraft, reviewPlan, startDraft, type ReviewDraft, type ReviewTask } from '@/features/ai/resplitPlan';
import { memberById, NoticeCard } from '@/features/project/parts';
import { useProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { taskChip } from '@/lib/status';
import { useTheme } from '@/theme';

/** While the AI runs, the state is asked for this often (only while this screen is in view). */
const POLL_MS = 2000;

type Step = { kind: 'question'; index: number } | { kind: 'review' };
type Editing = { task: ReviewTask | null } | null;

/**
 * 让 AI 重新拆 (ResplitReading / ResplitNewQuestion / ResplitReview mockups): the run's progress (polled every 2 s
 * while it runs and the screen is focused), its failure (再试一次 / 关闭), then the new 选择题 one at a time and
 * the review, where the new tasks can be changed, deleted and added before 「确认，换成新任务」.
 */
export default function ResplitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const rs = t.ai.resplit;
  const { request } = useSession();
  const { show } = useToast();
  const { project, setProject } = useProject(id);
  const [state, setState] = useState<AiResplitState | null>(null);
  const [loadError, setLoadError] = useState<ClientErrorCode | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [busy, setBusy] = useState<'apply' | 'discard' | 'retry' | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const proposalRef = useRef<AiResplitProposal | null>(null);
  const path = `/projects/${encodeURIComponent(id)}/ai-resplit`;

  // A new proposal (the first, or one worked out again after STALE_PREVIEW): keep what the leader did that still applies.
  const take = useCallback((s: AiResplitState) => {
    setState(s);
    const p = s.status === 'done' ? s.proposal : null;
    if (!p) {
      proposalRef.current = null;
      return;
    }
    const before = proposalRef.current;
    proposalRef.current = p;
    setDraft((d) => (d && before ? carryDraft(p, d) : startDraft(p)));
    setStep((st) => st ?? (p.newQuestions.length > 0 ? { kind: 'question', index: 0 } : { kind: 'review' }));
  }, []);

  const load = useCallback(
    async (poll: boolean) => {
      try {
        take(await request<AiResplitState>(path));
        setLoadError(null);
        setPollFailed(false);
      } catch (err) {
        if (poll) setPollFailed(true);
        else setLoadError(errorCode(err));
      }
    },
    [path, request, take],
  );

  // Once each time the screen comes into view…
  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );
  // …and every 2 s only while the AI runs and the screen is in view (no idle polling).
  const running = state?.status === 'running';
  useFocusEffect(
    useCallback(() => {
      if (!running) return;
      const timer = setInterval(() => void load(true), POLL_MS);
      return () => clearInterval(timer);
    }, [running, load]),
  );

  const leave = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/project/[id]', params: { id } }));

  const proposal = state?.status === 'done' ? state.proposal : null;
  const plan = useMemo(() => (proposal && draft ? reviewPlan(proposal, draft) : null), [proposal, draft]);
  const tag = project ? projectTag(project.basics.name, project.basics.shortCode) : '';
  const sub = rs.screen.sub(tag);

  const discard = async (toast: string) => {
    setBusy('discard');
    try {
      await request<AiResplitState>(path, { method: 'DELETE' });
      show(toast);
      leave();
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      take(await request<AiResplitState>(path, { method: 'POST', body: { again: true } }));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!proposal || !draft) return;
    setBusy('apply');
    try {
      const view = await request<ProjectView>(`${path}/apply`, { method: 'POST', body: applyBody(proposal, draft) });
      setProject(view);
      show(rs.review.done);
      leave();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'STALE_PREVIEW') {
        show(rs.review.stale);
        await load(false);
      } else if (code === 'CHOICES_REQUIRED' && proposal.newQuestions.length > 0) {
        show(t.errors[code]);
        setStep({ kind: 'question', index: 0 });
      } else {
        show(t.errors[code]);
        if (code === 'NOT_FOUND') await load(false);
      }
    } finally {
      setBusy(null);
    }
  };

  const resetsAt = useMe().ai?.usageToday?.resetsAt;

  // ─── Loading, nothing to show ───
  if (!state || !project) {
    return (
      <Screen header={<AppBar title={rs.screen.title} sub={tag ? sub : undefined} />}>
        {loadError ? (
          <View style={{ gap: 12, alignItems: 'flex-start' }}>
            <Txt v="text" color="bad">
              {t.errors[loadError]}
            </Txt>
            <Button title={t.common.retry} kind="soft" onPress={() => load(false)} />
          </View>
        ) : (
          <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />
        )}
      </Screen>
    );
  }

  if (state.status === 'none') {
    return (
      <ResplitFrame sub={sub} onBack={leave}>
        <NoticeCard tone="plain" emoji="✨" title={rs.none.title} body={rs.none.body} action={{ title: rs.none.back, onPress: leave, kind: 'soft' }} />
      </ResplitFrame>
    );
  }

  // ─── The AI is reading ───
  if (state.status === 'running') {
    const waitSec = state.waitingUntil ? Math.max(1, Math.round((new Date(state.waitingUntil).getTime() - Date.now()) / 1000)) : null;
    return (
      <ResplitFrame
        sub={sub}
        onBack={leave}
        footer={<Button title={rs.reading.stop} kind="soft" block loading={busy === 'discard'} onPress={() => discard(rs.reading.stopped)} />}>
        <ResplitReadingBody brief={state.brief} keptCount={state.keptCount} waitSec={waitSec} pollFailed={pollFailed} />
      </ResplitFrame>
    );
  }

  // ─── It failed: nothing changed ───
  if (state.status === 'failed') {
    const f = rs.failed;
    const name = state.provider ? t.ai.provider[state.provider] : 'AI';
    const back = state.provider === 'GEMINI' || !resetsAt ? t.ai.me.backGemini : t.ai.me.backAt(resetClock(resetsAt));
    const keyTrouble = state.error === 'INVALID' || state.error === 'NO_KEY';
    const title = state.error === 'QUOTA' ? f.quota(name) : state.error === 'INVALID' ? f.invalid(name) : state.error === 'NO_KEY' ? f.noKey : f.error;
    const body = state.error === 'QUOTA' ? f.quotaBody(back) : state.error === 'INVALID' ? f.invalidBody : state.error === 'NO_KEY' ? f.noKeyBody : f.errorBody;
    return (
      <ResplitFrame
        sub={sub}
        onBack={leave}
        footer={
          <>
            <Button title={f.retry} block loading={busy === 'retry'} disabled={busy !== null} onPress={retry} />
            <Button title={f.close} kind="soft" block loading={busy === 'discard'} disabled={busy !== null} onPress={() => discard(rs.review.discarded)} />
          </>
        }>
        <Txt v="title">{f.title}</Txt>
        <ErrCard tone={keyTrouble ? 'bad' : 'warn'} title={title}>
          <Txt v="small">{body}</Txt>
          {keyTrouble ? <Button title={f.goMe} kind="soft" small onPress={() => router.navigate('/me')} /> : null}
        </ErrCard>
        <Txt v="text" color="muted">
          {f.nothing}
        </Txt>
      </ResplitFrame>
    );
  }

  if (!proposal || !draft || !plan || !step) return null;

  // ─── A new 选择题 ───
  if (step.kind === 'question') {
    const qs = proposal.newQuestions;
    const q = qs[Math.min(step.index, qs.length - 1)]!;
    const picks = draft.answers[q.id] ?? [];
    const method = q.type === 'METHOD';
    const last = step.index >= qs.length - 1;
    const toggle = (key: string) =>
      setDraft((d) => {
        if (!d) return d;
        const now = d.answers[q.id] ?? [];
        let next: string[];
        if (now.includes(key)) next = method ? now : now.filter((x) => x !== key);
        else next = method || q.pickCount === 1 ? [key] : [...now, key];
        return { ...d, answers: { ...d.answers, [q.id]: next } };
      });
    const back = () => (step.index > 0 ? setStep({ kind: 'question', index: step.index - 1 }) : leave());
    return (
      <ResplitFrame
        sub={sub}
        onBack={back}
        footer={
          <>
            <Button
              title={last ? rs.question.review : rs.question.next}
              block
              disabled={picks.length !== q.pickCount}
              onPress={() => setStep(last ? { kind: 'review' } : { kind: 'question', index: step.index + 1 })}
            />
            <Txt v="meta" center>
              {rs.question.hint}
            </Txt>
          </>
        }>
        <ResplitQuestionBody question={q} index={step.index} count={qs.length} picks={picks} keptQuestions={proposal.keptQuestions} onToggle={toggle} />
      </ResplitFrame>
    );
  }

  // ─── The review ───
  const person = (memberId: string | null): Person | null => {
    const m = memberById(project, memberId);
    return m ? { name: m.name, color: m.color } : null;
  };
  const chipOf = (taskId: string) => {
    const task = project.tasks.find((x) => x.id === taskId);
    return task ? taskChip(task, t) : null;
  };
  const remove = (task: ReviewTask) => {
    setDraft((d) =>
      d ? (task.byLeader ? { ...d, added: d.added.filter((x) => x.id !== task.key) } : { ...d, deleted: [...d.deleted, task.key] }) : d,
    );
    show(rs.review.deleted(task.title));
  };
  const back = () => (proposal.newQuestions.length > 0 ? setStep({ kind: 'question', index: proposal.newQuestions.length - 1 }) : leave());

  return (
    <ResplitFrame
      sub={sub}
      onBack={back}
      footer={
        <>
          <Button title={rs.review.confirm} block loading={busy === 'apply'} disabled={busy !== null || !answered(proposal, draft)} onPress={apply} />
          <Button title={rs.review.discard} kind="soft" block loading={busy === 'discard'} disabled={busy !== null} onPress={() => discard(rs.review.discarded)} />
        </>
      }>
      <ResplitReviewBody
        proposal={proposal}
        plan={plan}
        draft={draft}
        tz={project.basics.timezone}
        deadline={project.basics.deadline}
        person={person}
        chipOf={chipOf}
        onEdit={(task) => setEditing({ task })}
        onDelete={remove}
        onAdd={() => setEditing({ task: null })}
      />
      {editing ? (
        <ResplitTaskSheet
          task={editing.task}
          tz={project.basics.timezone}
          deadline={project.basics.deadline}
          onClose={() => setEditing(null)}
          onSave={(edit, values) => {
            const task = editing.task;
            if (!task) return;
            setDraft((d) => {
              if (!d) return d;
              if (task.byLeader) {
                return { ...d, added: d.added.map((x) => (x.id === task.key ? { ...x, ...values } : x)) };
              }
              return { ...d, edits: { ...d.edits, [task.key]: { ...d.edits[task.key], ...edit } } };
            });
          }}
          onAdd={(v) => setDraft((d) => (d ? { ...d, added: [...d.added, { id: `local-${Date.now()}-${d.added.length}`, ...v }] } : d))}
          onDelete={() => editing.task && remove(editing.task)}
        />
      ) : null}
    </ResplitFrame>
  );
}
