import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { projectTag } from '@shared/format';
import { formatTotal } from '@shared/planning';
import type { PackageView, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Rich, type RichPart } from '@/components/Rich';
import { AppBar, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { CardFoot } from '@/features/pick/CardFoot';
import { Carousel } from '@/features/pick/Carousel';
import { Confetti } from '@/features/pick/Confetti';
import { packageTasks, pickFoot, startIndex } from '@/features/pick/foot';
import { PackageCard } from '@/features/pick/PackageCard';
import { FrozenLine } from '@/features/life/LifecycleCard';
import { LeaderTools } from '@/features/project/LeaderTools';
import { NeedsPackageCard } from '@/features/project/NeedsPackage';
import { ResplitSheet } from '@/features/project/ResplitSheet';
import { useProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { isEnded, isLive } from '@/lib/lifecycle';
import { packageSpread } from '@/lib/packages';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

/** 选任务包 (prototype §4.7 + PickPending): swipe through the packages, pick, switch or ask to swap. */
export default function PickScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const p = t.pick;
  const { c } = useTheme();
  const { request } = useSession();
  const { show } = useToast();
  const { project, error, reload, setProject, onError } = useProject(id);
  const [burst, setBurst] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [resplitting, setResplitting] = useState(false);
  // State updates aren't synchronous: a double tap must not send twice.
  const sending = useRef(false);

  const gear = (
    <Pressable
      onPress={() => router.push({ pathname: '/project/[id]/settings', params: { id } })}
      role="button"
      aria-label={p.settings}
      hitSlop={4}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="gear" size={20} color={c.ink} />
    </Pressable>
  );

  if (!project) {
    return (
      <Screen header={<AppBar title={p.title} right={gear} />}>
        {error ? (
          <Card style={{ gap: 12 }}>
            <Txt v="text" color="bad">
              {t.errors[error]}
            </Txt>
            <Button title={t.common.retry} kind="soft" onPress={() => void reload()} />
          </Card>
        ) : (
          <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />
        )}
      </Screen>
    );
  }

  const packages = [...project.packages].sort((a, b) => a.index - b.index);
  const tag = projectTag(project.basics.name, project.basics.shortCode);
  const me = project.members.find((m) => m.id === project.viewerMemberId);
  const myColor = me?.color ?? 'lemon';
  const hadPackage = packages.some((x) => x.ownerMemberId === project.viewerMemberId);
  const people = project.members.filter((m) => m.active).length;
  const free = packages.filter((x) => x.ownerMemberId === null).length;
  const leader = project.viewerRole === 'LEADER';
  // ENDED: the packages can be looked at, not picked or swapped.
  const ended = isEnded(project.basics.status);

  // Title (the same test as wizard step 6): equal packages say their points, even ones the average,
  // uneven ones say so and the intro gives the biggest and smallest.
  const spread = packageSpread(packages);
  const title: RichPart[] =
    spread.kind === 'uneven'
      ? [p.titleUneven, p.titleEnd]
      : [
          spread.kind === 'equal' ? p.titleEqual : p.titleAbout,
          { hl: myColor, text: p.titleHl(formatTotal(spread.kind === 'equal' ? spread.max : spread.average)) },
          p.titleEnd,
        ];
  const intro = spread.kind === 'uneven' ? p.introUneven(formatTotal(spread.max), formatTotal(spread.min)) : p.intro;

  const source = project.basics.planSource;
  const dueHint = source === 'AI' || source === 'MODEL' ? p.dueHint.ai : source === 'RULES' ? p.dueHint.rules : null;

  const openTask = (taskId: string) => router.push({ pathname: '/project/[id]/task/[taskId]', params: { id, taskId } });

  const send = async (key: string, run: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(key);
    try {
      await run();
    } catch (err) {
      onError(err);
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const pick = (pkg: PackageView) =>
    send(`pick:${pkg.id}`, async () => {
      const view = await request<ProjectView>(
        `/projects/${encodeURIComponent(id)}/packages/${encodeURIComponent(pkg.id)}/pick`,
        { method: 'POST' },
      );
      setProject(view);
      const got = view.packages.find((x) => x.id === pkg.id);
      if (got?.ownerMemberId !== view.viewerMemberId) return;
      setBurst((n) => n + 1);
      show(hadPackage ? p.toast.switched(got.index) : p.toast.picked(got.index));
    });

  const requestSwap = (pkg: PackageView) =>
    send(`swap:${pkg.id}`, async () => {
      const owner = project.members.find((m) => m.id === pkg.ownerMemberId);
      const view = await request<ProjectView>(`/projects/${encodeURIComponent(id)}/swaps`, {
        method: 'POST',
        body: { packageId: pkg.id },
      });
      setProject(view);
      show(p.toast.requested(owner?.name ?? ''));
    });

  return (
    <View style={{ flex: 1 }}>
      <Screen header={<AppBar title={p.title} sub={p.sub(tag, people)} right={gear} />}>
        <View>
          <Rich size={23} parts={title} />
          <Txt v="text" color="muted" style={{ marginTop: 4 }}>
            {intro}
          </Txt>
        </View>

        {ended ? <FrozenLine /> : null}
        {/* The project page's warn card (null unless the viewer needs a package). */}
        {free === 0 && <NeedsPackageCard project={project} onResplit={() => setResplitting(true)} />}

        <Carousel initialIndex={startIndex(project, packages)} dotLabel={(i) => t.labels.packageN(packages[i]?.index ?? i + 1)}>
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              tasks={packageTasks(project, pkg)}
              owner={project.members.find((m) => m.id === pkg.ownerMemberId) ?? null}
              deadline={project.basics.deadline}
              onOpenTask={openTask}
              foot={
                ended ? null : (
                  <CardFoot
                    project={project}
                    pkg={pkg}
                    foot={pickFoot(project, pkg)}
                    myColor={myColor}
                    busy={busy}
                    onPick={(x) => void pick(x)}
                    onRequestSwap={(x) => void requestSwap(x)}
                    onOpenTask={openTask}
                    onChange={setProject}
                    onError={onError}
                  />
                )
              }
            />
          ))}
        </Carousel>

        {leader && <LeaderTools project={project} onChange={setProject} variant="pick" onError={onError} />}
        {resplitting && leader && isLive(project.basics.status) && (
          <ResplitSheet project={project} onClose={() => setResplitting(false)} onChange={setProject} onError={onError} />
        )}
        {dueHint && (
          <Txt v="meta" center>
            {dueHint}
          </Txt>
        )}
      </Screen>
      <Confetti burst={burst} />
    </View>
  );
}
