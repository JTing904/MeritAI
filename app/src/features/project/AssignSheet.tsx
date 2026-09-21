import { useState } from 'react';
import type { AssignInput, MemberView, PackageView, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { OptRow } from './parts';
import { appNow } from '@/lib/lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 指派任务包 N (AssignPackage mockup): a free package to someone who has none. */
export function AssignSheet({
  project,
  pkg,
  onClose,
  onChange,
  onError,
}: {
  project: ProjectView;
  pkg: PackageView;
  onClose: () => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const a = t.project.assign;
  const { request } = useSession();
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const now = appNow().getTime();
  const waiting = project.members.filter((m) => m.needsPackage);

  const assign = async (m: MemberView) => {
    if (busy) return;
    setBusy(m.id);
    try {
      const body: AssignInput = { memberId: m.id };
      const view = await request<ProjectView>(`/projects/${project.basics.id}/packages/${pkg.id}/assign`, { method: 'POST', body });
      onChange(view);
      show(a.assigned(m.name));
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={a.title(pkg.index)}>
      <Txt v="small" color="ink2">
        {a.body}
      </Txt>
      {waiting.map((m) => (
        <OptRow
          key={m.id}
          leading={<Avatar name={m.name} hl={m.color} decorative />}
          title={m.id === project.viewerMemberId ? a.you(m.name) : m.name}
          sub={now - new Date(m.joinedAt).getTime() < DAY_MS ? a.justJoined : a.noPackage}
          onPress={() => assign(m)}
          busy={busy === m.id}
        />
      ))}
      <Txt v="meta">{a.hint}</Txt>
    </Sheet>
  );
}
