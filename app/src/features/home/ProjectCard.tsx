import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { formatPoints } from '@shared/planning';
import type { ProjectCard as ProjectCardData } from '@shared/types';
import { AvatarStack } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { daysUntil, formatWhen, projectTag } from './format';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, padding: 16, gap: 12, boxShadow: c.shadow },
    pressed: { opacity: 0.88 },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    tag: { maxWidth: 150, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 10, transform: [{ rotate: '-3deg' }] },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.card2, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: { paddingBottom: 3 },
    iconLip: { position: 'absolute', left: 0, right: 0, top: 3, bottom: 0, borderRadius: 12, backgroundColor: c.line },
    iconFace: { borderRadius: 12, backgroundColor: c.card2, paddingVertical: 10, paddingHorizontal: 13 },
  }),
);

/** Card head: the rotated code tag, the project name and one meta line. Also used by the join preview. */
export function ProjectHead({
  tag,
  tagColor,
  tagInk,
  name,
  meta,
}: {
  tag: string;
  tagColor: string;
  /** Tag text colour (a theme colour name); highlighter tags use onHl. */
  tagInk?: string;
  name: string;
  meta: string;
}) {
  const s = useStyles();
  return (
    <View style={s.head}>
      <View style={[s.tag, { backgroundColor: tagColor }]}>
        <Txt v="num" size={13} color={tagInk ?? 'onHl'} numberOfLines={1} style={{ lineHeight: 18 }}>
          {tag}
        </Txt>
      </View>
      <View style={s.grow}>
        <Txt v="cardName">{name}</Txt>
        {meta ? <Txt v="meta">{meta}</Txt> : null}
      </View>
    </View>
  );
}

/** A card body on the prototype's `.card.proj`: pressable when onPress is given. */
export function ProjectCardFrame({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const s = useStyles();
  if (!onPress) return <View style={s.card}>{children}</View>;
  return (
    <Pressable onPress={onPress} role="button" style={({ pressed }) => [s.card, pressed && s.pressed]}>
      {children}
    </Pressable>
  );
}

/** "软件工程 · 第 7 组 · 4 / 5 人 · 你是组长" */
export function projectMeta(
  p: { courseName: string | null; groupLabel: string | null; memberCount: number; teamSize: number },
  who: string | null,
  card: Messages['home']['card'],
): string {
  const people = p.memberCount < p.teamSize ? card.peopleOf(p.memberCount, p.teamSize) : card.people(p.memberCount);
  return [p.courseName, p.groupLabel, people, who].filter(Boolean).join(' · ');
}

/** A project I'm an active member of (not a draft). */
export function ProjectCard({ project: p, onOpen }: { project: ProjectCardData; onOpen: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const card = t.home.card;
  const people = p.members.map((m) => ({ name: m.name, hl: m.color }));
  const who = p.role === 'LEADER' ? card.youLead : card.ledBy(p.leaderName);

  let foot: ReactNode;
  let bar = false;
  if (p.status === 'ENDED') foot = <Chip>{card.ended}</Chip>;
  else if (p.status === 'AWAITING_CONFIRM')
    foot = <Chip tone="warn">{p.role === 'LEADER' ? card.awaitingYou : card.awaitingLeader}</Chip>;
  // Joined after every package was taken: waiting for the leader to re-split.
  else if (p.needsPackage && p.freePackages === 0) foot = <Chip tone="warn">{card.noPackage}</Chip>;
  else if (p.freePackages > 0) {
    // While packages are still being picked the card nudges people to pick one.
    foot =
      p.myPackageIndex !== null ? (
        <Chip hl={p.color}>{card.myPackage(p.myPackageIndex)}</Chip>
      ) : (
        <Chip tone="warn">{card.freePackages(p.freePackages)}</Chip>
      );
  } else {
    bar = true;
    const days = daysUntil(p.deadline);
    const left = days > 0 ? card.daysLeft(days) : days === 0 ? card.dueToday : card.pastDeadline;
    foot = (
      <Txt v="meta">
        <Txt v="num" size={13} weight={700} tabular>
          {card.earned(formatPoints(p.earnedPoints))}
        </Txt>
        {` · ${left}`}
      </Txt>
    );
  }

  // Per the prototype, past-deadline cards aren't opened; their own actions (confirm, report) come in a later milestone.
  const openable = p.status === 'ACTIVE';

  return (
    <ProjectCardFrame onPress={openable ? onOpen : undefined}>
      <ProjectHead
        tag={projectTag(p.name, p.shortCode)}
        tagColor={c.hl[p.color].base}
        name={p.name}
        meta={projectMeta(p, who, card)}
      />
      {bar && (
        <View style={s.bar}>
          <View style={[s.fill, { width: `${Math.min(100, p.earnedPoints / 10)}%`, backgroundColor: c.hl[p.color].base }]} />
        </View>
      )}
      <View style={s.foot}>
        <AvatarStack people={people} />
        {foot}
      </View>
    </ProjectCardFrame>
  );
}

/** A draft only its creator sees: resume the wizard where it was left, or delete it. */
export function DraftCard({
  project: p,
  onResume,
  onDelete,
}: {
  project: ProjectCardData;
  onResume: () => void;
  onDelete: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const d = t.home.draft;
  const course = [p.shortCode, p.courseName].filter(Boolean).join(' ');
  const meta = [course, p.groupLabel, d.notSplit, d.onlyYou].filter(Boolean).join(' · ');
  return (
    <ProjectCardFrame>
      <ProjectHead tag={d.tag} tagColor={c.waiting} tagInk="ink" name={p.name} meta={meta} />
      <View style={s.foot}>
        <Txt v="meta" style={{ flexShrink: 1 }}>
          {d.lastEdited(formatWhen(p.updatedAt, t.home.when), p.draftStep)}
        </Txt>
        <View style={s.actions}>
          <TrashButton label={d.delete} onPress={onDelete} />
          <Button title={d.resume} small onPress={onResume} />
        </View>
      </View>
    </ProjectCardFrame>
  );
}

/** Icon-only small soft button (the shared Button always reserves room for a title). */
function TrashButton({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [down, setDown] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setDown(true)}
      onPressOut={() => setDown(false)}
      role="button"
      aria-label={label}
      hitSlop={4}
      style={s.iconBtn}>
      <View style={[s.iconLip, down && { bottom: -1 }]} />
      <View style={[s.iconFace, { transform: [{ translateY: down ? 3 : 0 }] }]}>
        <Svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke={c.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round">
          <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </Svg>
      </View>
    </Pressable>
  );
}
