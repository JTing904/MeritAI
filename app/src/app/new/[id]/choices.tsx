import { useLocalSearchParams } from 'expo-router';
import { ChoiceStep } from '@/features/wizard/ChoiceStep';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** Step 4 (M6): the 选择题 the AI found, one screen each (?q=index). */
export default function DraftChoicesScreen() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { draft, setDraft, error, reload } = useDraft(id, 4);
  if (!draft) return <DraftLoading step={4} error={error} onRetry={reload} />;
  const index = Number(q);
  return <ChoiceStep draft={draft} setDraft={setDraft} start={Number.isInteger(index) && index > 0 ? index : 0} />;
}
