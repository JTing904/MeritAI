import { useLocalSearchParams } from 'expo-router';
import { AiReadingStep } from '@/features/wizard/AiReadingStep';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** Step 3 with the leader's AI key: the AI reads the brief (polls the draft), or says why it couldn't (M6). */
export default function DraftReadingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { draft, setDraft, error, reload } = useDraft(id, 3);
  if (!draft) return <DraftLoading step={3} error={error} onRetry={reload} />;
  return <AiReadingStep draft={draft} setDraft={setDraft} />;
}
