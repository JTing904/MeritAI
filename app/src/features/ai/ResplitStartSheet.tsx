import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { AiResplitStartInput, AiResplitState, BriefFailure, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { InlineText, OptRow } from '@/features/project/parts';
import { FileChip } from '@/features/wizard/FileChip';
import { ErrorText, Field, Input } from '@/features/wizard/Field';
import { BRIEF_MAX_BYTES, briefForm, formatBytes, pickBriefFile, type PickedFile } from '@/features/wizard/upload';
import { useI18n } from '@/i18n';
import { ApiClientError, errorCode, type ClientErrorCode } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { KindTile } from '@/features/wizard/parts';
import { useTheme } from '@/theme';

type Choice = 'saved' | 'fresh';
type FreshMode = 'file' | 'text';

/** Where the re-split screen lives. */
export const resplitHref = (id: string) => ({ pathname: '/project/[id]/resplit' as const, params: { id } });

/**
 * 「✨ 让 AI 重新拆」 sheet (ResplitStart mockup): how many tasks stay and how many are replaced, which brief the
 * AI reads (原来那份 / 换一份新的 → a file or typed text), the key's quota today, 开始重新拆 / 取消. Starting
 * opens the re-split screen. A result still waiting (or a run going on) is mentioned with 去看看.
 */
export function ResplitStartSheet({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const r = t.ai.resplit.sheet;
  const { request, refreshMe } = useSession();
  const me = useMe();
  const id = project.basics.id;
  const [state, setState] = useState<AiResplitState | null>(null);
  const [loadError, setLoadError] = useState<ClientErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<Choice>('saved');
  const [mode, setMode] = useState<FreshMode>('file');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once on open (and on 再试一次): the counts and the saved brief; the quota line wants today's usage too.
  useEffect(() => {
    let live = true;
    setLoadError(null);
    request<AiResplitState>(`/projects/${encodeURIComponent(id)}/ai-resplit`)
      .then((s) => {
        if (!live) return;
        setState(s);
        if (!s.savedBrief) setChoice('fresh');
      })
      .catch((err) => live && setLoadError(errorCode(err)));
    void refreshMe().catch(() => {});
    return () => {
      live = false;
    };
  }, [id, request, refreshMe, attempt]);

  const go = () => {
    onClose();
    router.push(resplitHref(id));
  };

  const start = async () => {
    setProblem(null);
    let body: FormData | AiResplitStartInput = {};
    if (choice === 'fresh' && mode === 'file') {
      if (!file) return setProblem(r.pickFirst);
      if (file.size != null && file.size > BRIEF_MAX_BYTES) return setProblem(r.tooLarge(formatBytes(BRIEF_MAX_BYTES)));
      body = briefForm(file);
    } else if (choice === 'fresh') {
      if (!text.trim()) return setProblem(r.unreadable.EMPTY);
      body = { text: text.trim() };
    }
    setBusy(true);
    try {
      await request<AiResplitState>(`/projects/${encodeURIComponent(id)}/ai-resplit`, { method: 'POST', body });
      go();
    } catch (err) {
      const code = errorCode(err);
      const reason = err instanceof ApiClientError ? (err.details as { reason?: BriefFailure } | undefined)?.reason : undefined;
      setProblem(code === 'BRIEF_UNREADABLE' && reason ? r.unreadable[reason] : t.errors[code]);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    try {
      const picked = await pickBriefFile();
      if (!picked) return;
      setFile(picked);
      setProblem(picked.size != null && picked.size > BRIEF_MAX_BYTES ? r.tooLarge(formatBytes(BRIEF_MAX_BYTES)) : null);
    } catch {
      setProblem(t.errors.INTERNAL);
    }
  };

  const provider = project.ai.provider ? t.ai.provider[project.ai.provider] : 'AI';
  const good = me.ai?.usageToday?.good;
  const saved = state?.savedBrief ?? null;
  const savedDate = saved ? new Date(saved.savedAt) : null;

  return (
    <Sheet visible onClose={onClose} title={r.title}>
      {loadError ? (
        <View style={{ gap: 8, alignItems: 'flex-start' }}>
          <Txt v="small" color="bad">
            {t.errors[loadError]}
          </Txt>
          <Button title={t.common.retry} kind="soft" small onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !state ? (
        <ActivityIndicator color={c.grape} />
      ) : (
        <>
          <InlineText parts={r.body(state.keptCount, state.replaceCount)} v="small" color="ink2" />
          {state.status === 'done' || state.status === 'running' ? (
            <View style={{ gap: 4, alignItems: 'flex-start' }}>
              <Txt v="meta" color="warn">
                {state.status === 'done' ? r.pending : r.running}
              </Txt>
              <Button title={r.look} kind="soft" small onPress={go} />
            </View>
          ) : null}

          <Field label={r.briefLabel}>
            <View style={{ gap: 8 }}>
              {saved && savedDate ? (
                <OptRow
                  leading={<KindTile emoji="📄" size={36} />}
                  title={r.saved}
                  sub={r.savedSub(saved.fileName, t.labels.due.date(savedDate.getMonth() + 1, savedDate.getDate()), saved.fromResplit)}
                  selected={choice === 'saved'}
                  onPress={() => setChoice('saved')}
                />
              ) : null}
              <OptRow
                leading={<KindTile emoji="⬆️" size={36} />}
                title={r.fresh}
                sub={r.freshSub}
                selected={choice === 'fresh'}
                onPress={() => setChoice('fresh')}
              />
            </View>
          </Field>

          {choice === 'fresh' ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title={r.upload} kind={mode === 'file' ? 'primary' : 'soft'} small onPress={() => setMode('file')} />
                <Button title={r.typeIt} kind={mode === 'text' ? 'primary' : 'soft'} small onPress={() => setMode('text')} />
              </View>
              {mode === 'file' ? (
                <>
                  {file ? <FileChip name={file.name} mimeType={file.mimeType} meta={r.picked(file.size != null ? formatBytes(file.size) : '')} /> : null}
                  <Button
                    title={file ? r.pickAgain : r.upload}
                    kind="soft"
                    block
                    icon={<Icon name="upload" size={18} color={c.ink} />}
                    onPress={choose}
                  />
                </>
              ) : (
                <Field label={r.textLabel}>
                  <Input label={r.textLabel} value={text} onChangeText={setText} placeholder={r.textPlaceholder} multiline maxLength={20000} style={{ minHeight: 110 }} />
                </Field>
              )}
            </View>
          ) : null}

          {/* `.priv`: the key and today's use of the good models. */}
          <View style={{ flexDirection: 'row', gap: 8, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.card2 }}>
            <Txt v="meta" size={12.5} aria-hidden>
              ✨
            </Txt>
            <Txt v="meta" size={12.5} color="ink2" style={{ flex: 1 }}>
              {r.quota(provider, good?.used ?? 0, good?.limit ?? null)}
            </Txt>
          </View>
          {problem ? <ErrorText>{problem}</ErrorText> : null}
        </>
      )}
      <View style={{ gap: 10, marginTop: 4 }}>
        <Button title={r.start} block loading={busy} disabled={!state} onPress={start} />
        <Button title={t.common.cancel} kind="soft" block onPress={onClose} />
      </View>
    </Sheet>
  );
}
