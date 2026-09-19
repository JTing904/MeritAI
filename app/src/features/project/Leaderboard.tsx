import { StyleSheet, View } from 'react-native';
import { givenName } from '@shared/format';
import { formatPoints, formatTotal } from '@shared/planning';
import type { MemberView, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Card, List, SectionHeader } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { packageById } from './parts';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // `.podium`: 2nd / 1st / 3rd in columns of 1 : 1.15 : 1, standing on one line.
    podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
    pod: { alignItems: 'center', gap: 6 },
    block: {
      alignSelf: 'stretch',
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomLeftRadius: 6,
      borderBottomRightRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
    no: { width: 22 },
    grow: { flex: 1, minWidth: 0 },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.card2, overflow: 'hidden', marginTop: 6 },
    fill: { height: 8, borderRadius: 4 },
    right: { alignItems: 'flex-end', flexShrink: 0 },
    left: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, opacity: 0.6 },
    formula: { backgroundColor: c.card2, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  }),
);

type Ranked = { member: MemberView; rank: number };

/**
 * Who is on the board, in order (REQUIREMENTS §13 排行榜): active members, minus a leader who only
 * manages. Most points first; the same points share a rank and the next person skips ranks (1, 1, 3);
 * the same points go by name.
 */
export function rankMembers(project: ProjectView): Ranked[] {
  const onBoard = project.members.filter((m) => m.active && !(m.role === 'LEADER' && project.basics.leaderManages));
  // One collation for everyone, so every viewer sees ties in the same order.
  const sorted = [...onBoard].sort((a, b) => b.earnedPoints - a.earnedPoints || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return sorted.map((member) => ({ member, rank: 1 + sorted.filter((m) => m.earnedPoints > member.earnedPoints).length }));
}

/** The 排行 tab (proto §4.5): podium, ranked list, 已退出, and how points are counted. */
export function Leaderboard({ project }: { project: ProjectView }) {
  const s = useStyles();
  const { t } = useI18n();
  const r = t.project.rank;
  const ranked = rankMembers(project);
  // The podium is for points: nobody stands on it with 0.
  const podium = ranked.slice(0, 3).filter((x) => x.member.earnedPoints > 0);
  const leftAt = (m: MemberView) => (m.leftAt ? Date.parse(m.leftAt) : 0);
  const gone = project.members.filter((m) => !m.active).sort((a, b) => leftAt(b) - leftAt(a));

  return (
    <View style={{ gap: 12 }}>
      {podium.length > 0 ? (
        <Card>
          <View style={s.podium} role="list" aria-label={r.podium}>
            {/* 2nd on the left, 1st in the middle, 3rd on the right; an empty place keeps the others put. */}
            {[podium[1], podium[0], podium[2]].map((x, i) => (
              <View key={x?.member.id ?? `empty-${i}`} style={{ flex: i === 1 ? 1.15 : 1 }}>
                {x ? <PodiumPlace project={project} entry={x} /> : null}
              </View>
            ))}
          </View>
        </Card>
      ) : (
        <Card>
          <Txt v="meta" center>
            {r.empty}
          </Txt>
        </Card>
      )}

      {ranked.length > 0 ? (
        <List>
          {ranked.map((x) => (
            <RankRow key={x.member.id} project={project} entry={x} />
          ))}
        </List>
      ) : null}

      {gone.length > 0 ? (
        <>
          <SectionHeader title={r.leftTitle} />
          <List>
            {gone.map((m) => (
              <View key={m.id} style={s.left}>
                <Avatar name={m.name} hl={m.color} size="sm" decorative />
                <Txt v="text" style={s.grow}>
                  {r.left(m.name, formatPoints(m.earnedPoints))}
                </Txt>
              </View>
            ))}
          </List>
        </>
      ) : null}

      <View style={s.formula}>
        <Txt v="meta" color="ink2" style={{ lineHeight: 20 }}>
          {r.formula.map((part, i) =>
            typeof part === 'string' ? (
              part
            ) : (
              <Txt key={i} v="meta" color="ink" weight={700}>
                {part.b}
              </Txt>
            ),
          )}
        </Txt>
      </View>
    </View>
  );
}

function PodiumPlace({ project, entry }: { project: ProjectView; entry: Ranked }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const r = t.project.rank;
  const { member, rank } = entry;
  const you = member.id === project.viewerMemberId;
  const earned = formatPoints(member.earnedPoints);
  return (
    <View
      style={s.pod}
      accessible
      role="listitem"
      aria-label={r.place(rank, you ? `${member.name}${r.youSuffix}` : member.name, earned)}>
      <Txt v="body" size={22} style={{ lineHeight: 26 }} aria-hidden>
        {MEDALS[rank]}
      </Txt>
      {/* Everyone in first place gets the big avatar: a tie looks like one. */}
      <Avatar name={member.name} hl={member.color} size={rank === 1 ? 'lg' : 'md'} decorative />
      <Txt v="label" color="ink" center numberOfLines={1} aria-hidden>
        {you ? r.you : givenName(member.name)}
      </Txt>
      <View style={[s.block, { height: 40 + (member.earnedPoints / 10) * 2.4, backgroundColor: c.hl[member.color].chip }]} aria-hidden>
        <Txt v="num" tabular>
          {earned}
        </Txt>
        <Txt v="meta" size={11} weight={600} color="ink2">
          {r.unit}
        </Txt>
      </View>
    </View>
  );
}

function RankRow({ project, entry }: { project: ProjectView; entry: Ranked }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const r = t.project.rank;
  const { member, rank } = entry;
  const you = member.id === project.viewerMemberId;
  const name = you ? `${member.name}${r.youSuffix}` : member.name;
  const pkg = packageById(project, member.packageId);
  const earned = formatPoints(member.earnedPoints);
  const of = pkg ? r.packageTotal(formatTotal(pkg.points)) : r.noPackage;
  const progress = pkg && pkg.points > 0 ? Math.min(100, (member.earnedPoints / pkg.points) * 100) : 0;
  return (
    <View style={s.row} accessible aria-label={r.row(rank, name, earned, of)}>
      <Txt v="num" size={13} weight={700} color="muted" center tabular style={s.no}>
        {rank}
      </Txt>
      <Avatar name={member.name} hl={member.color} size="sm" decorative />
      <View style={s.grow}>
        <Txt v="text" weight={700}>
          {name}
        </Txt>
        {pkg ? (
          <View style={s.bar}>
            <View style={[s.fill, { width: `${progress}%`, backgroundColor: c.hl[member.color].base }]} />
          </View>
        ) : null}
      </View>
      <View style={s.right}>
        <Txt v="num" size={18} tabular>
          {r.earned(earned)}
        </Txt>
        <Txt v="meta" size={11} weight={500}>
          {of}
        </Txt>
      </View>
    </View>
  );
}
