import { router } from 'expo-router';
import type { ProjectView } from '@shared/types';
import { useI18n } from '@/i18n';
import { isLive } from '@/lib/lifecycle';
import { NoticeCard } from './parts';

export const freePackageCount = (project: ProjectView) => project.packages.filter((p) => p.ownerMemberId === null).length;

/** Opens the project page with the re-split sheet (used where the sheet itself isn't mounted). */
export const openResplit = (projectId: string) =>
  router.push({ pathname: '/project/[id]', params: { id: projectId, open: 'resplit' } });

/**
 * The viewer has no package (NoPackage mockup): free packages → 去选任务包; none left → a warn card
 * (a member waits for the leader; a leader who also does tasks can re-split). Null when the viewer has one.
 * The pick screen shows it only when no package is free. `onResplit` defaults to opening the project page's sheet.
 */
export function NeedsPackageCard({ project, onResplit }: { project: ProjectView; onResplit?: () => void }) {
  const { t } = useI18n();
  const n = t.project.needs;
  if (!project.viewerNeedsPackage || !isLive(project.basics.status)) return null;
  const free = freePackageCount(project);
  const id = project.basics.id;
  if (free > 0) {
    return (
      <NoticeCard
        tone="plain"
        emoji="📦"
        title={n.pickTitle}
        body={n.pickBody(free)}
        action={{ title: n.pick, onPress: () => router.push({ pathname: '/project/[id]/pick', params: { id } }) }}
      />
    );
  }
  if (project.viewerRole === 'LEADER') {
    return (
      <NoticeCard
        tone="warn"
        emoji="📦"
        title={n.leaderTitle}
        body={n.leaderBody}
        action={{ title: n.resplit, kind: 'soft', onPress: onResplit ?? (() => openResplit(id)) }}
      />
    );
  }
  return <NoticeCard tone="warn" emoji="📦" title={n.waitTitle} body={n.waitBody} />;
}

/** Leader view: other members have no package and none is free → 有 N 位组员还没有任务包 + 重新分包. */
export function PackagelessBanner({ project, onResplit }: { project: ProjectView; onResplit: () => void }) {
  const { t } = useI18n();
  if (project.viewerRole !== 'LEADER' || freePackageCount(project) > 0 || !isLive(project.basics.status)) return null;
  const waiting = project.members.filter((m) => m.needsPackage && m.id !== project.viewerMemberId).length;
  if (waiting === 0) return null;
  return (
    <NoticeCard
      tone="warn"
      emoji="👋"
      title={t.project.needs.others(waiting)}
      action={{ title: t.project.needs.resplit, kind: 'soft', onPress: onResplit }}
    />
  );
}
