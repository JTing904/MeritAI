import { Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { makeStyles } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.card,
      overflow: 'hidden',
    },
    btn: { width: 46, height: 44, alignItems: 'center', justifyContent: 'center' },
    pressed: { backgroundColor: c.card2 },
    value: { minWidth: 34, alignItems: 'center' },
  }),
);

/** The prototype's `.stepper`: − value +, bounded; the value is announced when it changes. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  lessLabel,
  moreLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  lessLabel: string;
  moreLabel: string;
}) {
  const s = useStyles();
  const button = (label: string, glyph: string, next: number, disabled: boolean) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      collapsable={false}
      style={({ pressed }) => [s.btn, pressed && !disabled && s.pressed, { opacity: disabled ? 0.35 : 1 }]}>
      <Txt v="body" size={20} weight={700}>
        {glyph}
      </Txt>
    </Pressable>
  );
  return (
    <View style={s.box}>
      {button(lessLabel, '−', value - 1, value <= min)}
      <View style={s.value} aria-live="polite">
        <Txt v="num" size={19} tabular>
          {value}
        </Txt>
      </View>
      {button(moreLabel, '+', value + 1, value >= max)}
    </View>
  );
}
