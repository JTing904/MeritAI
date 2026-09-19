import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { makeStyles } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';
import { ToastHost, useToastOverlay } from './Toast';
import { Txt } from './Txt';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      maxHeight: '88%',
      width: '100%',
      maxWidth: MAX_WIDTH,
      alignSelf: 'center',
      zIndex: 1,
    },
    grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
    content: { paddingHorizontal: 18, paddingTop: 10, gap: 10 },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card2, borderRadius: 16, padding: 12 },
    optPressed: { opacity: 0.85 },
  }),
);

/**
 * The keyboard height React Native reports while a sheet is open (Android; 0 elsewhere).
 * Sheets are edge-to-edge Modals, so the keyboard doesn't resize their window: the sheet makes room itself.
 * The reported height leaves out the navigation bar, but the keyboard covers that strip too.
 */
function useSheetKeyboard(active: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    setHeight(Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0);
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
      setHeight(0);
    };
  }, [active]);
  return height;
}

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

/** Bottom sheet from the prototype: scrim, 26px top corners, grab handle, rises in. Closes on scrim tap or Back. */
export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const s = useStyles();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const keyboard = useSheetKeyboard(visible);
  useToastOverlay(visible);

  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) =>
      Animated.timing(rise, { toValue: 1, duration: reduce ? 0 : 220, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(),
    );
  }, [visible, rise]);

  const label = title ?? t.common.options;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* Lifting the whole sheet above the keyboard shrinks its scroll area, and Android then scrolls
          the focused input back into view by itself. The navigation bar strip is under the keyboard
          then, so the lift takes it over from the content's bottom padding. */}
      <View style={[s.root, keyboard > 0 && { paddingBottom: keyboard + insets.bottom }]}>
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={label}
          style={[s.sheet, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <View style={s.grab} />
          <ScrollView
            contentContainerStyle={[s.content, { paddingBottom: 28 + (keyboard > 0 ? 0 : insets.bottom) }]}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            // iOS: the keyboard overlaps the sheet; inset the scroll area instead of lifting it.
            automaticallyAdjustKeyboardInsets>
            {title && (
              <Txt v="sheetTitle" role="heading" style={{ marginBottom: 4 }}>
                {title}
              </Txt>
            )}
            {children}
          </ScrollView>
        </Animated.View>
        {/* After the sheet in the tree so keyboard focus lands in the sheet first; drawn behind it. */}
        <Pressable
          style={s.scrim}
          onPress={onClose}
          role="button"
          aria-label={t.common.close}
          {...(Platform.OS === 'web' ? { tabIndex: -1 as const } : {})}
        />
        <ToastHost />
      </View>
    </Modal>
  );
}

/** A tappable option row inside a sheet: emoji, title, subtitle. */
export function SheetOption({ emoji, title, sub, onPress }: { emoji: string; title: string; sub?: string; onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable onPress={onPress} role="button" style={({ pressed }) => [s.opt, pressed && s.optPressed]}>
      <Txt v="body" size={23} style={{ lineHeight: 30 }} aria-hidden>
        {emoji}
      </Txt>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="body" weight={700}>
          {title}
        </Txt>
        {sub && <Txt v="meta">{sub}</Txt>}
      </View>
    </Pressable>
  );
}
