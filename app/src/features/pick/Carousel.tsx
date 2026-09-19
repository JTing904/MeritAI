import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { makeStyles, useTheme } from '@/theme';
import { useReducedMotion } from './motion';

const GAP = 14;
const GUTTER = 18;
/** Cards take 84% of the content width, so the next one peeks in. */
const CARD_SHARE = 0.84;

const useStyles = makeStyles(() =>
  StyleSheet.create({
    // Bleeds past the screen gutter to both edges, like the prototype's `margin: 0 -18px`.
    root: { marginHorizontal: -GUTTER },
    content: { paddingHorizontal: GUTTER, paddingTop: 6, paddingBottom: 18, gap: GAP },
    dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: -8 },
  }),
);

// Web: the browser's own scroll snapping (the prototype's CSS). Native uses snapToOffsets.
const WEB_TRACK = Platform.OS === 'web' ? ({ scrollSnapType: 'x mandatory' } as object) : null;
const WEB_SLIDE = Platform.OS === 'web' ? ({ scrollSnapAlign: 'center' } as object) : null;

/**
 * Where the track stops for each card: centred in the viewport, clamped at both ends (so the first
 * card sits at the left gutter and the last at the right one, as CSS `scroll-snap-align: center` does).
 */
function snapOffsets(viewport: number, card: number, count: number): number[] {
  const max = Math.max(0, GUTTER * 2 + count * card + (count - 1) * GAP - viewport);
  return Array.from({ length: count }, (_, i) => {
    const centred = GUTTER + i * (card + GAP) + card / 2 - viewport / 2;
    return Math.round(Math.min(max, Math.max(0, centred)));
  });
}

function nearest(offsets: number[], x: number): number {
  let best = 0;
  offsets.forEach((o, i) => {
    if (Math.abs(o - x) < Math.abs(offsets[best]! - x)) best = i;
  });
  return best;
}

/**
 * The pick screen's horizontal card track: snaps each card to the centre, starts at `initialIndex`
 * (once), and shows position dots underneath. Tapping a dot scrolls to that card, which is also how
 * a mouse without a horizontal wheel gets around on the web.
 */
export function Carousel({
  children,
  initialIndex,
  dotLabel,
}: {
  children: ReactNode;
  initialIndex: number;
  /** Accessible name of the dot that scrolls to card i (e.g. 任务包 3). */
  dotLabel: (i: number) => string;
}) {
  const s = useStyles();
  const reduce = useReducedMotion();
  const slides = Children.toArray(children).filter(isValidElement);
  const count = slides.length;
  const [viewport, setViewport] = useState(0);
  const [active, setActive] = useState(initialIndex);
  const scroller = useRef<ScrollView>(null);
  const started = useRef(false);
  const card = viewport ? Math.round((viewport - GUTTER * 2) * CARD_SHARE) : 0;
  const offsets = useMemo(() => snapOffsets(viewport, card, count), [viewport, card, count]);
  const current = Math.min(active, Math.max(0, count - 1));

  const goTo = (i: number, animated: boolean) => {
    const x = offsets[i];
    if (x === undefined) return;
    scroller.current?.scrollTo({ x, y: 0, animated });
    setActive(i);
  };

  // The first position is set once the cards are laid out (on the web, earlier scrolls are undone by the snapping).
  const onContentSizeChange = () => {
    if (started.current || !card) return;
    started.current = true;
    const i = Math.min(Math.max(0, initialIndex), count - 1);
    requestAnimationFrame(() => goTo(i, false));
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = nearest(offsets, e.nativeEvent.contentOffset.x);
    if (i !== current) setActive(i);
  };

  return (
    <View style={s.root} onLayout={(e) => setViewport(e.nativeEvent.layout.width)}>
      {card > 0 && (
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.content}
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={WEB_TRACK}
          {...(Platform.OS === 'web'
            ? {}
            : { snapToOffsets: offsets, decelerationRate: 'fast' as const, disableIntervalMomentum: true })}>
          {slides.map((slide) => (
            <View key={slide.key} style={[{ width: card }, WEB_SLIDE]}>
              {slide}
            </View>
          ))}
        </ScrollView>
      )}
      {count > 1 && (
        // Slide pickers as a tab list (the WAI-ARIA carousel pattern).
        <View style={s.dots} role="tablist">
          {slides.map((slide, i) => (
            <Dot key={slide.key} on={i === current} reduce={reduce} label={dotLabel(i)} onPress={() => goTo(i, !reduce)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Covers the 6 px gaps between dots, so every point of the row reaches one. */
const DOT_SLOP = { top: 10, bottom: 10, left: 3, right: 3 };

/** 7 px dot; the current one stretches to 20 px in ink (0.2 s, instant under reduced motion). */
function Dot({ on, reduce, label, onPress }: { on: boolean; reduce: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme();
  const width = useRef(new Animated.Value(on ? 20 : 7)).current;
  useEffect(() => {
    Animated.timing(width, { toValue: on ? 20 : 7, duration: reduce ? 0 : 200, useNativeDriver: false }).start();
  }, [on, reduce, width]);
  return (
    <Pressable onPress={onPress} role="tab" aria-label={label} aria-selected={on} hitSlop={DOT_SLOP}>
      <Animated.View style={{ width, height: 7, borderRadius: on ? 4 : 3.5, backgroundColor: on ? c.ink : c.line }} />
    </Pressable>
  );
}
