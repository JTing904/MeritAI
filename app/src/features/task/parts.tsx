import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // `.ws-h`: the card's bold title with an action on the right.
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    // `.status-line`
    line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
    // `.check`
    check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    boxOn: { backgroundColor: c.grape, borderColor: c.grape },
    link: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
    bullet: { flexDirection: 'row', gap: 8 },
    dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, flexShrink: 0 },
  }),
);

/** A card's title (`.ws-h`: 14.5 / 900) with an optional tag after it (M6 「✨ AI 写的」) and a link on the right. */
export function CardHead({ title, action, tag }: { title: string; action?: ReactNode; tag?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.cardHead}>
      <View style={{ flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Txt v="text" size={14.5} weight={900} style={{ flexShrink: 1 }}>
          {title}
        </Txt>
        {tag}
      </View>
      {action}
    </View>
  );
}

/** `.status-line`: 13px ink-2 pieces that wrap (text, chips, links). */
export function StatusLine({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.line, style]}>{children}</View>;
}

export function LineText({ children, color = 'ink2' }: { children: ReactNode; color?: 'ink2' | 'muted' | 'ink' }) {
  return (
    <Txt v="small" size={13} color={color}>
      {children}
    </Txt>
  );
}

/** Grape text link (`.link`), optionally with a small leading icon (↶ 撤销). */
export function TextLink({
  title,
  onPress,
  icon,
  label,
  disabled,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  label?: string;
  disabled?: boolean;
}) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={label ?? title}
      aria-disabled={!!disabled}
      hitSlop={8}
      style={({ pressed }) => [s.link, (pressed || disabled) && { opacity: 0.55 }]}>
      {icon ? <Icon name={icon} size={14} color={c.grapeText} /> : null}
      <Txt v="label" size={13} color="grapeText">
        {title}
      </Txt>
    </Pressable>
  );
}

/**
 * `.check`: a box and its text. Pressable (aria-pressed) when `onPress` is given; otherwise a read-only row
 * that still says whether it's ticked. `muted`: an unticked attendee.
 */
export function CheckRow({
  on,
  onPress,
  children,
  label,
  muted,
  disabled,
}: {
  on: boolean;
  onPress?: () => void;
  children: ReactNode;
  /** Accessible name when the children aren't plain text. */
  label?: string;
  muted?: boolean;
  disabled?: boolean;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const content = (
    <>
      <View style={[s.box, on && s.boxOn]} aria-hidden>
        {on ? <Icon name="check" size={14} color={c.onGrape} /> : null}
      </View>
      {typeof children === 'string' ? (
        <Txt v="small" color={muted ? 'muted' : 'ink'} style={{ flex: 1 }}>
          {children}
        </Txt>
      ) : (
        children
      )}
    </>
  );
  if (!onPress) {
    return (
      <View style={s.check} role="checkbox" aria-checked={on} aria-disabled aria-label={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-pressed={on}
      aria-label={label}
      aria-disabled={!!disabled}
      style={({ pressed }) => [s.check, pressed && { opacity: 0.7 }]}>
      {content}
    </Pressable>
  );
}

/** Lines shown as a bulleted list with the app's own dot (the markers were stripped on the server). */
export function Bullets({ lines, color = 'ink2' }: { lines: string[]; color?: 'ink' | 'ink2' }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={{ gap: 3 }} role="list">
      {lines.map((line, i) => (
        <View key={i} style={s.bullet} role="listitem">
          <View style={[s.dot, { backgroundColor: c[color] }]} aria-hidden />
          <Txt v="small" color={color} style={{ flex: 1 }}>
            {line}
          </Txt>
        </View>
      ))}
    </View>
  );
}
