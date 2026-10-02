import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ChoiceQuestionView, ChoicesInput, DraftView } from '@shared/types';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { ChoiceCard, hoursText } from '@/features/ai/ChoiceCard';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';
import { Hint } from './Field';
import { goStep, wizardHref } from './nav';
import { SubLine, useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
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

/** What was picked before (only when it is a whole answer), else nothing: the leader chooses. */
function startPicks(q: ChoiceQuestionView): string[] {
  const picked = q.options.filter((o) => o.picked).map((o) => o.key);
  return picked.length === q.pickCount ? picked : [];
}

/** Keys of the AI's suggestion, their hours, and whether no other pick would be less work. */
function suggestion(q: ChoiceQuestionView) {
  const rec = q.options.filter((o) => o.recommended);
  const hours = rec.reduce((s, o) => s + o.hours, 0);
  const least = [...q.options.map((o) => o.hours)].sort((a, b) => a - b).slice(0, q.pickCount).reduce((s, h) => s + h, 0);
  return { rec, hours, least: rec.length === q.pickCount && hours <= least };
}

/**
 * Wizard step 4 (NewChoicePick / NewChoiceMethod mockups): the 选择题 one at a time (1 / 2, 2 / 2). A pick-N
 * question needs exactly pickCount before 下一题; a method question has 优点 / 缺点 columns. The last one's
 * 「确认，拆任务」 sends every answer (PUT …/choices) and opens the plan.
 */
export function ChoiceStep({ draft, setDraft, start }: { draft: DraftView; setDraft: (d: DraftView) => void; start: number }) {
  const s = useStyles();
  const { t } = useI18n();
  const k = t.ai.choice;
  const { request } = useSession();
  const { show } = useToast();
  const id = draft.basics.id;
  const questions = [...draft.questions].sort((a, b) => a.order - b.order);
  const [index, setIndex] = useState(() => Math.min(start, Math.max(0, questions.length - 1)));
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => Object.fromEntries(questions.map((q) => [q.id, startPicks(q)])));
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const close = useWizardClose({ needsConfirm: true, copy: { body: t.wizard.close.bodyDraft } });

  // No questions (e.g. reopened after they went away): the plan is next.
  useEffect(() => {
    if (questions.length === 0) goStep(wizardHref.plan(id));
  }, [questions.length, id]);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [index]);

  const q = questions[index];
  if (!q) return null;
  const method = q.type === 'METHOD';
  const prompt = q.prompt.replace(/\s+/g, ' ').trim().replace(/[:：]\s*$/, '');
  const picks = answers[q.id] ?? [];
  const last = index === questions.length - 1;
  const ready = picks.length === q.pickCount;
  const next = questions[index + 1];
  const { rec, hours, least } = suggestion(q);

  const toggle = (key: string) =>
    setAnswers((prev) => {
      const now = prev[q.id] ?? [];
      let picked: string[];
      if (now.includes(key)) picked = method ? now : now.filter((x) => x !== key);
      else picked = method || q.pickCount === 1 ? [key] : [...now, key];
      return { ...prev, [q.id]: picked };
    });

  const confirm = async () => {
    // Every question needs a whole answer (the server says CHOICE_COUNT otherwise): go to the first one missing.
    const missing = questions.findIndex((x) => (answers[x.id] ?? []).length !== x.pickCount);
    if (missing >= 0) return setIndex(missing);
    setBusy(true);
    try {
      const body: ChoicesInput = { answers };
      const d = await request<DraftView>(`/projects/${encodeURIComponent(id)}/choices`, { method: 'PUT', body });
      setDraft(d);
      goStep(wizardHref.plan(id, { method: 'AI', found: d.tasks.length }));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setBusy(false);
    }
  };

  const back = () => (index > 0 ? setIndex(index - 1) : goStep(wizardHref.input(id)));

  return (
    <WizardScreen
      step={4}
      onBack={back}
      onClose={close.requestClose}
      scrollRef={scroll}
      footer={
        <>
          {last ? (
            <Button title={k.confirm} block loading={busy} disabled={!ready} onPress={confirm} />
          ) : (
            <Button
              title={next?.type === 'METHOD' ? k.nextMethod : k.nextPick(next?.pickCount ?? 1)}
              block
              disabled={!ready}
              onPress={() => setIndex(index + 1)}
            />
          )}
          {!method ? <Hint center>{k.pickHint(q.pickCount, last)}</Hint> : null}
          {last ? <Hint center>{k.confirmHint(questions.length)}</Hint> : null}
        </>
      }>
      <View>
        <View style={s.no}>
          <Txt v="meta" size={12.5} weight={700} color="ink2">
            {k.no(index + 1, questions.length)}
          </Txt>
        </View>
        <View style={{ marginTop: 8 }}>
          <WizardTitle
            parts={
              // The highlight is one unbreakable block: only a short prompt keeps it, a long one is plain
              // text so 「」 stay on its lines.
              prompt.length <= 14 ? [k.titlePre, { hl: 'gum', text: prompt }, k.titlePost] : [`${k.titlePre}${prompt}${k.titlePost}`]
            }
          />
        </View>
        {q.quote ? (
          <View style={s.quote}>
            <Txt v="small" size={13} color="ink2">
              {k.quote(q.quote)}
            </Txt>
          </View>
        ) : null}
        {rec.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <SubLine>
              {method
                ? k.recMethod(rec[0]!.label, least)
                : k.recPick(rec.map((o) => o.key).join(k.keysJoin), hoursText(hours), least)}
            </SubLine>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 12 }} role={method ? 'radiogroup' : undefined} aria-label={q.prompt}>
        {q.options.map((o) => (
          <ChoiceCard key={o.key} option={o} method={method} on={picks.includes(o.key)} onPress={() => toggle(o.key)} />
        ))}
      </View>
      {!method ? (
        <View style={s.counter} aria-live="polite">
          <Txt v="small" weight={800} color="grapeText">
            {k.picked}
          </Txt>
          <Txt v="num" size={16} color={ready ? 'grapeText' : 'warn'} tabular>
            {k.count(picks.length, q.pickCount)}
          </Txt>
        </View>
      ) : null}
      {close.closeSheet}
    </WizardScreen>
  );
}
