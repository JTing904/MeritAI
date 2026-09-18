import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles } from '@/theme';
import { radius } from '@/theme/tokens';
import { headingLevel } from './Screen';
import { Txt } from './Txt';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: radius.card,
      padding: 16,
      boxShadow: c.shadow,
    },
    list: { padding: 0, overflow: 'hidden' },
    divider: { height: 1, backgroundColor: c.line },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
    rowPressed: { backgroundColor: c.pressed },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
    sectionH: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 2, marginBottom: -6 },
  }),
);

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

/** A card with no padding whose children are separated by 1px lines. */
export function List({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[s.card, s.list, style]}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i > 0 && <View style={s.divider} />}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

type RowProps = {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Keeps the row pressable-looking but inert (e.g. while signing in). */
  disabled?: boolean;
  accessibilityLabel?: string;
};

/** List row: leading tile, title + meta, trailing content. Pressable when onPress is given. */
export function Row({ leading, title, meta, trailing, onPress, disabled, accessibilityLabel }: RowProps) {
  const s = useStyles();
  const body = (
    <>
      {leading}
      <View style={s.grow}>
        {typeof title === 'string' ? <Txt v="rowTitle">{title}</Txt> : title}
        {meta !== undefined && <View style={s.meta}>{typeof meta === 'string' ? <Txt v="meta">{meta}</Txt> : meta}</View>}
      </View>
      {trailing}
    </>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={!!disabled}
      style={({ pressed }) => [s.row, pressed && !disabled && s.rowPressed]}>
      {body}
    </Pressable>
  );
}

/** Section header: h3 on the left, optional action on the right. It hugs the block below it. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.sectionH}>
      <Txt v="h3" role="heading" {...headingLevel(3)}>
        {title}
      </Txt>
      {action}
    </View>
  );
}
