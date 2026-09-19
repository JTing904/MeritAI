import { Sheet } from '@/components/Sheet';
import { useI18n } from '@/i18n';
import { InvitePanel } from './InvitePanel';

/** 邀请组员 on the members screen: the invite code and email / GitHub invites. */
export function InviteSheet({
  visible,
  onClose,
  projectId,
  inviteCode,
}: {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  inviteCode: string | null;
}) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.members.invite.title}>
      <InvitePanel projectId={projectId} inviteCode={inviteCode} />
    </Sheet>
  );
}
