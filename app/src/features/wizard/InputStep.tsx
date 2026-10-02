import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { BriefFailure, BriefResult, DraftView, TaskInput } from '@shared/types';
import { Button } from '@/components/Button';
import { Seg } from '@/components/Controls';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';
import { useDates } from './dates';
import { ErrorText, Field, Hint, Input, NoteBox } from './Field';
import { FileChip } from './FileChip';
import { blankRow, ManualEditor, manualTasks, manualTotal, rowsFromTasks, type ManualRow } from './ManualEditor';
import { briefHref } from './briefResult';
import { goStep, wizardHref } from './nav';
import { Checks, DocScan, TotalChip } from './parts';
import { hasTypedBrief, typedTaskCount, useTypedBrief } from './typedBrief';
import { BRIEF_MAX_BYTES, briefForm, formatBytes, pickBriefFile, type PickedFile } from './upload';
import { useWizardClose, WizardScreen, WizardTitle } from './WizardScreen';

export type InputMode = 'upload' | 'text' | 'manual';

const styles = StyleSheet.create({
  textFoot: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
});

type FileProblem = { reason: Exclude<BriefFailure, 'UNREADABLE' | 'NO_STRUCTURE'> | 'NETWORK'; size: number | null; max: number };

function startMode(draft: DraftView, asked?: string): InputMode {
  if (asked === 'upload' || asked === 'text' || asked === 'manual') return asked;
  if (draft.basics.planSource === 'MANUAL') return 'manual';
  if (draft.hasBriefText && !draft.briefFileName) return 'text';
  // Text the rules couldn't split yet (kept on this device) is the leader's latest attempt.
  if (!draft.tasks.length && hasTypedBrief(draft.basics.id)) return 'text';
  return 'upload';
}

const sameTasks = (a: TaskInput[], b: TaskInput[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Step 2 (Manual / UploadError mockups, prototype new2) and, while the brief is being read,
 * step 3 (prototype new3 rules variant) shown in place so the picked file never has to travel between routes.
 */
export function InputStep({
  draft,
  setDraft,
  mode: askedMode,
}: {
  draft: DraftView;
  setDraft: (d: DraftView) => void;
  mode?: string;
}) {
  const { t } = useI18n();
  const w = t.wizard.input;
  const { c } = useTheme();
  const { request } = useSession();
  const { show } = useToast();
  const id = draft.basics.id;
  const tz = draft.basics.timezone;
  const dates = useDates(tz);

  const [mode, setModeState] = useState<InputMode>(() => startMode(draft, askedMode));
  const modeChosen = useRef(false);
  const setMode = (m: InputMode) => {
    modeChosen.current = true;
    setModeState(m);
  };
  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  // Kept per draft outside this screen: 「拆不了」 and ✕ must not throw the typed text away.
  const { text, setText, clear: clearTyped } = useTypedBrief(id, () => {
    if (!askedMode && !modeChosen.current && !draft.tasks.length && draft.basics.planSource !== 'MANUAL') setModeState('text');
  });
  const [textError, setTextError] = useState<string | null>(null);
  const savedRows = useRef<ManualRow[]>(draft.tasks.length ? rowsFromTasks(draft.tasks) : [blankRow()]);
  const [rows, setRows] = useState<ManualRow[]>(savedRows.current);
  const [manualError, setManualError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Non-null while the brief is being read (step 3). */
  const [reading, setReading] = useState<{ label: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const hasTasks = draft.tasks.length > 0;
  // M6: with the leader's working key the AI reads the brief instead of the free rules.
  const aiReads = draft.ai.configured && draft.ai.status !== 'INVALID';
  const typedCount = typedTaskCount(text);
  const savedTasks = manualTasks(savedRows.current, t.wizard.manual);
  const currentTasks = manualTasks(rows, t.wizard.manual);
  const manualDirty = !(currentTasks.tasks && savedTasks.tasks && sameTasks(currentTasks.tasks, savedTasks.tasks));

  // ── Reading a brief (upload or typed) ──────────────────────────────────────

  const onResult = (res: BriefResult, from: PickedFile | null) => {
    if (res.ok) {
      // The text now lives on the server as the plan's brief (M6: the AI reads it in the background).
      clearTyped();
      setDraft(res.draft);
    } else setReading(null);
    const next = briefHref(id, res, from);
    if (next) return goStep(next);
    if (res.ok || res.reason === 'UNREADABLE' || res.reason === 'NO_STRUCTURE') return;
    if (from) setFileProblem({ reason: res.reason, size: res.sizeBytes ?? from.size, max: res.maxBytes });
    else setTextError(res.reason === 'EMPTY' ? w.textEmpty : t.errors.VALIDATION);
  };

  const readBrief = async (body: FormData | { text: string }, from: PickedFile | null) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFileProblem(null);
    setReading({ label: from ? t.wizard.reading.file(from.name) : t.wizard.reading.text });
    try {
      const res = await request<BriefResult>(`/projects/${id}/brief`, { method: 'POST', body, signal: ctrl.signal });
      if (!ctrl.signal.aborted) onResult(res, from);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setReading(null);
      const code = errorCode(err);
      // The file stays picked and the button reads 再试一次; other errors are toasted.
      if (code === 'OFFLINE') show(t.errors.OFFLINE);
      if (from && (code === 'NETWORK' || code === 'TIMEOUT' || code === 'RETRY' || code === 'OFFLINE')) {
        setFileProblem({ reason: 'NETWORK', size: from.size, max: BRIEF_MAX_BYTES });
      } else if (code !== 'OFFLINE') show(t.errors[code]);
    }
  };

  const parseFile = () => {
    if (!file) return;
    if (file.size != null && file.size > BRIEF_MAX_BYTES) {
      return setFileProblem({ reason: 'TOO_LARGE', size: file.size, max: BRIEF_MAX_BYTES });
    }
    void readBrief(briefForm(file), file);
  };

  const parseText = () => {
    if (!text.trim()) return setTextError(w.textEmpty);
    void readBrief({ text: text.trim() }, null);
  };

  const choose = async () => {
    try {
      const picked = await pickBriefFile();
      if (!picked) return;
      setFile(picked);
      setFileProblem(
        picked.size != null && picked.size > BRIEF_MAX_BYTES ? { reason: 'TOO_LARGE', size: picked.size, max: BRIEF_MAX_BYTES } : null,
      );
    } catch {
      show(t.errors.INTERNAL);
    }
  };

  // ── Manual mode ────────────────────────────────────────────────────────────

  const saveManual = async (): Promise<boolean> => {
    if (!currentTasks.tasks) {
      setManualError(currentTasks.error);
      return false;
    }
    setManualError(null);
    if (!manualDirty && hasTasks) return true;
    try {
      const next = await request<DraftView>(`/projects/${id}/tasks`, { method: 'PUT', body: { tasks: currentTasks.tasks } });
      setDraft(next);
      savedRows.current = rows;
      return true;
    } catch (err) {
      show(t.errors[errorCode(err)]);
      return false;
    }
  };

  const nextManual = async () => {
    setBusy(true);
    const ok = await saveManual();
    setBusy(false);
    if (ok) goStep(wizardHref.plan(id));
  };

  // ── Close / back ───────────────────────────────────────────────────────────

  const back = async () => {
    // Complete manual edits are saved on the way back; incomplete ones can't be saved and are dropped.
    if (mode === 'manual' && manualDirty && currentTasks.tasks && !(await saveManual())) return;
    goStep(wizardHref.basics(id));
  };

  const close = useWizardClose({
    needsConfirm: true,
    copy: { body: t.wizard.close.bodyDraft },
    beforeLeave: async () => {
      abort.current?.abort();
      // Unsaved manual tasks are kept when they are complete; otherwise the saved draft stays as it was.
      if (mode === 'manual' && manualDirty && currentTasks.tasks) return saveManual();
    },
  });

  if (reading) {
    return (
      <WizardScreen step={3} onClose={close.requestClose}>
        <WizardTitle parts={[t.wizard.reading.titlePre, { hl: 'lemon', text: t.wizard.reading.titleHl }, t.wizard.reading.titlePost]} />
        <DocScan />
        <Checks
          label={reading.label}
          items={[
            { text: reading.label, state: 'current' },
            { text: t.wizard.reading.checkScores, state: 'waiting' },
            { text: t.wizard.reading.checkList, state: 'waiting' },
          ]}
        />
        {close.closeSheet}
      </WizardScreen>
    );
  }

  // ── Footer by mode ─────────────────────────────────────────────────────────

  let footer: ReactNode;
  if (mode === 'manual') {
    footer = (
      <>
        <TotalChip total={manualTotal(rows)} />
        <Button title={t.wizard.next} block loading={busy} onPress={nextManual} />
      </>
    );
  } else {
    const fresh = mode === 'upload' ? !!file : !!text.trim();
    footer = !fresh && hasTasks ? (
      <Button title={t.wizard.next} block onPress={() => goStep(wizardHref.plan(id))} />
    ) : (
      <Button
        title={aiReads ? w.parseAi : w.parse}
        block
        disabled={!fresh || (mode === 'upload' && !!fileProblem && fileProblem.reason !== 'NETWORK')}
        onPress={mode === 'upload' ? parseFile : parseText}
      />
    );
  }

  const problemMeta = (p: FileProblem) =>
    ({
      TOO_LARGE: w.tooLargeMeta(formatBytes(p.max)),
      UNSUPPORTED_TYPE: w.unsupportedMeta,
      EMPTY: w.emptyMeta,
      NETWORK: w.failedMeta,
    })[p.reason];
  const problemText = (p: FileProblem) =>
    ({
      TOO_LARGE: w.tooLarge(formatBytes(p.size ?? p.max)),
      UNSUPPORTED_TYPE: w.unsupported,
      EMPTY: w.empty,
      NETWORK: w.failed,
    })[p.reason];

  return (
    <WizardScreen step={2} onBack={back} onClose={close.requestClose} footer={footer}>
      <WizardTitle parts={[w.titlePre, { hl: 'sky', text: w.titleHl }]} />
      <Seg<InputMode>
        label={w.mode}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'upload', label: w.modeUpload },
          { value: 'text', label: w.modeText },
          { value: 'manual', label: w.modeManual },
        ]}
      />

      {mode !== 'manual' && hasTasks ? <NoteBox tone="warn">{w.replaceWarn(draft.tasks.length)}</NoteBox> : null}

      {mode === 'upload' && (
        <View
          style={{
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: c.line,
            borderRadius: 20,
            padding: 18,
            gap: 12,
            backgroundColor: c.card,
          }}>
          {file ? (
            <>
              <FileChip
                name={file.name}
                mimeType={file.mimeType}
                meta={fileProblem ? problemMeta(fileProblem) : w.picked(file.size != null ? formatBytes(file.size) : '')}
                error={!!fileProblem}
                onRemove={() => {
                  setFile(null);
                  setFileProblem(null);
                }}
                removeLabel={w.remove}
              />
              {fileProblem ? <ErrorText>{problemText(fileProblem)}</ErrorText> : null}
            </>
          ) : draft.briefFileName ? (
            <FileChip name={draft.briefFileName} meta={w.usedBefore} />
          ) : null}
          <Button
            title={file || draft.briefFileName ? w.replace : w.pick}
            kind="soft"
            block
            icon={<Icon name="upload" size={18} color={c.ink} />}
            onPress={choose}
          />
          <Hint>{w.uploadHint}</Hint>
        </View>
      )}

      {mode === 'text' && (
        <Field
          label={w.textLabel}
          error={textError}
          hint={
            <View style={styles.textFoot}>
              <Txt v="meta" style={{ flexShrink: 1 }}>
                {w.textHint}
              </Txt>
              {typedCount ? (
                <Txt v="meta" weight={700} color="grapeText" aria-live="polite">
                  {typedCount.about ? w.textCountAbout(typedCount.n) : w.textCount(typedCount.n)}
                </Txt>
              ) : null}
            </View>
          }>
          <Input
            label={w.textLabel}
            value={text}
            onChangeText={(v) => {
              setText(v);
              setTextError(null);
            }}
            placeholder={w.textPlaceholder}
            multiline
            maxLength={20000}
            invalid={!!textError}
          />
        </Field>
      )}

      {mode === 'manual' && (
        <>
          <ManualEditor
            rows={rows}
            onChange={(r) => {
              setRows(r);
              setManualError(null);
            }}
            tz={tz}
            deadline={draft.basics.deadline}
            error={manualError}
          />
          <Hint>{t.wizard.manual.hint(dates.date(draft.basics.deadline))}</Hint>
        </>
      )}

      {close.closeSheet}
    </WizardScreen>
  );
}
