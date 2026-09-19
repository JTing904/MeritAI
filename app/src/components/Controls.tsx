import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { makeStyles, useTheme } from '@/theme';
import { Txt } from './Txt';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    seg: { flexDirection: 'row', backgroundColor: c.card2, borderRadius: 14, padding: 4, gap: 4 },
    // Transparent background from the start: Android drops borderRadius when a background is added after mount.
    // A 1px border on every segment (only its colour changes) so the selected one meets 3:1 contrast.
    segBtn: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 7,
      paddingHorizontal: 5,
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    segOn: { backgroundColor: c.card, borderColor: c.muted, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
    // 1.5px border so the off state is visible against the card (WCAG non-text contrast).
    toggle: { width: 44, height: 26, borderRadius: 13, padding: 1.5, borderWidth: 1.5, justifyContent: 'center' },
    knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  }),
);

/** Web: Space should activate switches and radios (it scrolls the page by default). */
function spaceActivates(action: () => void) {
  if (Platform.OS !== 'web') return {};
  return {
    onKeyDown: (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
      if (e.nativeEvent.key === ' ') {
        e.preventDefault?.();
        action();
      }
    },
  };
}

/** `sub`: a second, smaller line (e.g. 第 1 次 over 拿一半). */
export type SegOption<T extends string> = { value: T; label: string; sub?: string };

/** Segmented control (prototype `.seg`). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Not usable: announced as disabled, out of the tab order, ignores presses. */
  disabled?: boolean;
}) {
  const s = useStyles();
  return (
    <View style={s.seg} role="radiogroup" aria-label={label} aria-disabled={disabled}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            role="radio"
            aria-checked={on}
            disabled={disabled}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : undefined}
            {...(disabled ? {} : spaceActivates(() => onChange(o.value)))}
            collapsable={false}
            style={[s.segBtn, on && s.segOn]}>
            <Txt v="small" weight={700} color={on ? 'ink' : 'muted'}>
              {o.label}
            </Txt>
            {o.sub ? (
              <Txt v="meta" size={11} color={on ? 'ink2' : 'muted'}>
                {o.sub}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** On/off switch (prototype `.toggle`): green when on. */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      role="switch"
      aria-label={label}
      aria-checked={value}
      {...spaceActivates(() => onChange(!value))}
      hitSlop={9}
      style={[
        s.toggle,
        { backgroundColor: value ? c.good : c.line, borderColor: value ? c.good : c.muted, alignItems: value ? 'flex-end' : 'flex-start' },
      ]}>
      <View style={s.knob} />
    </Pressable>
  );
}
