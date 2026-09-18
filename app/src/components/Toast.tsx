import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';
import { Txt } from './Txt';

const DURATION = 2800;

type ToastState = {
  show: (message: string) => void;
  message: { text: string; id: number } | null;
  anim: Animated.Value;
  /** Open overlays (sheets live in their own Modal window, which covers the root host). */
  overlays: number;
  addOverlay: () => () => void;
};

const ToastContext = createContext<ToastState | null>(null);

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 40 },
    toast: {
      width: '100%',
      maxWidth: MAX_WIDTH - 32,
      backgroundColor: c.ink,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 16,
      boxShadow: c.shadow,
    },
  }),
);

function useReduceMotion() {
  const reduce = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduce.current = v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => (reduce.current = v));
    return () => sub.remove();
  }, []);
  return reduce;
}

/** Toasts from the prototype: top of the screen, inverted colours, 2.8 s, a new one replaces the old. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [overlays, setOverlays] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduce = useReduceMotion();

  const show = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      anim.stopAnimation();
      setMessage({ text, id: Date.now() });
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: reduce.current ? 0 : 200, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: reduce.current ? 0 : 200, useNativeDriver: true }).start(({ finished }) => {
          // A newer toast interrupts this fade-out; only clear when the fade really completed.
          if (finished) setMessage(null);
        });
      }, DURATION);
    },
    [anim, reduce],
  );

  const addOverlay = useCallback(() => {
    setOverlays((n) => n + 1);
    return () => setOverlays((n) => n - 1);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const value = useMemo(() => ({ show, message, anim, overlays, addOverlay }), [show, message, anim, overlays, addOverlay]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {overlays === 0 && <ToastHost />}
    </ToastContext.Provider>
  );
}

/** Renders the current toast. The root renders one; an open Sheet renders one inside its Modal. */
export function ToastHost() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const ctx = useContext(ToastContext);
  if (!ctx?.message) return null;
  const { message, anim } = ctx;
  return (
    <View pointerEvents="none" style={[s.wrap, { top: insets.top + 12 }]}>
      <Animated.View
        key={message.id}
        role="status"
        aria-live="polite"
        style={[s.toast, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}>
        <Txt v="text" weight={600} color="paper" center>
          {message.text}
        </Txt>
      </Animated.View>
    </View>
  );
}

export function useToast(): { show: (message: string) => void } {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return { show: value.show };
}

/** For overlays: while mounted, the toast shows inside the overlay instead of under it. */
export function useToastOverlay(active: boolean) {
  const value = useContext(ToastContext);
  const add = value?.addOverlay;
  useEffect(() => (active && add ? add() : undefined), [active, add]);
}
