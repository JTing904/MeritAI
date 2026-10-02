import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { BriefAnalysis, BriefAnalysisStep, BriefResult, DraftView } from '@shared/types';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { resetClock } from '@/features/ai/models';
import { ErrCard } from '@/features/ai/parts';
import { AiDocScan } from '@/features/ai/Scan';
import { OptRow } from '@/features/members/OptRow';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { briefHref } from './briefResult';
import { Hint } from './Field';
import { goStep, projectHref, wizardHref } from './nav';
import { Checks, type CheckState } from './parts';
import { useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';

/** The prototype polls the draft this often while the AI reads (the GET is conditional: 304 when nothing moved). */
const POLL_MS = 2000;
/** All four ✓ stay on screen this long before the next step opens. */
const DONE_PAUSE_MS = 700;

type Next = 'retry' | 'rules' | 'manual';

/**
 * Wizard step 3 with the leader's AI key (NewAiReading / NewAiFailed mockups): the real steps of the AI
 * reading the brief (DraftView.analysis, polled every 2 s), then the 选择题 (step 4) or the plan; when it
 * fails, 再试一次 / 改用免费规则拆 / 手动建任务.
 */
export function AiReadingStep({ draft, setDraft }: { draft: DraftView; setDraft: (d: DraftView) => void }) {
  const { t } = useI18n();
  const { cached, request } = useSession();
  const { show } = useToast();
  const id = draft.basics.id;
  const analysis = draft.analysis;
  const [pollFailed, setPollFailed] = useState(false);
  const [busy, setBusy] = useState<Next | null>(null);
  const close = useWizardClose({ needsConfirm: true, copy: { body: t.wizard.close.bodyDraft } });
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // While running: ask again every 2 s (and at once when the screen comes back into view).
  const running = analysis?.status === 'running';
  useFocusEffect(
    useCallback(() => {
      if (!running) return;
      let live = true;
      const tick = async () => {
        try {
          const { data } = await cached<DraftView>(`/projects/${encodeURIComponent(id)}/draft`, { force: true });
          if (!live) return;
          setPollFailed(false);
          if (data !== draftRef.current) setDraft(data);
        } catch (err) {
          if (!live) return;
          const code = errorCode(err);
          if (code === 'NOT_A_DRAFT') return router.replace(projectHref(id));
          setPollFailed(true);
        }
      };
      void tick();
      const timer = setInterval(() => void tick(), POLL_MS);
      return () => {
        live = false;
        clearInterval(timer);
      };
    }, [running, id, cached, setDraft]),
  );

  // Done: on to the 选择题 (step 4) or the plan. Nothing to read (no analysis, or cancelled): back to step 2.
  useEffect(() => {
    if (!analysis || (analysis.status === 'failed' && analysis.error === 'CANCELLED')) {
      goStep(draft.tasks.length > 0 ? wizardHref.plan(id) : wizardHref.input(id));
      return;
    }
    if (analysis.status !== 'done') return;
    const timer = setTimeout(() => {
      const d = draftRef.current;
      if (d.questions.length > 0) goStep(wizardHref.choices(id));
      else goStep(wizardHref.plan(id, { method: 'AI', found: d.analysis?.taskCount ?? d.tasks.length }));
    }, DONE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [analysis, id, draft.tasks.length]);

  const switchToRules = async () => {
    setBusy('rules');
    try {
      const res = await request<BriefResult>(`/projects/${encodeURIComponent(id)}/brief/rules`, { method: 'POST' });
      if (res.ok) setDraft(res.draft);
      const next = briefHref(id, res, draft.briefFileName ? { name: draft.briefFileName, size: null, mimeType: null } : null);
      if (next) return goStep(next);
      // Too large / empty / wrong type can't happen for a brief that was already saved; start step 2 again.
      show(t.errors.VALIDATION);
      goStep(wizardHref.input(id));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      setDraft(await request<DraftView>(`/projects/${encodeURIComponent(id)}/brief/retry`, { method: 'POST' }));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  if (analysis?.status === 'failed' && analysis.error !== 'CANCELLED') {
    return (
      <Failed
        draft={draft}
        analysis={analysis}
        busy={busy}
        onRetry={retry}
        onRules={switchToRules}
        onClose={close.requestClose}
        closeSheet={close.closeSheet}
      />
    );
  }

  const r = t.ai.reading;
  const provider = analysis?.provider ? t.ai.provider[analysis.provider] : 'AI';
  const steps: BriefAnalysisStep[] = analysis?.steps ?? [];
  const text = (step: BriefAnalysisStep): string => {
    const a = analysis!;
    switch (step.key) {
      case 'READ':
        return draft.briefFileName ? r.readFile(draft.briefFileName, a.lines) : r.readText;
      case 'TASKS':
        return step.state === 'done' && a.taskCount !== null ? r.tasksDone(a.taskCount) : step.state === 'running' ? r.running(r.tasks) : r.tasks;
      case 'CHOICES':
        return step.state === 'done' && a.questionCount !== null ? r.choicesDone(a.questionCount) : step.state === 'running' ? r.running(r.choices) : r.choices;
      case 'ESTIMATE':
        return step.state === 'done' ? r.estimateDone(a.totalHours) : step.state === 'running' ? r.running(r.estimate) : r.estimate;
    }
  };
  const state = (s: BriefAnalysisStep['state']): CheckState => (s === 'running' ? 'current' : s);
  const waitSec = analysis?.waitingUntil ? Math.max(1, Math.round((new Date(analysis.waitingUntil).getTime() - Date.now()) / 1000)) : null;

  return (
    <WizardScreen
      step={3}
      onClose={close.requestClose}
      footer={
        <>
          <Button title={r.useRules} kind="soft" block loading={busy === 'rules'} disabled={busy !== null || !running} onPress={switchToRules} />
          <Hint center>{r.rulesHint}</Hint>
        </>
      }>
      <WizardTitle parts={[r.titlePre, { hl: 'lemon', text: r.titleHl }, r.titlePost]} />
      <AiDocScan />
      <Checks label={r.label} items={steps.map((step) => ({ text: text(step), state: state(step.state) }))} />
      <Hint>{waitSec !== null ? r.queued(waitSec) : r.hint(provider)}</Hint>
      {pollFailed ? <Hint>{r.loadFailed}</Hint> : null}
      {close.closeSheet}
    </WizardScreen>
  );
}

function Failed({
  draft,
  analysis,
  busy,
  onRetry,
  onRules,
  onClose,
  closeSheet,
}: {
  draft: DraftView;
  analysis: BriefAnalysis;
  busy: Next | null;
  onRetry: () => Promise<void>;
  onRules: () => Promise<void>;
  onClose: () => void;
  closeSheet: ReactNode;
}) {
  const { t } = useI18n();
  const f = t.ai.failed;
  const id = draft.basics.id;
  const provider = analysis.provider ?? draft.ai.provider;
  const name = provider ? t.ai.provider[provider] : 'AI';
  const error = analysis.error;
  const keyProblem = error === 'INVALID' || error === 'NO_KEY';
  // The quota and a bad key usually won't be fixed by trying again at once.
  const [choice, setChoice] = useState<Next>(error === 'ERROR' ? 'retry' : 'rules');
  const resetsAt = useMe().ai?.usageToday?.resetsAt;
  const back = provider === 'GEMINI' || !resetsAt ? t.ai.me.backGemini : t.ai.me.backAt(resetClock(resetsAt));

  let card;
  if (error === 'QUOTA') {
    card = (
      <ErrCard tone="warn" title={f.quota(name)}>
        <Txt v="small">{f.quotaBody(back)}</Txt>
      </ErrCard>
    );
  } else if (keyProblem) {
    card = (
      <ErrCard tone="bad" title={error === 'NO_KEY' ? f.noKey : f.invalid(name)}>
        <Txt v="small">{error === 'NO_KEY' ? f.noKeyBody : f.invalidBody}</Txt>
        <Button title={f.goMe} kind="soft" small onPress={() => router.navigate('/me')} />
      </ErrCard>
    );
  } else {
    card = (
      <ErrCard tone="warn" title={f.error}>
        <Txt v="small">{f.errorBody}</Txt>
      </ErrCard>
    );
  }

  const go = () => {
    if (choice === 'retry') return onRetry();
    if (choice === 'rules') return onRules();
    goStep(wizardHref.input(id, 'manual'));
  };

  return (
    <WizardScreen
      step={3}
      onClose={onClose}
      footer={<Button title={f.go[choice]} block loading={busy !== null} disabled={busy !== null} onPress={go} />}>
      <WizardTitle parts={[f.title]} />
      {card}
      <View style={{ gap: 10 }} role="radiogroup" aria-label={f.label}>
        <OptRow leading={null} title={f.retry} sub={error === 'QUOTA' ? f.retrySub : f.retrySubError} selected={choice === 'retry'} onPress={() => setChoice('retry')} />
        <OptRow leading={null} title={f.rules} sub={f.rulesSub} selected={choice === 'rules'} onPress={() => setChoice('rules')} />
        <OptRow leading={null} title={f.manual} sub={f.manualSub} selected={choice === 'manual'} onPress={() => setChoice('manual')} />
      </View>
      {closeSheet}
    </WizardScreen>
  );
}
