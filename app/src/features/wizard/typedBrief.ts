import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '@/lib/prefs';

// The server keeps a typed brief only once the rules have split it into tasks. Until then the text
// lives here, per draft: it survives the 「拆不了」 step, closing the wizard (the ✕ sheet promises the
// draft is kept) and an app restart on this device.

const memory = new Map<string, string>();
// Bumped on sign-out: a step still on screen then must not write its text back afterwards.
let epoch = 0;
const storageKey = (draftId: string) => `meritai.brief.${draftId}`;
const SAVE_DELAY_MS = 400;

/** Sign-out: forget every draft's typed text in memory (storage is cleared by clearUserPrefs). */
export function forgetTypedBriefs() {
  epoch++;
  memory.clear();
}

/** Whether text typed for this draft is waiting in memory (known before the first render). */
export const hasTypedBrief = (draftId: string) => memory.has(draftId);

/**
 * The typed brief of a draft, with a setter that keeps it and `clear` for once it became tasks.
 * `onRestore` runs when text comes back from storage after the step is already on screen.
 */
export function useTypedBrief(draftId: string, onRestore?: () => void) {
  const [text, setTextState] = useState(() => memory.get(draftId) ?? '');
  const touched = useRef(memory.has(draftId));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const restored = useRef(onRestore);
  restored.current = onRestore;
  const born = useRef(epoch);
  const save = useCallback(
    (value: string | null) => {
      if (born.current === epoch) void writePref(storageKey(draftId), value);
    },
    [draftId],
  );

  // After an app restart the text is only in storage.
  useEffect(() => {
    if (touched.current) return;
    let alive = true;
    void readPref(storageKey(draftId)).then((saved) => {
      if (!alive || !saved || touched.current || born.current !== epoch) return;
      memory.set(draftId, saved);
      setTextState(saved);
      restored.current?.();
    });
    return () => {
      alive = false;
    };
  }, [draftId]);

  // Leaving the step (next route, ✕) writes what is still waiting for the debounce.
  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
      save(pending.current);
    },
    [save],
  );

  const setText = useCallback(
    (value: string) => {
      touched.current = true;
      setTextState(value);
      if (born.current !== epoch) return;
      const kept = value.trim() ? value : null;
      if (kept) memory.set(draftId, kept);
      else memory.delete(draftId);
      pending.current = kept;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        save(kept);
      }, SAVE_DELAY_MS);
    },
    [draftId, save],
  );

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    memory.delete(draftId);
    void writePref(storageKey(draftId), null);
  }, [draftId]);

  return { text, setText, clear };
}

// The same rules as the server's typedLineTitles (server/src/lib/plan/rules.ts).
// "40%", "40 ％", "占 40 分", "40 marks", "12.5 pts": the rules may split by these scores instead of by line.
const SCORE = /\d+(?:\.\d+)?\s*(?:%|％|分(?!钟)|marks?\b|pts?\b|points?\b)/i;
// Longer lines are read as a paragraph, not as one task.
const PARAGRAPH_CHARS = 200;
// 「要做的事：」 only introduces the lines below it.
const LEAD_IN = /[:：]$/;
// Only numbers, punctuation and symbols ("3.", "•", "20%"): no name to make a task from.
const NO_NAME = /^[\s\d.,;:!?%()[\]{}<>\-–—_+*=\/\\|#~'"`^&@$•·●○◦▪■□◆◇►▶➢➤✓✔❖‣∙、。，；：！？（）【】《》「」『』％．]*$/;
// A typed list longer than this is cut.
const MAX_TASKS = 50;

/**
 * The live 「会拆成 N 个任务」 count: in a typed description every line ended with the Enter key is a
 * task (screen wrapping doesn't count), except lead-in lines, lines with no name and paragraph-long
 * lines. Null below two tasks. `about` when the scores in the text may split it instead.
 */
export function typedTaskCount(text: string): { n: number; about: boolean } | null {
  const lines = text
    .split(/\r\n|\r|\n|\u2028|\u2029/)
    .map((l) => l.trim())
    .filter(Boolean);
  const tasks = lines.filter((l) => l.length <= PARAGRAPH_CHARS && !LEAD_IN.test(l) && !NO_NAME.test(l));
  if (tasks.length < 2) return null;
  return { n: Math.min(tasks.length, MAX_TASKS), about: lines.some((l) => SCORE.test(l)) };
}
