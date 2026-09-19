import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { formatPoints, formatTotal } from '@shared/planning';
import type { MemberView, PackageView, TaskView } from '@shared/types';
import { Txt } from '@/components/Txt';
import { useDates } from '@/features/wizard/dates';
import { deviceTimeZone } from '@/features/wizard/zoned';
import { useI18n } from '@/i18n';
import { displayStatus } from '@/lib/status';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';

/** Scallops under the band: half circles of radius 6, one every 14 px. */
const SCALLOP_R = 6;
const SCALLOP_STEP = 14;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { flex: 1, backgroundColor: c.card, borderRadius: radius.sheet, boxShadow: c.shadow, overflow: 'hidden' },
    band: { paddingTop: 16, paddingHorizontal: 18, paddingBottom: 14, gap: 4 },
    bandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 },
    big: { flexDirection: 'row', alignItems: 'baseline' },
    // The body's 20 px top padding in the prototype, minus the scallop row above it.
    body: { flex: 1, paddingTop: 20 - SCALLOP_R, paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
    task: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
    pressed: { opacity: 0.6 },
    tag: { borderRadius: 7, paddingVertical: 2, paddingHorizontal: 7, backgroundColor: c.card2 },
    foot: { paddingHorizontal: 16, paddingBottom: 18, gap: 8 },
  }),
);

/**
 * One package on the pick carousel (prototype `.pcard`): a band in the owner's colour (waiting grey
 * when free) with a scalloped edge, the tasks, and a foot the screen fills in.
 */
export function PackageCard({
  pkg,
  tasks,
  owner,
  deadline,
  onOpenTask,
  foot,
}: {
  pkg: PackageView;
  tasks: TaskView[];
  owner: MemberView | null;
  /** Project deadline: the date shown for tasks without their own. */
  deadline: string;
  onOpenTask: (taskId: string) => void;
  foot: ReactNode;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  // Everyone sees dates in their own time zone (REQUIREMENTS §13).
  const dates = useDates(deviceTimeZone());
  const band = owner ? c.hl[owner.color].base : c.waiting;
  // Dark ink on the dark-mode waiting grey is unreadable; the theme's ink works on both greys.
  const ink = owner ? 'onHl' : 'ink';
  const label = t.labels.packageN(pkg.index);
  const hours = pkg.estimateHours !== null ? Math.max(1, Math.round(pkg.estimateHours)) : null;

  return (
    <View style={s.card} {...(Platform.OS === 'web' ? ({ role: 'group', 'aria-label': label } as object) : {})}>
      <View style={[s.band, { backgroundColor: band }]}>
        <View style={s.bandRow}>
          <Txt v="body" size={14} weight={900} color={ink} style={{ lineHeight: 20 }}>
            {label}
          </Txt>
          {hours !== null && (
            <Txt v="meta" weight={700} color={ink} style={{ opacity: 0.85 }}>
              {t.pick.card.hours(hours)}
            </Txt>
          )}
        </View>
        <View style={s.bandRow}>
          {/* Siblings, not nested Text: the digits keep the display face even though 分 is Chinese. */}
          <View style={s.big}>
            <Txt v="big" color={ink} tabular>
              {formatTotal(pkg.points)}
            </Txt>
            <Txt v="big" size={17} color={ink} style={{ letterSpacing: 0, marginLeft: 2 }}>
              {t.pick.card.unit}
            </Txt>
          </View>
          <Txt v="meta" weight={700} color={ink} style={{ opacity: 0.85 }}>
            {t.pick.card.contribution}
          </Txt>
        </View>
      </View>
      <Scallop color={band} />

      <View style={s.body}>
        {tasks.map((task) => {
          const status = displayStatus(task);
          const due = dates.short(task.dueAt ?? deadline);
          const points = t.labels.points(formatPoints(task.points));
          return (
            <Pressable
              key={task.id}
              onPress={() => onOpenTask(task.id)}
              role="button"
              aria-label={`${t.labels.status[status]}, ${task.title}, ${points}, ${due}`}
              style={({ pressed }) => [s.task, pressed && s.pressed]}>
              <View style={s.tag}>
                <Txt v="chip" size={11} weight={700} color="ink2">
                  {t.labels.kind[task.kind]}
                </Txt>
              </View>
              <Txt v="small" style={{ flex: 1, minWidth: 0 }}>
                {`${t.labels.statusEmoji[status]} ${task.title}`}
              </Txt>
              <Txt v="meta" size={11.5} weight={500} tabular style={{ textAlign: 'right', lineHeight: 15 }}>
                {`${points}\n${due}`}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={s.foot}>{foot}</View>
    </View>
  );
}

/**
 * The band's bottom edge: half circles hanging below it (react-native-svg, sized to the card). It
 * overlaps the band by 1 px so no hairline seam shows between them.
 */
function Scallop({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const count = Math.ceil(width / SCALLOP_STEP);
  return (
    <View style={{ height: SCALLOP_R + 1, marginTop: -1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} aria-hidden>
      {width > 0 && (
        <Svg width={width} height={SCALLOP_R + 1}>
          <Rect x={0} y={0} width={width} height={1} fill={color} />
          {Array.from({ length: count }, (_, k) => (
            <Circle key={k} cx={SCALLOP_STEP / 2 + k * SCALLOP_STEP} cy={1} r={SCALLOP_R} fill={color} />
          ))}
        </Svg>
      )}
    </View>
  );
}
