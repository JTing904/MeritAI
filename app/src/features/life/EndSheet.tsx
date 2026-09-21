import { useState } from 'react';
import { View } from 'react-native';
import { ENDED_KEEP_DAYS } from '@shared/constants';
import { projectTag } from '@shared/format';
import type { ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { appNow } from '@/lib/lifecycle';
import { useSession } from '@/lib/session';
import { Bullets } from './Bullets';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 结束项目 (EndSheet mockup; leader, ACTIVE or AWAITING_CONFIRM): what ending means, then 确认结束.
 * Mount it to open it. The answer is the ENDED project view.
 */
export function EndSheet({
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
  const { t } = useI18n();
  const e = t.life.end;
  const { request } = useSession();
  const { show } = useToast();
  const dates = useLocalDates();
  const [busy, setBusy] = useState(false);
  const tag = projectTag(project.basics.name, project.basics.shortCode);
  const purge = new Date(appNow().getTime() + ENDED_KEEP_DAYS * DAY_MS);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const view = await request<ProjectView>(`/projects/${encodeURIComponent(project.basics.id)}/end`, { method: 'POST' });
      onChange(view);
      show(e.done(tag));
      onClose();
    } catch (err) {
      onError(err);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={e.title}>
      <Txt v="body" weight={800} size={17}>
        {e.heading(tag)}
      </Txt>
      <Bullets items={[e.notify, e.frozen(project.pendingReviews.length), e.purge(dates.date(purge)), e.undo]} />
      <View style={{ gap: 10, marginTop: 6 }}>
        <Button title={e.confirm} block loading={busy} onPress={confirm} />
        <Button title={t.common.cancel} kind="soft" block onPress={onClose} />
      </View>
    </Sheet>
  );
}
