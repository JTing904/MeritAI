import { useLocalSearchParams } from 'expo-router';
import { BasicsStep } from '@/features/wizard/BasicsStep';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** Step 1 for an existing draft (上一步 from step 2, or 继续编辑). */
export default function DraftBasicsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { draft, error, reload } = useDraft(id, 1);
  if (!draft) return <DraftLoading step={1} error={error} onRetry={reload} />;
  return <BasicsStep draft={draft} />;
}
