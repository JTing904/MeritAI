import { Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderWidth: 2,
      borderRadius: 15,
      backgroundColor: c.card,
    },
    grow: { flex: 1, minWidth: 0, gap: 2 },
  }),
);

/**
 * The picked date in a lifecycle sheet (mockup `.date-f`): the date in bold, a small line under it and
 * 「改」 on the right. The whole box opens the date picker.
 */
export function DateBox({
  text,
  small,
  change,
  label,
  invalid,
  disabled,
  onPress,
}: {
  text: string;
  small?: string | null;
  change: string;
  /** Accessible name (the field label). */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role="button"
      aria-label={`${label}: ${text}${small ? ` · ${small}` : ''}`}
      aria-disabled={disabled}
      style={({ pressed }) => [
        s.box,
        { borderColor: invalid ? c.bad : c.grape },
        pressed && { backgroundColor: c.pressed },
        disabled && { opacity: 0.55 },
      ]}>
      <View style={s.grow}>
        <Txt v="body" weight={700}>
          {text}
        </Txt>
        {small ? (
          <Txt v="meta" size={12}>
            {small}
          </Txt>
        ) : null}
      </View>
      <Txt v="small" size={13} weight={700} color="grapeText" aria-hidden>
        {change}
      </Txt>
    </Pressable>
  );
}
