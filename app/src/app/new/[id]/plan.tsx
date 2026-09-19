import { useLocalSearchParams } from 'expo-router';
import { PlanStep } from '@/features/wizard/PlanStep';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** Step 5: review the plan (?method=SCORES|LIST&found=n right after the free rules split a brief). */
export default function DraftPlanScreen() {
  const { id, method, found } = useLocalSearchParams<{ id: string; method?: string; found?: string }>();
  const { draft, setDraft, error, reload } = useDraft(id, 5);
  if (!draft) return <DraftLoading step={5} error={error} onRetry={reload} />;
  const count = Number(found);
  const kind = method === 'SCORES' || method === 'LIST' ? method : null;
  const result: { method: 'SCORES' | 'LIST'; found: number } | null =
    kind && Number.isFinite(count) && count > 0 ? { method: kind, found: count } : null;
  return <PlanStep draft={draft} setDraft={setDraft} found={result} />;
}
