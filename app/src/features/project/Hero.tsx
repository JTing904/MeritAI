import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatPoints } from '@shared/planning';
import type { ProjectView } from '@shared/types';
import { Card } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { daysUntil } from '@/features/home/format';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { useLocalDates } from './parts';
import { appNow } from '@/lib/lifecycle';

const SIZE = 86;
const R = 36;
const STROKE = 10;
const CIRC = 2 * Math.PI * R;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    grow: { flex: 1, minWidth: 0, gap: 4 },
    ring: { width: SIZE, height: SIZE },
    ringText: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.card2,
      borderRadius: 11.5,
      paddingVertical: 2,
      paddingHorizontal: 9,
    },
  }),
);

/** Project hero (`.p-hero`): name, meta, the earned ring in the project colour, and chips. */
export function ProjectHero({ project }: { project: ProjectView }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const h = t.project.hero;
  const dates = useLocalDates();
  const b = project.basics;

  const meta = [b.courseName, b.groupLabel, h.due(dates.date(b.deadline))].filter(Boolean).join(' · ');
  const days = daysUntil(b.deadline);
  const left = days > 0 ? h.daysLeft(days) : days === 0 ? h.dueToday : h.pastDeadline;
  const now = appNow().getTime();
  const next = project.milestones.find((m) => new Date(m.dueAt).getTime() >= now) ?? null;
  const repo = b.repoFullName ? (b.repoFullName.split('/').pop() ?? b.repoFullName) : null;
  const earned = formatPoints(project.earnedPoints);
  const dash = (CIRC * Math.min(project.earnedPoints, 1000)) / 1000;

  return (
    <Card>
      <View style={s.top}>
        <View style={s.grow}>
          <Txt v="hero">{b.name}</Txt>
          {meta ? <Txt v="meta">{meta}</Txt> : null}
        </View>
        <View style={s.ring} accessible role="img" aria-label={h.ring(earned)}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={c.card2} strokeWidth={STROKE} />
            {/* A zero-length dash with a round cap would still draw a dot. */}
            {project.earnedPoints > 0 ? (
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={c.hl[b.color].base}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${CIRC}`}
              />
            ) : null}
          </Svg>
          <View style={s.ringText} aria-hidden>
            <Txt v="num" tabular>
              {earned}
            </Txt>
            <Txt v="tab" size={10.5} color="muted" style={{ marginTop: 3, lineHeight: 13 }}>
              {h.of}
            </Txt>
          </View>
        </View>
      </View>
      <View style={s.chips}>
        {/* The emoji sits in its own hidden Txt: a nested one would still be read. */}
        <View style={s.chip}>
          <Txt v="chip" color="ink2" aria-hidden>
            {h.leftEmoji}
          </Txt>
          <Txt v="chip" color="ink2">
            {left}
          </Txt>
        </View>
        {next ? (
          <View style={s.chip}>
            <Txt v="chip" color="ink2" aria-hidden>
              {h.milestoneEmoji}
            </Txt>
            <Txt v="chip" color="ink2">
              {h.milestone(next.label, next.name, dates.date(next.dueAt))}
            </Txt>
          </View>
        ) : null}
        {repo ? (
          <View style={s.chip}>
            <GitHubMark size={13} color={c.ink2} />
            <Txt v="chip" color="ink2">
              {repo}
            </Txt>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** The prototype's GitHub mark (I.github). */
function GitHubMark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path
        fill={color}
        d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </Svg>
  );
}
