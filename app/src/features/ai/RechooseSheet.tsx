import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { ChoiceQuestionView, ProjectView, RechooseInput, RechoosePreview } from '@shared/types';
import { Button } from '@/components/Button';
import { Seg } from '@/components/Controls';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { memberById } from '@/features/project/parts';
import { TextLink } from '@/features/task/parts';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { ChoiceCard, type ChoiceMark } from './ChoiceCard';

const DEBOUNCE_MS = 250;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
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
    chg: { gap: 6, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: c.card2 },
    bullet: { flexDirection: 'row', gap: 8 },
    dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: c.ink2 },
  }),
);

const same = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * 改选 (RechooseSheet mockup, leader tools): pick again for one 选择题 of a running project. An option whose
 * task someone started stays (🔒); a dropped one is struck through (取消), a new one says 新选. The preview
 * (POST …/preview, debounced) lists the tasks that go and come; 确认改选 sends its version (STALE_PREVIEW
 * when something changed in between, then the preview is fetched again).
 */
export function RechooseSheet({
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
  const { c } = useTheme();
  const { t } = useI18n();
  const r = t.ai.rechoose;
  const { request } = useSession();
  const { show } = useToast();
  const id = project.basics.id;
  const questions = [...project.choices].sort((a, b) => a.order - b.order);
  const [questionId, setQuestionId] = useState(questions[0]?.id ?? '');
  const question: ChoiceQuestionView | undefined = questions.find((q) => q.id === questionId) ?? questions[0];
  const now = question ? question.options.filter((o) => o.picked).map((o) => o.key) : [];
  const [picks, setPicks] = useState<string[]>(now);
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<RechoosePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  // Another question: start from what it has picked now.
  useEffect(() => {
    setPicks(question ? question.options.filter((o) => o.picked).map((o) => o.key) : []);
    setMore(false);
    setPreview(null);
  }, [questionId]);

  const ready = !!question && picks.length === question.pickCount && !same(picks, now);
  const picksKey = [...picks].sort().join(',');
  useEffect(() => {
    const reqId = ++latest.current;
    if (!question || !ready) {
      setPreview(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const body: RechooseInput = { picks };
      request<RechoosePreview>(`/projects/${encodeURIComponent(id)}/choices/${encodeURIComponent(question.id)}/preview`, { method: 'POST', body })
        .then((p) => {
          if (reqId !== latest.current) return;
          setPreview(p);
          setLoading(false);
        })
        .catch((err) => {
          if (reqId !== latest.current) return;
          setError(errorCode(err));
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [picksKey, question?.id, ready, attempt, id, request]);

  if (!question) return null;
  const method = question.type === 'METHOD';

  const toggle = (key: string) => {
    const option = question.options.find((o) => o.key === key);
    if (!option || (option.lockedBy && option.picked)) return;
    setPicks((prev) => {
      if (prev.includes(key)) return method ? prev : prev.filter((k) => k !== key);
      if (method || question.pickCount === 1) {
        // Keep a locked pick: it can't be swapped out.
        const locked = prev.filter((k) => question.options.find((o) => o.key === k)?.lockedBy);
        return locked.length ? prev : [key];
      }
      return [...prev, key];
    });
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const body: RechooseInput = { picks, version: preview.version };
      const view = await request<ProjectView>(`/projects/${encodeURIComponent(id)}/choices/${encodeURIComponent(question.id)}`, {
        method: 'POST',
        body,
      });
      onChange(view);
      show(r.done);
      onClose();
    } catch (err) {
      onError(err);
      if (errorCode(err) === 'STALE_PREVIEW') setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  // What is picked now and what was just picked; the rest behind 看别的选项 (then all, in order).
  const shownFirst = question.options.filter((o) => o.picked || picks.includes(o.key));
  const rest = question.options.filter((o) => !o.picked && !picks.includes(o.key));
  const mark = (key: string): ChoiceMark | null => {
    const o = question.options.find((x) => x.key === key)!;
    if (o.picked && o.lockedBy) return { text: o.lockedBy.name ? r.locked(o.lockedBy.name) : r.lockedNoName, tone: 'default' };
    if (o.picked && !picks.includes(key)) return { text: r.drop, tone: 'bad' };
    if (!o.picked && picks.includes(key)) return { text: r.add, tone: 'good' };
    return null;
  };
  const card = (key: string) => {
    const o = question.options.find((x) => x.key === key)!;
    const locked = o.picked && !!o.lockedBy;
    return (
      <ChoiceCard
        key={key}
        option={o}
        method={method}
        on={picks.includes(key)}
        locked={locked}
        dropped={o.picked && !picks.includes(key)}
        mark={mark(key)}
        onPress={locked ? undefined : () => toggle(key)}
      />
    );
  };

  const quoted = (titles: string[]) => titles.map(r.quoted).join('');
  let owners = '';
  if (preview && preview.addTasks.length > 0) {
    const ids = [...new Set(preview.addTasks.map((x) => x.ownerMemberId))];
    const names = ids.map((mid) => memberById(project, mid)?.name ?? null);
    if (names.every((n) => n === null)) owners = r.addFree;
    else if (ids.length === 1 && names[0]) owners = r.addOwner(names[0]);
    else owners = r.addOwners;
  }

  return (
    <Sheet visible onClose={onClose} title={r.title(question.prompt)}>
      {questions.length > 1 ? (
        <Seg label={r.questionLabel} value={question.id} onChange={setQuestionId} options={questions.map((q, i) => ({ value: q.id, label: r.questionN(i + 1) }))} />
      ) : null}
      <Txt v="small" color="ink2">
        {r.now(now.join(t.ai.choice.keysJoin))}
      </Txt>
      <View style={{ gap: 10 }} role={method ? 'radiogroup' : undefined} aria-label={question.prompt}>
        {(more ? question.options : shownFirst).map((o) => card(o.key))}
      </View>
      {!method ? (
        <View style={s.counter} aria-live="polite">
          <Txt v="small" weight={800} color="grapeText">
            {t.ai.choice.picked}
          </Txt>
          <Txt v="num" size={16} color={picks.length === question.pickCount ? 'grapeText' : 'warn'} tabular>
            {t.ai.choice.count(picks.length, question.pickCount)}
          </Txt>
        </View>
      ) : null}
      {!more && rest.length > 0 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextLink title={r.others(rest.map((o) => o.key).join(r.keySep))} onPress={() => setMore(true)} />
        </View>
      ) : null}

      {same(picks, now) ? (
        <Txt v="meta">{r.unchanged}</Txt>
      ) : picks.length !== question.pickCount ? (
        <Txt v="meta" color="warn">
          {r.wrongCount(question.pickCount)}
        </Txt>
      ) : error ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Txt v="small" color="bad">
            {t.errors[error]}
          </Txt>
          <Button title={t.common.retry} kind="soft" small onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !preview ? (
        <ActivityIndicator color={c.grape} />
      ) : (
        <View style={[s.chg, loading && { opacity: 0.5 }]} aria-busy={loading}>
          <Txt v="small" size={13.5} weight={700}>
            {r.changes}
          </Txt>
          {preview.removeTasks.length > 0 ? (
            <Line>
              <Txt v="small" size={13} weight={700} color="bad">
                {r.removeLead(preview.removeTasks.length)}
              </Txt>
              {quoted(preview.removeTasks.map((x) => x.title))}
              {r.removeTail(formatPoints(preview.removeTasks.reduce((n, x) => n + x.points, 0)))}
            </Line>
          ) : null}
          {preview.addTasks.length > 0 ? (
            <Line>
              <Txt v="small" size={13} weight={700} color="good">
                {r.addLead(preview.addTasks.length)}
              </Txt>
              {quoted(preview.addTasks.map((x) => x.title))}
              {owners}
            </Line>
          ) : null}
          <Line>
            {r.rescalePre}
            <Txt v="small" size={13} weight={700}>
              {r.rescaleB}
            </Txt>
            {r.rescalePost}
          </Line>
          <Line>{r.notify}</Line>
        </View>
      )}

      <View style={{ gap: 10, marginTop: 4 }}>
        <Button title={r.confirm} block loading={busy} disabled={!ready || !preview || loading || !!error || preview.unchanged} onPress={apply} />
        <Button title={t.common.cancel} kind="soft" block onPress={onClose} />
      </View>
    </Sheet>
  );
}

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
