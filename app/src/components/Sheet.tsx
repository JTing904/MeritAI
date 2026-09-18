import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
      <View style={s.root}>
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={label}
          style={[s.sheet, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
          <View style={s.grab} />
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: 28 + insets.bottom }]} bounces={false}>
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
