import { useState } from 'react';
import { formatPoints, formatTotal } from '@shared/planning';
import type { MoveTaskInput, PackageView, ProjectView, TaskView } from '@shared/types';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { OptRow, ownerOf, PackageTile } from './parts';

/**
 * 移动任务 (MoveTask mockup): the task's package first (disabled), then every other package in order
 * with its points before → after. Moving needs nobody's consent; both owners are notified.
 */
export function MoveTaskSheet({
  project,
  task,
  onClose,
  onChange,
  onError,
}: {
  project: ProjectView;
  task: TaskView;
  onClose: () => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const m = t.project.move;
  const { request } = useSession();
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const current = project.packages.find((p) => p.id === task.packageId) ?? null;
  const others = project.packages.filter((p) => p.id !== task.packageId);

  const label = (p: PackageView) => {
    const owner = ownerOf(project, p);
    if (!owner) return m.free(p.index);
    return m.owned(p.index, owner.id === project.viewerMemberId ? m.you(owner.name) : owner.name);
  };

  const move = async (p: PackageView) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const body: MoveTaskInput = { packageId: p.id };
      const view = await request<ProjectView>(`/projects/${project.basics.id}/tasks/${task.id}/move`, { method: 'POST', body });
      onChange(view);
      show(m.moved(p.index));
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible onClose={busy ? () => {} : onClose} title={m.title}>
      <Txt v="small" color="ink2">
        {m.question(task.title, formatPoints(task.points))}
      </Txt>
      {current ? (
        <OptRow
          leading={<PackageTile index={current.index} owner={ownerOf(project, current)} />}
          title={label(current)}
          sub={m.here}
          onPress={() => {}}
          disabled
        />
      ) : null}
      {others.map((p) => (
        <OptRow
          key={p.id}
          leading={<PackageTile index={p.index} owner={ownerOf(project, p)} />}
          title={label(p)}
          sub={m.change(formatTotal(p.points), formatTotal(p.points + task.points))}
          onPress={() => move(p)}
          busy={busy === p.id}
        />
      ))}
      <Txt v="meta">{m.hint}</Txt>
    </Sheet>
  );
}
