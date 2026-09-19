import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { makeStyles } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.card2 },
    on: { backgroundColor: c.grapeSoft, borderWidth: 2, borderColor: c.grape, paddingVertical: 12, paddingHorizontal: 10 },
    grow: { flex: 1, minWidth: 0, gap: 2 },
    tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.line },
    radioOn: { borderWidth: 6, borderColor: c.grape },
  }),
);

type Props = {
  /** An avatar, or an icon (put it in <OptTile>). */
  leading: ReactNode;
  title: string;
  sub: string;
  /** Title in red (为所有人删除项目). */
  danger?: boolean;
  /** Set for a radio list: shows the radio, and the grape outline when true. */
  selected?: boolean;
  onPress: () => void;
};

/** The mockups' `.opt-row`: leading tile or avatar, bold title, muted explanation, optional radio. */
export function OptRow({ leading, title, sub, danger, selected, onPress }: Props) {
  const s = useStyles();
  const radio = selected !== undefined;
  return (
    <Pressable
      onPress={onPress}
      role={radio ? 'radio' : 'button'}
      aria-checked={radio ? selected : undefined}
      style={({ pressed }) => [s.row, selected && s.on, pressed && { opacity: 0.85 }]}>
      {leading}
      <View style={s.grow}>
        <Txt v="body" weight={700} size={15} color={danger ? 'bad' : 'ink'}>
          {title}
        </Txt>
        <Txt v="meta">{sub}</Txt>
      </View>
      {radio ? <View style={[s.radio, selected && s.radioOn]} aria-hidden /> : null}
    </Pressable>
  );
}

/** The 38px icon tile of an option row. */
export function OptTile({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.tile} aria-hidden>
      {children}
    </View>
  );
}
