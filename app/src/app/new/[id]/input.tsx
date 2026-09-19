import { useLocalSearchParams } from 'expo-router';
import { InputStep } from '@/features/wizard/InputStep';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** Step 2: upload a brief, describe it, or list tasks by hand (?mode=upload|text|manual). */
export default function DraftInputScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>();
  const { draft, setDraft, error, reload } = useDraft(id, 2);
  if (!draft) return <DraftLoading step={2} error={error} onRetry={reload} />;
  return <InputStep draft={draft} setDraft={setDraft} mode={mode} />;
}
