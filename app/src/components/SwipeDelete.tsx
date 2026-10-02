// Swipe a row left to reveal a red 删除 button (Android / iPhone). The web has no swipe: there the row's own
// edit sheet keeps its delete button, so this just renders the row.
import { type ReactNode, useRef } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Txt } from '@/components/Txt';
import { useTheme } from '@/theme';

export function SwipeDelete({
  children,
  label,
  onDelete,
  disabled,
}: {
  children: ReactNode;
  /** The button's text, e.g. 删除. */
  label: string;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const ref = useRef<SwipeableMethods>(null);
  if (Platform.OS === 'web' || disabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          role="button"
          aria-label={label}
          onPress={() => {
            ref.current?.close();
            onDelete();
          }}
          style={({ pressed }) => [styles.action, { backgroundColor: c.bad, opacity: pressed ? 0.8 : 1 }]}>
          <Txt v="small" weight={800} color="onBad">
            {label}
          </Txt>
        </Pressable>
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: { width: 88, alignItems: 'center', justifyContent: 'center', borderRadius: 14, marginLeft: 8 },
});
