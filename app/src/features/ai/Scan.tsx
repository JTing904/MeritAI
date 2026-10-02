import { useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Txt } from '@/components/Txt';
import { useReducedMotion } from '@/features/pick/motion';
import { makeStyles, useTheme } from '@/theme';
import { mix } from '@/theme/color';
import type { Highlighter } from '@/theme/tokens';

// The AI's waiting animations (M6 mockups NewAiReading and TaskAiReviewing), on the UI thread with
// Reanimated. With the system's reduce-motion setting on, they hold still: the lines are all marked and
// the sweeping band is left out.

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    doc: { backgroundColor: c.card, borderRadius: 22, boxShadow: c.shadow, paddingVertical: 20, paddingHorizontal: 18, gap: 11 },
    docLine: { height: 11, borderRadius: 6, backgroundColor: c.card2, overflow: 'hidden' },
    mark: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    card: {
      backgroundColor: c.card,
      borderRadius: 20,
      boxShadow: c.shadow,
      paddingVertical: 18,
      paddingHorizontal: 16,
      gap: 10,
      overflow: 'hidden',
    },
    line: { height: 9, borderRadius: 5, backgroundColor: c.card2 },
    sweeper: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  }),
);

const LINES: { width: number; hl: Highlighter }[] = [
  { width: 92, hl: 'lemon' },
  { width: 78, hl: 'gum' },
  { width: 86, hl: 'mint' },
  { width: 64, hl: 'sky' },
  { width: 95, hl: 'tang' },
  { width: 70, hl: 'lilac' },
  { width: 88, hl: 'gum' },
  { width: 55, hl: 'lemon' },
];

/** The prototype's timing: one line every 250 ms, each marked in 600 ms; then a pause and a fade, and again. */
const STAGGER = 250;
const MARK = 600;
const HOLD = 900;
const FADE = 300;
const MARKED_BY = (LINES.length - 1) * STAGGER + MARK + HOLD;

function DocLine({ index, width, color, reduce }: { index: number; width: number; color: string; reduce: boolean }) {
  const s = useStyles();
  // 0 → 1: the highlighter runs across; 1 → 2: it fades out before the next round.
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(p);
      p.value = 1;
      return;
    }
    const start = index * STAGGER;
    p.value = 0;
    p.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 0 }),
        withDelay(start, withTiming(1, { duration: MARK, easing: Easing.out(Easing.ease) })),
        withDelay(MARKED_BY - start - MARK, withTiming(2, { duration: FADE })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(p);
  }, [index, reduce, p]);
  const style = useAnimatedStyle(() => ({
    width: `${Math.min(p.value, 1) * 100}%`,
    opacity: p.value <= 1 ? 1 : 2 - p.value,
  }));
  return (
    <View style={[s.docLine, { width: `${width}%` }]}>
      <Animated.View style={[s.mark, { backgroundColor: color }, style]} />
    </View>
  );
}

/** Wizard step 3 while the AI reads the brief (NewAiReading): eight lines highlighted one after another, looping. */
export function AiDocScan() {
  const s = useStyles();
  const { c } = useTheme();
  const reduce = useReducedMotion();
  return (
    <View style={s.doc} aria-hidden>
      {LINES.map((line, i) => (
        <DocLine key={i} index={i} width={line.width} reduce={reduce} color={mix(c.hl[line.hl].base, c.card2, c.hlStrength)} />
      ))}
    </View>
  );
}

/** A soft highlighter band crossing the card (`.scan .sweeper`: 40% wide, 1.1 s, linear, forever). */
function Sweeper({ width }: { width: number }) {
  const s = useStyles();
  const { c } = useTheme();
  const gradient = `sweep${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const band = width * 0.4;
  const x = useSharedValue(-band);
  useEffect(() => {
    x.value = -band;
    x.value = withRepeat(withTiming(width, { duration: 1100, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(x);
  }, [width, band, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[s.sweeper, { width: band }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={c.hl.lemon.base} stopOpacity={0} />
            <Stop offset="0.5" stopColor={c.hl.lemon.base} stopOpacity={0.55} />
            <Stop offset="1" stopColor={c.hl.lemon.base} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradient})`} />
      </Svg>
    </Animated.View>
  );
}

/** 「AI 正在审核」 card (TaskAiReviewing): the title, three grey lines, a hint, and the sweeping band. */
export function AiScanCard({ title, hint }: { title: string; hint: ReactNode }) {
  const s = useStyles();
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  return (
    <View style={s.card} aria-live="polite" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Txt v="text" weight={700}>
        {title}
      </Txt>
      {[88, 94, 70].map((w) => (
        <View key={w} style={[s.line, { width: `${w}%` }]} aria-hidden />
      ))}
      <Txt v="meta">{hint}</Txt>
      {!reduce && width > 0 ? <Sweeper width={width} /> : null}
    </View>
  );
}
