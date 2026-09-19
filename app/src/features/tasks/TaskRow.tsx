import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatPoints } from '@shared/planning';
import type { MyTaskRow } from '@shared/types';
import { Row } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import type { Messages } from '@/i18n/zh';
import { taskChip } from '@/lib/status';
import { dueLabel } from '@/lib/time';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import type { OpenRow } from './group';

const useStyles = makeStyles(() =>
  StyleSheet.create({
    // Prototype `.kind`: 40px tile, the project colour 30% into the card.
    tile: { width: 40, height: 40, borderRadius: radius.kind, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flexShrink: 1, flexGrow: 1 },
    pdot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
    due: { alignItems: 'flex-end', flexShrink: 0, maxWidth: 110 },
  }),
);

const openTask = (row: MyTaskRow) =>
  router.push({ pathname: '/project/[id]/task/[taskId]', params: { id: row.projectId, taskId: row.id } });

/** 今天 23:59 → [今天, 23:59] (the mockup's two-line date); a date without a time stays one line. */
function dueLines(label: string): string[] {
  const m = /^(.*\S) (\d{2}:\d{2})$/.exec(label);
  return m?.[1] && m[2] ? [m[1], m[2]] : [label];
}

function Tile({ row, emoji }: { row: MyTaskRow; emoji: string }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.tile, { backgroundColor: c.hl[row.projectColor].tile }]} aria-hidden>
      <Txt v="body" size={19} style={{ lineHeight: 24 }}>
        {emoji}
      </Txt>
    </View>
  );
}

/** `●{tag} · …` with the project dot hanging on the first line. */
function Meta({ row, children }: { row: MyTaskRow; children: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={s.meta}>
      <View style={[s.pdot, { backgroundColor: c.hl[row.projectColor].base }]} aria-hidden />
      <Txt v="meta" style={{ flexShrink: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

function Due({ lines, urgent }: { lines: string[]; urgent: boolean }) {
  const s = useStyles();
  return (
    <View style={s.due}>
      {lines.map((line, i) => (
        <Txt key={i} v="meta" size={12} weight={700} color={urgent ? 'bad' : 'muted'} tabular style={{ textAlign: 'right' }}>
          {line}
        </Txt>
      ))}
    </View>
  );
}

type Extra = { text: string; color: 'bad' | 'grapeText' | 'warn' };

function openExtra(item: OpenRow, copy: Messages['tasks']): Extra | null {
  if (item.overdue) {
    return { text: item.daysLate > 0 ? copy.extra.overdueDays(item.daysLate) : copy.extra.overdueToday, color: 'bad' };
  }
  switch (item.row.status) {
    case 'REVIEWING':
      return { text: copy.extra.reviewing, color: 'grapeText' };
    case 'HALF':
      return { text: copy.extra.half, color: 'warn' };
    case 'FAIL':
      return { text: copy.extra.fail, color: 'bad' };
    default:
      return null;
  }
}

/** A 待完成 row (TasksTab board): status emoji tile, title, project · points · kind (+ extra), due on the right. */
export function OpenTaskRow({ item, now }: { item: OpenRow; now: Date }) {
  const { t } = useI18n();
  const { row } = item;
  const chip = taskChip({ status: row.status, grade: row.grade, overdue: item.overdue }, t);
  const extra = openExtra(item, t.tasks);
  const base = [row.projectTag, t.labels.contribution(formatPoints(row.points)), t.labels.kind[row.kind]].join(' · ');
  const date = t.labels.due.date(item.due.getMonth() + 1, item.due.getDate());
  const lines = item.pastHandedIn ? [t.tasks.pastDue.date(date), t.tasks.pastDue.handedIn] : dueLines(dueLabel(row.dueAt, t.labels.due, now));
  const urgent = item.group === 'overdue' || item.group === 'today' || item.group === 'tomorrow';
  const label = [row.title, chip.label, base, extra?.text, lines.join(' ')].filter(Boolean).join(', ');
  return (
    <Row
      leading={<Tile row={row} emoji={chip.emoji} />}
      title={row.title}
      meta={
        <Meta row={row}>
          {base}
          {extra && (
            <>
              {' · '}
              <Txt v="meta" weight={700} color={extra.color}>
                {extra.text}
              </Txt>
            </>
          )}
        </Meta>
      }
      trailing={<Due lines={lines} urgent={urgent} />}
      onPress={() => openTask(row)}
      accessibilityLabel={label}
    />
  );
}

/** The 已完成 line: who decided the grade (overridden > outside > self-graded > meeting > graded). */
function doneLine(row: MyTaskRow, t: Messages): string {
  const grade = row.grade ? t.labels.grade[row.grade] : t.labels.status.DONE;
  if (row.overridden) return t.tasks.doneLine.overridden(grade);
  if (row.outsideApp) return t.tasks.doneLine.outside(grade);
  if (row.selfGraded) return t.tasks.doneLine.selfGraded;
  if (row.grade === 'SELF') return t.tasks.doneLine.meeting;
  return t.tasks.doneLine.graded(grade);
}

/** A 已完成 row: ✅ tile, title, `{tag} · {line} · +{earned} 分`. */
export function DoneTaskRow({ row }: { row: MyTaskRow }) {
  const { t } = useI18n();
  const emoji = row.grade ? t.labels.gradeEmoji[row.grade] : t.labels.statusEmoji.DONE;
  const meta = [row.projectTag, doneLine(row, t), t.tasks.earned(formatPoints(row.earnedPoints))].join(' · ');
  return (
    <Row
      leading={<Tile row={row} emoji={emoji} />}
      title={row.title}
      meta={<Meta row={row}>{meta}</Meta>}
      onPress={() => openTask(row)}
      accessibilityLabel={`${row.title}, ${meta}`}
    />
  );
}
