import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { projectTag } from '@shared/format';
import type { ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { activeMembers, memberPackage } from './format';
import { OptRow } from './OptRow';

/**
 * 「我自己退出」 (PickNewLeader mockup): the leader picks the next leader among the other active members,
 * then hands the role over and leaves in one step (POST leave-as-leader) and lands on home.
 */
export function PickNewLeaderSheet({
  visible,
  project,
  onClose,
  onError,
}: {
  visible: boolean;
  project: ProjectView;
  onClose: () => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const p = t.members.pickLeader;
  const { request } = useSession();
  const { show } = useToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = activeMembers(project).filter((m) => m.id !== project.viewerMemberId);
  // The first one is picked when the sheet opens (as in the mockup); a pick who left meanwhile falls back to it.
  const picked = candidates.find((m) => m.id === chosen) ?? candidates[0] ?? null;
  useEffect(() => {
    if (visible) setChosen(null);
  }, [visible]);

  const tag = projectTag(project.basics.name, project.basics.shortCode);

  const confirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      await request<null>(`/projects/${encodeURIComponent(project.basics.id)}/leave-as-leader`, {
        method: 'POST',
        body: { newLeaderMemberId: picked.id },
      });
      onClose();
      router.dismissTo('/');
      show(t.members.page.left(tag));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={p.title}>
      <Txt v="small" color="ink2">
        {p.body}
      </Txt>
      <View role="radiogroup" aria-label={p.title} style={{ gap: 10 }}>
        {candidates.map((m) => {
          const pkg = memberPackage(project, m);
          return (
            <OptRow
              key={m.id}
              leading={<Avatar name={m.name} hl={m.color} decorative />}
              title={m.name}
              sub={pkg ? p.pkg(pkg.index) : p.noPackage}
              selected={picked?.id === m.id}
              onPress={() => setChosen(m.id)}
            />
          );
        })}
      </View>
      <Button title={p.confirm(picked?.name ?? '')} kind="danger" block loading={busy} disabled={!picked} onPress={confirm} />
      <Txt v="meta">{p.hint}</Txt>
    </Sheet>
  );
}
