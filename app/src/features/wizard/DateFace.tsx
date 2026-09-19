import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { makeStyles, useTheme } from '@/theme';
import type { Presets } from './calendar';
import { endOfDay, toWall, type Wall } from './zoned';

/** Props of DateTimeField. Values are ISO instants. */
export type DateTimeFieldProps = {
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Project time zone: the picker shows and returns wall-clock times there. */
  tz: string;
  /** 'date' picks a day and means 23:59 that day. */
  mode: 'date' | 'datetime';
  /** Earliest selectable day (default: now). */
  min?: Date;
  /** Latest selectable instant (e.g. the project deadline); later picks are clamped to it. */
  max?: string | null;
  /** Accessible name. */
  label: string;
  placeholder: string;
  /** How to show a value. */
  format: (iso: string) => string;
  variant?: 'input' | 'chip';
  /** Shows a ✕ that clears the value, and 不设日期 in the picker. */
  clearLabel?: string;
  invalid?: boolean;
  /** The picker's quick picks (明天 / 这周五 / … or 下周五 / 两周后 / …). Default: 'task' when `max` is given. */
  presets?: Presets;
  /** Shows 改时区 in the picker (the caller opens its time-zone sheet). */
  onChangeZone?: () => void;
};

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    input: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 2,
      borderRadius: 14,
      backgroundColor: c.card,
    },
    inputMain: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      minHeight: 34,
      borderWidth: 2,
      borderRadius: 12,
      backgroundColor: c.card,
    },
    chipMain: { paddingVertical: 4, paddingHorizontal: 10, minHeight: 30, justifyContent: 'center' },
    clear: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  }),
);

/** The visible part of a date field: an input-looking box or a small chip, plus an optional clear ✕. */
export function DateFace({
  variant = 'input',
  text,
  empty,
  invalid,
  focused,
  label,
  onPress,
  clear,
}: {
  variant?: 'input' | 'chip';
  text: string;
  empty: boolean;
  invalid?: boolean;
  /** Outlined in grape while its picker is open. */
  focused?: boolean;
  label: string;
  /** Opens the picker. */
  onPress: () => void;
  clear?: { label: string; onPress: () => void } | null;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const chip = variant === 'chip';
  const borderColor = invalid ? c.bad : focused ? c.grape : c.line;
  const body = chip ? (
    <Txt v="small" size={13} weight={600} color={empty ? 'muted' : 'ink'}>
      📅 {text}
    </Txt>
  ) : (
    <Txt v="body" color={empty ? 'muted' : 'ink'} numberOfLines={1}>
      {text}
    </Txt>
  );
  const mainStyle = chip ? s.chipMain : s.inputMain;
  return (
    <View style={[chip ? s.chip : s.input, { borderColor, borderStyle: chip && empty ? 'dashed' : 'solid' }]}>
      <Pressable
        onPress={onPress}
        role="button"
        aria-label={`${label}: ${text}`}
        // The chip is 34px tall: reach 44px without changing its look.
        hitSlop={chip ? { top: 7, bottom: 7 } : undefined}
        style={mainStyle}>
        {body}
      </Pressable>
      {clear && !empty ? (
        <Pressable onPress={clear.onPress} role="button" aria-label={clear.label} hitSlop={7} style={s.clear}>
          <Icon name="close" size={14} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function resolveBounds(tz: string, min?: Date, max?: string | null) {
  const minWall = toWall(min ?? Date.now(), tz);
  const maxWall = max ? toWall(max, tz) : null;
  return { minWall, maxWall };
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);

/** Clamp a picked wall time to the latest allowed one; date-only picks become 23:59. */
export function finishPick(picked: Wall, mode: 'date' | 'datetime', maxWall: Wall | null): Wall {
  const w = mode === 'date' ? endOfDay(picked) : picked;
  return maxWall && wallMs(w) > wallMs(maxWall) ? maxWall : w;
}
