import { StyleSheet, View } from 'react-native';
import type { ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DevNote } from '@/components/DevNote';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { InlineText, useLocalDates } from '@/features/project/parts';
import { useI18n } from '@/i18n';
import { dayDiff } from '@/lib/time';
import { appNow } from '@/lib/lifecycle';
import { makeStyles, useTheme } from '@/theme';
import { mix } from '@/theme/color';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { gap: 10 },
    // Mockup `.life.due`: an inset 2px ring, warn mixed 35% into the card.
    due: { borderWidth: 2, borderColor: mix(c.warn, c.card, 0.35) },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    frozen: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 2 },
  }),
);

/**
 * The lifecycle card under the project hero (DueLeader / DueMember / Ended mockups). AWAITING_CONFIRM:
 * the leader gets 结束项目 and 延后截止日期, members a waiting line. ENDED: when it ended, when it is
 * deleted, 下载贡献报告 (M11) and, for the leader, 重新打开. Nothing for other statuses.
 */
export function LifecycleCard({
  project,
  onEnd,
  onExtend,
  onReopen,
}: {
  project: ProjectView;
  onEnd: () => void;
  onExtend: () => void;
  onReopen: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const l = t.life;
  const dates = useLocalDates();
  const life = project.lifecycle;
  const leader = project.viewerRole === 'LEADER';

  const head = (emoji: string, title: string, tint: string) => (
    <View style={s.head}>
      <View style={[s.tile, { backgroundColor: tint }]} aria-hidden>
        <Txt v="body" size={19} style={{ lineHeight: 24 }}>
          {emoji}
        </Txt>
      </View>
      <Txt v="body" weight={800} size={16} style={{ flex: 1 }} role="heading">
        {title}
      </Txt>
    </View>
  );

  if (life.status === 'AWAITING_CONFIRM') {
    const autoEnd = life.autoEndAt ? dates.date(life.autoEndAt) : '';
    const leaderName = project.members.find((m) => m.role === 'LEADER' && m.active)?.name ?? null;
    return (
      <Card style={[s.card, s.due]}>
        {head('📮', leader ? l.due.leaderTitle : l.due.memberTitle, c.warnSoft)}
        {leader ? (
          <>
            <Txt v="text" color="ink2">
              {l.due.leaderBody}
            </Txt>
            <View style={s.row}>
              <Button title={l.due.end} small onPress={onEnd} />
              <Button title={l.due.extend} kind="soft" small onPress={onExtend} />
            </View>
            <InlineText parts={l.due.leaderAuto(autoEnd)} v="meta" />
          </>
        ) : (
          <>
            <InlineText parts={l.due.memberBody(leaderName, autoEnd)} v="text" color="ink2" />
            <Txt v="meta">{l.due.memberHint}</Txt>
          </>
        )}
      </Card>
    );
  }

  if (life.status === 'ENDED') {
    const ended = life.endedAt ? dates.date(life.endedAt) : '';
    const purge = life.purgeAfter;
    const days = purge ? Math.max(0, dayDiff(new Date(purge), appNow())) : 0;
    return (
      <>
        <Card style={s.card}>
          {head('🏁', life.endedAuto ? l.ended.titleAuto(ended) : l.ended.title(ended), c.grapeSoft)}
          {life.endedAuto ? (
            <Txt v="text" color="ink2">
              {l.ended.autoLine}
            </Txt>
          ) : null}
          {purge ? <InlineText parts={l.ended.body(dates.date(purge), days)} v="text" color="ink2" /> : null}
          <View style={s.row}>
            <Button title={l.ended.report} small disabled />
            {leader ? <Button title={l.ended.reopen} kind="soft" small onPress={onReopen} /> : null}
          </View>
        </Card>
        <DevNote milestone="M11" />
      </>
    );
  }

  return null;
}

/** 「🔒 已结束，只能看」 (Ended mockup): above the packages and on the task page of an ENDED project. */
export function FrozenLine() {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={s.frozen}>
      <Icon name="lock" size={13} color={c.muted} />
      <Txt v="meta" size={12} weight={600}>
        {t.life.frozen}
      </Txt>
    </View>
  );
}
