import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { projectTag } from '@shared/format';
import type { PackageView, TaskView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Seg } from '@/components/Controls';
import { Icon } from '@/components/Icon';
import { AppBar, Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { EndSheet } from '@/features/life/EndSheet';
import { FrozenLine, LifecycleCard } from '@/features/life/LifecycleCard';
import { ReopenSheet } from '@/features/life/ReopenSheet';
import { ProjectInfoSheet } from '@/features/members/ProjectInfoSheet';
import { AssignSheet } from '@/features/project/AssignSheet';
import { BriefCard } from '@/features/project/BriefCard';
import { FeedList, useFeed } from '@/features/project/Feed';
import { Leaderboard } from '@/features/project/Leaderboard';
import { ProjectHero } from '@/features/project/Hero';
import { LeaderTools } from '@/features/project/LeaderTools';
import { MoveTaskSheet } from '@/features/project/MoveTaskSheet';
import { NeedsPackageCard, PackagelessBanner } from '@/features/project/NeedsPackage';
import { PackageList } from '@/features/project/PackageList';
import { isFinished } from '@/features/project/parts';
import { ResplitSheet } from '@/features/project/ResplitSheet';
import { ReviewQueue } from '@/features/project/ReviewQueue';
import { useProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { isEnded, isLive } from '@/lib/lifecycle';
import { useTheme } from '@/theme';

type Tab = 'packages' | 'rank' | 'feed';

/**
 * Project page (ProjectLeader, NoPackage and ReviewQueue mockups, proto §4.5; M5: DueLeader / DueMember /
 * Ended). `?open=resplit` opens the re-split sheet, `?open=end` the 结束项目 sheet (PROJECT_DUE).
 */
export default function ProjectScreen() {
  const { id, open } = useLocalSearchParams<{ id: string; open?: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const p = t.project;
  const { project, error, reload, setProject, onError } = useProject(id);
  const [tab, setTab] = useState<Tab>('packages');
  const [openPkgs, setOpenPkgs] = useState<Set<string>>(() => new Set());
  // Ids, so an open sheet always shows the latest view of its package or task.
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [resplitting, setResplitting] = useState(false);
  // M5: 结束项目, 重新打开 and 延后截止日期 (the project info sheet).
  const [lifeSheet, setLifeSheet] = useState<'end' | 'reopen' | 'info' | null>(null);
  const feed = useFeed(id, tab === 'feed', project?.packagesVersion ?? 0);

  const isLeader = project?.viewerRole === 'LEADER';
  // AWAITING_CONFIRM works like ACTIVE; ENDED is read-only (the leader can still grade PENDING attempts).
  const running = !!project && isLive(project.basics.status);
  const ended = !!project && isEnded(project.basics.status);
  const tools = !!project && isLeader && running;
  // Checked against every fresh view (as PackageList offers them): after someone picks the package, or the
  // task gets finished, the reload closes the sheet instead of leaving it open on a target that now fails.
  const someoneWaiting = !!project?.members.some((m) => m.needsPackage);
  const assigning =
    (tools && someoneWaiting && project.packages.find((pkg) => pkg.id === assigningId && pkg.ownerMemberId === null)) || null;
  // A task waiting for review can't move (TASK_UNDER_REVIEW): grade it first.
  const moving =
    (tools && project.tasks.find((task) => task.id === movingId && !isFinished(task) && task.status !== 'REVIEWING')) || null;
  // Forget a sheet whose target stopped being valid, so it doesn't reopen if the target becomes valid again.
  useEffect(() => {
    if (assigningId && !assigning) setAssigningId(null);
  }, [assigningId, assigning]);
  useEffect(() => {
    if (movingId && !moving) setMovingId(null);
  }, [movingId, moving]);

  // The viewer's own package opens by default (also one they get later, by picking or being assigned).
  const myPackageId = project?.members.find((m) => m.id === project.viewerMemberId)?.packageId ?? null;
  useEffect(() => {
    if (myPackageId) setOpenPkgs((prev) => (prev.has(myPackageId) ? prev : new Set(prev).add(myPackageId)));
  }, [myPackageId]);

  // From a MEMBER_NEEDS_PACKAGE / PROJECT_DUE notification: open the sheet once, then drop the parameter.
  useEffect(() => {
    if (!project || (open !== 'resplit' && open !== 'end')) return;
    if (isLeader && running) {
      if (open === 'resplit') setResplitting(true);
      else setLifeSheet('end');
    }
    router.setParams({ open: undefined });
  }, [project, open, isLeader, running]);

  const toggle = (packageId: string) =>
    setOpenPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(packageId)) next.delete(packageId);
      else next.add(packageId);
      return next;
    });

  const settings = (
    <Pressable
      onPress={() => router.push({ pathname: '/project/[id]/settings', params: { id } })}
      role="button"
      aria-label={p.settings}
      hitSlop={4}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="gear" size={20} color={c.ink} />
    </Pressable>
  );

  let title = '';
  let sub: string | undefined;
  if (project) {
    const b = project.basics;
    title = projectTag(b.name, b.shortCode);
    const active = project.members.filter((m) => m.active).length;
    if (ended) sub = p.sub.ended(active);
    else if (isLeader) sub = b.leaderManages ? p.sub.leaderManages(active) : p.sub.leader(active);
    else sub = p.sub.member(project.members.find((m) => m.role === 'LEADER' && m.active)?.name ?? '');
  }

  // After a failed page only the feed's 再试一次 loads more: scrolling must not retry in a loop.
  const onEndReached = tab === 'feed' && feed.hasMore && !feed.moreFailed ? feed.loadMore : undefined;

  return (
    <Screen header={<AppBar title={title} sub={sub} right={project ? settings : undefined} />} onEndReached={onEndReached}>
      {error ? (
        <Card style={{ gap: 12 }}>
          <Txt v="text" color="bad">
            {t.errors[error]}
          </Txt>
          <Button title={t.common.retry} kind="soft" onPress={() => void reload()} />
        </Card>
      ) : !project ? (
        <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />
      ) : (
        <>
          <ProjectHero project={project} />
          <LifecycleCard
            project={project}
            onEnd={() => setLifeSheet('end')}
            onExtend={() => setLifeSheet('info')}
            onReopen={() => setLifeSheet('reopen')}
          />
          <ReviewQueue project={project} />
          <NeedsPackageCard project={project} onResplit={() => setResplitting(true)} />
          {!project.viewerNeedsPackage ? <PackagelessBanner project={project} onResplit={() => setResplitting(true)} /> : null}
          <BriefCard project={project} />

          <Seg
            label={p.tabs.label}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'packages', label: p.tabs.packages },
              { value: 'rank', label: p.tabs.rank },
              { value: 'feed', label: p.tabs.feed },
            ]}
          />

          {tab === 'packages' ? (
            <>
              {ended ? <FrozenLine /> : null}
              <PackageList
                project={project}
                open={openPkgs}
                onToggle={toggle}
                onAssign={(pkg: PackageView) => setAssigningId(pkg.id)}
                onMove={(task: TaskView) => setMovingId(task.id)}
              />
              <LeaderTools project={project} onChange={setProject} variant="project" onError={onError} />
              <Txt v="meta" center>
                {p.footer}
              </Txt>
            </>
          ) : tab === 'rank' ? (
            <Leaderboard project={project} />
          ) : (
            <View style={{ gap: 12 }}>
              <FeedList project={project} feed={feed} />
            </View>
          )}

          {assigning ? (
            <AssignSheet
              project={project}
              pkg={assigning}
              onClose={() => setAssigningId(null)}
              onChange={setProject}
              onError={onError}
            />
          ) : null}
          {moving ? (
            <MoveTaskSheet project={project} task={moving} onClose={() => setMovingId(null)} onChange={setProject} onError={onError} />
          ) : null}
          {resplitting && tools ? (
            <ResplitSheet project={project} onClose={() => setResplitting(false)} onChange={setProject} onError={onError} />
          ) : null}
          {lifeSheet === 'end' && isLeader && running ? (
            <EndSheet project={project} onClose={() => setLifeSheet(null)} onChange={setProject} onError={onError} />
          ) : null}
          {lifeSheet === 'reopen' && isLeader && ended ? (
            <ReopenSheet project={project} onClose={() => setLifeSheet(null)} onChange={setProject} onError={onError} />
          ) : null}
          {lifeSheet === 'info' && isLeader && running ? (
            <ProjectInfoSheet project={project} onClose={() => setLifeSheet(null)} onSaved={setProject} onError={onError} />
          ) : null}
        </>
      )}
    </Screen>
  );
}
