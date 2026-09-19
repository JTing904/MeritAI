import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { compareDay, compareMonth, dayOf, monthOf, monthWeeks, quickPicks, shiftMonth, type Day, type Month, type Presets } from './calendar';
import { finishPick, resolveBounds } from './DateFace';
import { useDates, zoneName } from './dates';
import { Field } from './Field';
import { endOfDay, toIso, toWall, type Wall } from './zoned';

/** 常用时间 under 改时间. */
const COMMON_TIMES = [
  { h: 9, mi: 0 },
  { h: 12, mi: 0 },
  { h: 18, mi: 0 },
  { h: 23, mi: 59 },
];

// 「改时区」 is one line of small text: widen its touch area to about 44px.
const ZONE_HIT = { top: 12, bottom: 12, left: 8, right: 8 };

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Day | null, b: Day | null) => !!a && !!b && compareDay(a, b) === 0;

type HM = { h: number; mi: number };
const minutesOf = (x: HM) => x.h * 60 + x.mi;
const sameTime = (a: HM, b: HM) => minutesOf(a) === minutesOf(b);

/** Minutes step by 5 and wrap within the hour: 23:59 → + → 23:00, − → 23:55. */
const minuteUp = (mi: number) => (Math.floor(mi / 5) * 5 + 5) % 60;
const minuteDown = (mi: number) => (Math.ceil(mi / 5) * 5 + 55) % 60;

/** A toggle's state: aria-pressed on the web; native has no pressed state, so screen readers hear "selected". */
const pressedState = (on: boolean): object => (Platform.OS === 'web' ? { 'aria-pressed': on } : { 'aria-selected': on });

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    // The prototype outlines a picked chip with an inset shadow; a 2px border that is transparent until
    // then keeps every chip the same size.
    chip: {
      borderRadius: 14,
      borderWidth: 2,
      borderColor: 'transparent',
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: c.card2,
      justifyContent: 'center',
    },
    chipOn: { backgroundColor: c.grapeSoft, borderColor: c.grape },
    pressed: { opacity: 0.85 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    nav: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' },
    grid: { gap: 4 },
    week: { flexDirection: 'row', gap: 4 },
    cell: { flex: 1, minWidth: 0 },
    weekday: { paddingTop: 2, paddingBottom: 4 },
    day: {
      height: 42,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayPressed: { backgroundColor: c.card2 },
    today: { borderColor: c.line },
    deadline: { borderColor: c.bad },
    // The highlighter mark: a slightly tilted band with uneven corners.
    picked: {
      backgroundColor: c.hl.lemon.band,
      transform: [{ rotate: '-3deg' }],
      borderTopLeftRadius: 10,
      borderTopRightRadius: 14,
      borderBottomRightRadius: 9,
      borderBottomLeftRadius: 13,
    },
    off: { opacity: 0.38 },
    todayNum: { transform: [{ translateY: -4 }] },
    todayTag: { position: 'absolute', bottom: 1 },
    flag: { position: 'absolute', top: -5, right: -1 },
    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: c.card2,
    },
    grow: { flex: 1, minWidth: 0 },
    noteRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    link: { paddingVertical: 4 },
    times: { flexDirection: 'row', gap: 8 },
    timeChip: { flex: 1, minHeight: 40, alignItems: 'center' },
    hm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 6 },
    steppers: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.card,
      overflow: 'hidden',
    },
    stepBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
    stepPressed: { backgroundColor: c.card2 },
    stepValue: { minWidth: 44, alignItems: 'center' },
    actions: { flexDirection: 'row', gap: 10 },
  }),
);

export type DatePickerSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The field's value (an ISO instant): the day and time the picker starts from. */
  value: string | null;
  /** 确定 hands back the picked instant; 不设日期 hands back null. The sheet closes itself after either. */
  onPick: (iso: string | null) => void;
  /** Project time zone: days and times are wall-clock ones there. */
  tz: string;
  /** 'date' has no time: the day means 23:59. */
  mode: 'date' | 'datetime';
  /** Earliest selectable day (default: today). */
  min?: Date;
  /** Latest selectable instant (the project deadline); later picks are clamped to it. */
  max?: string | null;
  /** Which quick picks: a task's due date or the project deadline. */
  presets: Presets;
  /** Shows 不设日期. */
  clearable?: boolean;
  /** Shows 改时区 next to the zone name. */
  onChangeZone?: () => void;
};

/**
 * The in-app date picker (DueDate / DueTime / ProjectDeadline mockups): quick picks, a month with the
 * picked day highlighted, then 改时间 for a time other than 23:59. Nothing changes until 确定.
 * It is a Sheet (an RN Modal), so it opens on top of a sheet it is rendered inside.
 */
export function DatePickerSheet(props: DatePickerSheetProps) {
  const { t } = useI18n();
  return (
    <Sheet
      visible={props.visible}
      onClose={props.onClose}
      title={props.presets === 'task' ? t.picker.titleTask : t.picker.titleProject}>
      {/* Mounted per opening, so each one starts from the field's value and closing drops the draft. */}
      {props.visible ? <Picker {...props} /> : null}
    </Sheet>
  );
}

function Picker({ value, onPick, onClose, tz, mode, min, max, presets, clearable, onChangeZone }: DatePickerSheetProps) {
  const s = useStyles();
  const { c, dark } = useTheme();
  const { t } = useI18n();
  const p = t.picker;
  const dates = useDates(tz);

  const { minWall, maxWall } = resolveBounds(tz, min, max);
  const today = dayOf(toWall(Date.now(), tz));
  const minDay = dayOf(minWall);
  const maxDay = maxWall ? dayOf(maxWall) : null;
  const inRange = (d: Day) => compareDay(d, minDay) >= 0 && (!maxDay || compareDay(d, maxDay) <= 0);

  const [day, setDay] = useState<Day | null>(() => {
    const start = value ? dayOf(toWall(value, tz)) : null;
    // A value that can't be picked again (e.g. a deadline already past) starts with nothing picked.
    return start && inRange(start) ? start : null;
  });
  const [time, setTime] = useState<HM>(() => {
    const start = value ? toWall(value, tz) : null;
    return start ? { h: start.h, mi: start.mi } : { h: 23, mi: 59 };
  });
  const [timeOpen, setTimeOpen] = useState(false);
  const [view, setView] = useState<Month>(() => monthOf(day ?? minDay));

  const withTime = mode === 'datetime';
  // The range can move while the sheet is open (改时区 changes what "today" is): a day that has fallen
  // out of it counts as not picked, so 确定 can't save a date already past.
  const cur = day && inRange(day) ? day : null;
  // On the deadline day, times after the deadline's are clamped to it: show and step from the clamped time.
  const cap: HM | null = withTime && maxWall && sameDay(cur, maxDay) ? { h: maxWall.h, mi: maxWall.mi } : null;
  const capTime = (x: HM): HM => (cap && minutesOf(x) > minutesOf(cap) ? cap : x);
  const shownTime = capTime(time);
  const picked: Wall | null = cur ? finishPick({ ...cur, ...time }, mode, maxWall) : null;
  const city = zoneName(tz, t.wizard.zones);
  const canPrev = compareMonth(view, monthOf(minDay)) > 0;
  const canNext = !maxDay || compareMonth(view, monthOf(maxDay)) < 0;
  const quick = quickPicks(presets, today, minDay, maxDay);
  const dateText = (d: Day) => dates.date(endOfDay(d));

  const choose = (d: Day) => {
    setDay(d);
    setView(monthOf(d));
  };
  const confirm = () => {
    if (!picked) return;
    onPick(toIso(picked, tz));
    onClose();
  };
  const clear = () => {
    onPick(null);
    onClose();
  };

  const note = (() => {
    if (sameDay(cur, maxDay)) return <Txt v="meta">{p.deadlineDay}</Txt>;
    if (onChangeZone) {
      return (
        <View style={s.noteRow}>
          <Txt v="meta">{`${p.zoneTime(city)} · `}</Txt>
          <Pressable onPress={onChangeZone} role="button" hitSlop={ZONE_HIT}>
            <Txt v="meta" weight={700} color="grapeText">
              {p.changeZone}
            </Txt>
          </Pressable>
        </View>
      );
    }
    const endOfDayTime = !withTime || (shownTime.h === 23 && shownTime.mi === 59);
    return <Txt v="meta">{endOfDayTime ? p.endOfDay(city) : p.zoneTime(city)}</Txt>;
  })();

  return (
    <>
      {quick.length > 0 ? (
        <View role="group" aria-label={p.quickLabel} style={s.chips}>
          {quick.map((q) => {
            const on = sameDay(q.day, cur);
            return (
              <Pressable
                key={q.key}
                onPress={() => choose(q.day)}
                role="button"
                {...pressedState(on)}
                style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}>
                <Txt v="rowTitle" size={14} color={on ? 'grapeText' : 'ink'}>
                  {p.quick[q.key]}
                </Txt>
                <Txt v="meta" size={11.5} weight={500} color={on ? 'grapeText' : 'muted'}>
                  {dateText(q.day)}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={s.head}>
        <NavButton icon="back" label={p.prevMonth} disabled={!canPrev} onPress={() => setView(shiftMonth(view, -1))} />
        <Txt v="h3" size={16} aria-live="polite">
          {p.month(view.y, view.mo)}
        </Txt>
        <NavButton icon="chevron" label={p.nextMonth} disabled={!canNext} onPress={() => setView(shiftMonth(view, 1))} />
      </View>

      <View role="group" aria-label={p.month(view.y, view.mo)} style={s.grid}>
        <View style={s.week} aria-hidden>
          {p.weekdays.map((w, i) => (
            <View key={i} style={[s.cell, s.weekday]}>
              <Txt v="meta" size={12} weight={700} center>
                {w}
              </Txt>
            </View>
          ))}
        </View>
        {monthWeeks(view).map((week, wi) => (
          <View key={wi} style={s.week}>
            {week.map((d, i) => {
              if (!d) return <View key={i} style={s.cell} />;
              const off = !inRange(d);
              const isToday = sameDay(d, today);
              const isMax = sameDay(d, maxDay);
              const on = sameDay(d, cur);
              return (
                <Pressable
                  key={i}
                  onPress={() => choose(d)}
                  disabled={off}
                  role="button"
                  aria-label={p.day(dateText(d), isMax, isToday)}
                  aria-disabled={off}
                  {...pressedState(on)}
                  // Android flattens a view without a background; one added later then loses its corners.
                  collapsable={false}
                  style={({ pressed }) => [
                    s.cell,
                    s.day,
                    isToday && s.today,
                    isMax && s.deadline,
                    on && s.picked,
                    off && s.off,
                    pressed && !on && s.dayPressed,
                  ]}>
                  <Txt
                    v="text"
                    size={15}
                    weight={on ? 800 : 600}
                    tabular
                    color={on ? (dark ? c.ink : c.onHl) : off ? 'muted' : 'ink'}
                    style={isToday ? s.todayNum : undefined}>
                    {d.d}
                  </Txt>
                  {isToday ? (
                    <Txt v="meta" size={9} weight={700} style={s.todayTag}>
                      {p.today}
                    </Txt>
                  ) : null}
                  {isMax ? (
                    <Txt v="meta" size={11} style={s.flag}>
                      🏁
                    </Txt>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {timeOpen ? (
        <Field label={p.time} small={`· ${p.zoneTime(city)}`}>
          <View role="group" aria-label={p.commonTimes} style={s.times}>
            {COMMON_TIMES.map((ct) => {
              const on = sameTime(ct, shownTime);
              // On the deadline day a time after the deadline's can't be picked.
              const late = !!cap && minutesOf(ct) > minutesOf(cap);
              return (
                <Pressable
                  key={`${ct.h}:${ct.mi}`}
                  onPress={() => setTime(ct)}
                  disabled={late}
                  role="button"
                  aria-disabled={late}
                  {...pressedState(on)}
                  style={({ pressed }) => [s.chip, s.timeChip, on && s.chipOn, late && s.off, pressed && s.pressed]}>
                  <Txt v="mono" size={15} color={on ? 'grapeText' : late ? 'muted' : 'ink'}>
                    {`${pad(ct.h)}:${pad(ct.mi)}`}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
          <View style={s.hm}>
            <Txt v="meta">{p.otherTime}</Txt>
            <View style={s.steppers}>
              <WrapStepper
                value={shownTime.h}
                less={capTime({ ...shownTime, h: (shownTime.h + 23) % 24 })}
                more={capTime({ ...shownTime, h: (shownTime.h + 1) % 24 })}
                current={shownTime}
                onStep={setTime}
                lessLabel={p.hourLess}
                moreLabel={p.hourMore}
              />
              <Txt v="body" weight={700} aria-hidden>
                :
              </Txt>
              <WrapStepper
                value={shownTime.mi}
                less={capTime({ ...shownTime, mi: minuteDown(shownTime.mi) })}
                more={capTime({ ...shownTime, mi: minuteUp(shownTime.mi) })}
                current={shownTime}
                onStep={setTime}
                lessLabel={p.minuteLess}
                moreLabel={p.minuteMore}
              />
            </View>
          </View>
        </Field>
      ) : (
        <View style={s.summary}>
          <View style={s.grow}>
            <Txt v="body" weight={700} aria-live="polite">
              {picked ? p.due(dates.long(picked)) : p.noDay}
            </Txt>
            {note}
          </View>
          {withTime ? (
            <Pressable onPress={() => setTimeOpen(true)} role="button" hitSlop={8} style={s.link}>
              <Txt v="label" size={14} color="grapeText">
                {p.changeTime}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={s.actions}>
        {clearable ? <Button kind="soft" title={p.clear} onPress={clear} block style={{ flex: 1 }} /> : null}
        <Button
          title={timeOpen && picked ? p.confirmAt(dates.dateTime(picked)) : p.confirm}
          onPress={confirm}
          disabled={!picked}
          block
          style={{ flex: clearable ? 1.6 : 1 }}
        />
      </View>
      {clearable && maxWall && !timeOpen ? <Txt v="meta">{p.noDateHint(dates.date(maxWall))}</Txt> : null}
    </>
  );
}

function NavButton({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      style={({ pressed }) => [s.nav, pressed && s.pressed, disabled && { opacity: 0.35 }]}>
      <Icon name={icon} size={18} color={c.ink} />
    </Pressable>
  );
}

/**
 * − 18 + : an hour or minute stepper that wraps around instead of stopping. `less` / `more` are the
 * times a step leads to (already clamped to the deadline); a step that would change nothing is disabled.
 */
function WrapStepper({
  value,
  less,
  more,
  current,
  onStep,
  lessLabel,
  moreLabel,
}: {
  value: number;
  less: HM;
  more: HM;
  current: HM;
  onStep: (to: HM) => void;
  lessLabel: string;
  moreLabel: string;
}) {
  const s = useStyles();
  const button = (label: string, glyph: string, to: HM) => {
    const stuck = sameTime(to, current);
    return (
      <Pressable
        onPress={() => onStep(to)}
        disabled={stuck}
        role="button"
        aria-label={label}
        aria-disabled={stuck}
        collapsable={false}
        style={({ pressed }) => [s.stepBtn, pressed && s.stepPressed, stuck && s.off]}>
        <Txt v="body" size={20} weight={700}>
          {glyph}
        </Txt>
      </Pressable>
    );
  };
  return (
    <View style={s.stepper}>
      {button(lessLabel, '−', less)}
      <View style={s.stepValue} aria-live="polite">
        <Txt v="mono" size={18}>
          {pad(value)}
        </Txt>
      </View>
      {button(moreLabel, '+', more)}
    </View>
  );
}
