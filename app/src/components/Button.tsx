import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { Txt } from './Txt';

type Kind = 'primary' | 'soft' | 'hl' | 'danger';

export type ButtonProps = {
  title: string;
  /** An async handler blocks further presses until it settles (a double tap never sends twice). */
  onPress?: () => void | Promise<unknown>;
  kind?: Kind;
  /** Highlighter colour for kind="hl". */
  hl?: Highlighter;
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** How far the face travels when pressed (prototype `.btn:active { transform: translateY(3px) }`). */
const TRAVEL = 3;

/**
 * The prototype's signature button: a coloured face on a darker "lip" (box-shadow 0 Npx 0).
 * Pressed, the face moves down 3px and the lip shrinks to 1px. Drawn with two Views so it
 * looks the same on every Android version and on the web.
 */
export function Button({
  title,
  onPress,
  kind = 'primary',
  hl = 'lemon',
  small,
  block,
  disabled,
  loading,
  icon,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const { c } = useTheme();
  const [pressed, setPressed] = useState(false);
  // Synchronous: `loading` only arrives with the next render, too late for a second tap in the same frame.
  const inFlight = useRef(false);
  const press = () => {
    if (inFlight.current || !onPress) return;
    const result = onPress();
    if (result && typeof result.then === 'function') {
      inFlight.current = true;
      const settle = () => {
        inFlight.current = false;
      };
      result.then(settle, settle);
    }
  };

  const palette = {
    primary: { face: c.grape, lip: c.grapePress, text: c.onGrape },
    soft: { face: c.card2, lip: c.line, text: c.ink },
    hl: { face: c.hl[hl].base, lip: c.hl[hl].lip, text: c.onHl },
    danger: { face: c.badSoft, lip: c.dangerLip, text: c.bad },
  }[kind];

  // Resting lip: 4px for primary and highlighter buttons, 3px for small, soft and danger ones.
  const lip = kind === 'hl' || (kind === 'primary' && !small) ? 4 : 3;
  const radius = small ? 12 : 15;
  const inactive = !!(disabled || loading);
  const down = pressed && !inactive;

  return (
    <Pressable
      onPress={press}
      disabled={inactive}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      role="button"
      aria-label={accessibilityLabel ?? title}
      aria-disabled={inactive}
      aria-busy={!!loading}
      style={[{ paddingBottom: lip, alignSelf: block ? 'stretch' : 'flex-start', opacity: disabled ? 0.45 : 1 }, style]}>
      {/* The lip; pressed, it reaches 1px below the moved face (it may extend past the resting bottom). */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { top: lip, bottom: down ? lip - TRAVEL - 1 : 0, backgroundColor: palette.lip, borderRadius: radius },
        ]}
      />
      <View
        style={[
          styles.face,
          {
            backgroundColor: palette.face,
            borderRadius: radius,
            paddingVertical: small ? 8 : 13,
            paddingHorizontal: small ? 13 : 18,
            transform: [{ translateY: down ? TRAVEL : 0 }],
          },
        ]}>
        {loading ? <ActivityIndicator size="small" color={palette.text} /> : icon}
        <Txt v="button" size={small ? 13 : 15} color={palette.text}>
          {title}
        </Txt>
      </View>
    </Pressable>
  );
}

/** Text-only action in grape (the prototype's `.link`). */
export function LinkButton({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} role="button" hitSlop={8} style={{ padding: 4 }}>
      <Txt v="label" color="grapeText" size={13}>
        {title}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
