import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { useReducedMotion } from './motion';

// Prototype §2.8: 110 paper pieces in the six highlighter colours, launched from the middle of the
// screen, falling with gravity for 2.2 s. The prototype steps its physics once per 60 fps frame;
// the same steps are precomputed here and replayed with one native-driven value.
const PIECES = 110;
const FRAMES = 132;
const DURATION = 2200;
/** Frames between interpolation points (the curves are smooth enough at this spacing). */
const STEP = 6;
const INPUT = Array.from({ length: FRAMES / STEP + 1 }, (_, i) => i * STEP);
const COLORS: Highlighter[] = ['lemon', 'gum', 'mint', 'sky', 'tang', 'lilac'];

const HIDDEN =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as object)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

type Shot = { t: Animated.Value; pieces: { key: number; style: Animated.WithAnimatedValue<ViewStyle> }[] };

function launch(w: number, h: number, colors: string[]): Shot {
  const t = new Animated.Value(0);
  const pieces = Array.from({ length: PIECES }, (_, i) => {
    let x = w / 2 + (Math.random() - 0.5) * 60;
    let y = h * 0.42;
    let vx = (Math.random() - 0.5) * 11;
    let vy = -Math.random() * 12 - 5;
    let r = Math.random() * Math.PI;
    const vr = (Math.random() - 0.5) * 0.3;
    const size = 6 + Math.random() * 6;
    const xs: number[] = [];
    const ys: number[] = [];
    const rs: string[] = [];
    for (let f = 0; f <= FRAMES; f++) {
      if (f > 0) {
        vy += 0.35;
        vx *= 0.99;
        x += vx;
        y += vy;
        r += vr;
      }
      if (f % STEP === 0) {
        // The view's top-left corner, so the piece is centred on (x, y) like the canvas fillRect.
        xs.push(x - size / 2);
        ys.push(y - size / 4);
        rs.push(`${(r * 180) / Math.PI}deg`);
      }
    }
    const style: Animated.WithAnimatedValue<ViewStyle> = {
      position: 'absolute',
      left: 0,
      top: 0,
      width: size,
      height: size / 2,
      backgroundColor: colors[i % colors.length],
      transform: [
        { translateX: t.interpolate({ inputRange: INPUT, outputRange: xs }) },
        { translateY: t.interpolate({ inputRange: INPUT, outputRange: ys }) },
        { rotate: t.interpolate({ inputRange: INPUT, outputRange: rs }) },
      ],
    };
    return { key: i, style };
  });
  return { t, pieces };
}

/**
 * Full-screen confetti over the screen it is placed in (last child of a flex: 1 root). Every change
 * of `burst` (after 0) fires once; skipped under reduced motion. Never takes touches.
 */
export const Confetti = memo(function Confetti({ burst }: { burst: number }) {
  const { c } = useTheme();
  const reduce = useReducedMotion();
  const size = useRef({ w: 0, h: 0 });
  // Read at fire time: a theme or setting change alone must not fire.
  const latest = useRef({ c, reduce });
  latest.current = { c, reduce };
  const [shot, setShot] = useState<Shot | null>(null);

  useEffect(() => {
    const { w, h } = size.current;
    if (burst === 0 || latest.current.reduce || !w || !h) return;
    setShot(launch(w, h, COLORS.map((name) => latest.current.c.hl[name].base)));
  }, [burst]);

  useEffect(() => {
    if (!shot) return;
    const anim = Animated.timing(shot.t, { toValue: FRAMES, duration: DURATION, easing: Easing.linear, useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished) setShot((cur) => (cur === shot ? null : cur));
    });
    return () => anim.stop();
  }, [shot]);

  return (
    <View
      style={styles.layer}
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
      {...HIDDEN}>
      {shot?.pieces.map((p) => <Animated.View key={p.key} style={p.style} />)}
    </View>
  );
});

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', zIndex: 35, pointerEvents: 'none' },
});
