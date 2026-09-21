import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatPoints, formatTotal } from '@shared/planning';
import type { PackageView, ProjectView, TaskView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { isLive } from '@/lib/lifecycle';
import { displayStatus } from '@/lib/status';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { isFinished, MoreButton, ownerOf, PackageTile } from './parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, boxShadow: c.shadow, overflow: 'hidden' },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
    topPressed: { backgroundColor: c.pressed },
    grow: { flex: 1, minWidth: 0 },
    who: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.card2, overflow: 'hidden', marginTop: 8 },
    fill: { height: 8, borderRadius: 4 },
    right: { alignItems: 'flex-end', flexShrink: 0 },
    tail: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 },
    tasks: { gap: 6, paddingLeft: 70, paddingRight: 16, paddingBottom: 14 },
    mini: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.card2, borderRadius: 12, paddingRight: 4 },
    miniMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      paddingLeft: 10,
      paddingRight: 6,
    },
    miniPressed: { opacity: 0.7 },
    miniTitle: { flex: 1, minWidth: 0 },
  }),
);

type Props = {
  project: ProjectView;
  /** Package ids whose task list is shown. */
  open: Set<string>;
  onToggle: (packageId: string) => void;
  /** Leader: 指派给… on a free package (only offered while someone needs a package). */
  onAssign: (pkg: PackageView) => void;
  /** Leader: 「⋯」 on an unfinished task that isn't waiting for review. */
  onMove: (task: TaskView) => void;
};

/** The 任务包 tab: one collapsible card per package, in number order (ProjectLeader mockup, proto §4.5). */
export function PackageList({ project, open, onToggle, onAssign, onMove }: Props) {
  return (
    <View style={{ gap: 10 }}>
      {project.packages.map((pkg) => (
        <PackageCard
          key={pkg.id}
          project={project}
          pkg={pkg}
          open={open.has(pkg.id)}
          onToggle={() => onToggle(pkg.id)}
          onAssign={() => onAssign(pkg)}
          onMove={onMove}
        />
      ))}
    </View>
  );
}

function PackageCard({
  project,
  pkg,
  open,
  onToggle,
  onAssign,
  onMove,
}: {
  project: ProjectView;
  pkg: PackageView;
  open: boolean;
  onToggle: () => void;
  onAssign: () => void;
  onMove: (task: TaskView) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.project.pkg;
  const owner = ownerOf(project, pkg);
  const mine = owner !== null && owner.id === project.viewerMemberId;
  const leader = project.viewerRole === 'LEADER';
  // ENDED is read-only: no assign, move or switch.
  const running = isLive(project.basics.status);
  const canAssign = leader && running && !owner && project.members.some((m) => m.needsPackage);
  const tasks = project.tasks.filter((task) => task.packageId === pkg.id);
  const reviewing = tasks.some((task) => task.status === 'REVIEWING');
  const id = project.basics.id;

  const who = owner ? (mine ? k.mine : owner.name) : k.free;
  const earned = formatPoints(pkg.earnedPoints);
  const progress = pkg.points > 0 ? Math.min(100, (pkg.earnedPoints / pkg.points) * 100) : 0;
  const total = formatTotal(pkg.points);
  const a11y = [
    t.labels.packageN(pkg.index),
    who,
    pkg.overdueCount > 0 ? k.overdue(pkg.overdueCount) : null,
    reviewing ? t.labels.status.REVIEWING : null,
    owner ? k.earned(earned) : null,
    owner ? k.total(total) : k.totalOnly(total),
  ]
    .filter(Boolean)
    .join(' · ');

  // 📨 等组长审核 while any task of the package waits for the leader's grade (after the overdue chip).
  const reviewingChip = reviewing ? <Chip>{`${t.labels.statusEmoji.REVIEWING} ${t.labels.status.REVIEWING}`}</Chip> : null;

  const whoLine = (
    <View style={s.who}>
      {owner ? <Avatar name={owner.name} hl={owner.color} size="sm" decorative /> : null}
      <Txt v="text" weight={700}>
        {who}
      </Txt>
      {pkg.overdueCount > 0 ? <Chip tone="bad">{k.overdue(pkg.overdueCount)}</Chip> : null}
      {reviewingChip}
    </View>
  );

  const tail = (
    <View style={s.tail}>
      {owner ? (
        <View style={s.right}>
          <Txt v="meta" size={12} weight={700} color="ink" tabular>
            {k.earned(earned)}
          </Txt>
          <Txt v="meta" size={12} weight={500} tabular>
            {k.total(total)}
          </Txt>
        </View>
      ) : (
        <Txt v="meta" size={12} weight={700} tabular>
          {k.totalOnly(total)}
        </Txt>
      )}
      <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
        <Icon name="chevron" size={18} color={c.muted} />
      </View>
    </View>
  );

  // 指派给… sits in the name line (which wraps it below the name on narrow screens). The row itself only
  // toggles by touch; screen readers get the name as the toggle and the assign button next to it.
  const header = canAssign ? (
    <Pressable
      onPress={onToggle}
      accessible={false}
      focusable={false}
      style={({ pressed }) => [s.top, pressed && s.topPressed]}>
      <PackageTile index={pkg.index} owner={null} />
      <View style={[s.grow, s.who]}>
        <Pressable onPress={onToggle} role="button" aria-expanded={open} aria-label={a11y} hitSlop={6}>
          <Txt v="text" weight={700}>
            {who}
          </Txt>
        </Pressable>
        {pkg.overdueCount > 0 ? <Chip tone="bad">{k.overdue(pkg.overdueCount)}</Chip> : null}
        {reviewingChip}
        <Button title={k.assign} kind="soft" small onPress={onAssign} />
      </View>
      <View importantForAccessibility="no-hide-descendants" aria-hidden>
        {tail}
      </View>
    </Pressable>
  ) : (
    <Pressable
      onPress={onToggle}
      role="button"
      aria-expanded={open}
      aria-label={a11y}
      style={({ pressed }) => [s.top, pressed && s.topPressed]}>
      <PackageTile index={pkg.index} owner={owner} />
      <View style={s.grow}>
        {whoLine}
        {owner ? (
          <View style={s.bar}>
            <View style={[s.fill, { width: `${progress}%`, backgroundColor: c.hl[owner.color].base }]} />
          </View>
        ) : null}
      </View>
      {tail}
    </Pressable>
  );

  return (
    <View style={s.card}>
      {header}
      {open ? (
        <View style={s.tasks}>
          {tasks.map((task) => {
            const status = displayStatus(task);
            const points = t.labels.points(formatPoints(task.points));
            return (
              <View key={task.id} style={s.mini}>
                <Pressable
                  onPress={() => router.push({ pathname: '/project/[id]/task/[taskId]', params: { id, taskId: task.id } })}
                  role="button"
                  aria-label={`${t.labels.status[status]} · ${task.title} · ${points}`}
                  style={({ pressed }) => [s.miniMain, pressed && s.miniPressed]}>
                  <Txt v="small" size={14} aria-hidden>
                    {t.labels.statusEmoji[status]}
                  </Txt>
                  <Txt v="small" style={s.miniTitle}>
                    {task.title}
                  </Txt>
                  <Txt v="meta" size={12} weight={600} tabular>
                    {points}
                  </Txt>
                </Pressable>
                {leader && running && !isFinished(task) && task.status !== 'REVIEWING' ? <MoreButton label={k.move} onPress={() => onMove(task)} /> : null}
              </View>
            );
          })}
          {mine && !pkg.started && running ? (
            <Button
              title={`${k.switch.emoji} ${k.switch.text}`}
              accessibilityLabel={k.switch.text}
              kind="soft"
              block
              onPress={() => router.push({ pathname: '/project/[id]/pick', params: { id } })}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
