import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { draftStepHref } from '@/features/wizard/nav';
import { DraftLoading, useDraft } from '@/features/wizard/useDraft';

/** 继续编辑: opens a draft on the step it was left on (home can link to /new/{id}). */
export default function ResumeDraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { draft, error, reload } = useDraft(id, null);

  useEffect(() => {
    if (draft) router.replace(draftStepHref(id, draft.basics.draftStep));
  }, [draft, id]);

  return <DraftLoading step={draft?.basics.draftStep ?? 1} error={error} onRetry={reload} />;
}
