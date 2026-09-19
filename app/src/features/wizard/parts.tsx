import { useEffect, useRef } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { formatTotal } from '@shared/planning';
import { Chip } from '@/components/Chip';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { mix } from '@/theme/color';
import type { Highlighter } from '@/theme/tokens';

/**
 * 1px dashed divider (`.man-task + .man-task`, `.pl-row + .pl-row`). Android only dashes a border
 * drawn on all four sides, so a dashed box is clipped to its top edge.
 */
export function DashedLine() {
  const { c } = useTheme();
  return (
    <View style={{ height: 1, overflow: 'hidden' }}>
      <View style={{ height: 3, borderWidth: 1, borderColor: c.line, borderStyle: 'dashed' }} />
    </View>
  );
}

/** Footer chip: 合计 100 分 ✓ (good) or 合计 85 分，确认时会按比例换算成 100 分 (warn). */
export function TotalChip({ total }: { total: number }) {
  const { t } = useI18n();
  const exact = total === 1000;
  return (
    <View style={{ alignSelf: 'center' }} aria-live="polite">
      <Chip tone={exact ? 'good' : 'warn'}>
        {exact ? t.wizard.total.exact(formatTotal(total)) : t.wizard.total.rescale(formatTotal(total))}
      </Chip>
    </View>
  );
}

/** Text-only action in grape (`.link`), sized for inside cards. */
export function TextLink({ title, onPress, size = 13 }: { title: string; onPress: () => void; size?: number }) {
  return (
    <Pressable onPress={onPress} role="button" hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
      <Txt v="label" color="grapeText" size={size}>
        {title}
      </Txt>
    </Pressable>
  );
}

const useScanStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 22, boxShadow: c.shadow, paddingVertical: 20, paddingHorizontal: 18, gap: 11 },
    ln: { height: 11, borderRadius: 6, backgroundColor: c.card2, overflow: 'hidden' },
    checks: { gap: 10 },
    check: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    mark: { width: 16, alignItems: 'center' },
  }),
);

const SCAN: { width: `${number}%`; hl: Highlighter }[] = [
  { width: '92%', hl: 'lemon' },
  { width: '78%', hl: 'gum' },
  { width: '86%', hl: 'mint' },
  { width: '64%', hl: 'sky' },
  { width: '95%', hl: 'tang' },
  { width: '70%', hl: 'lilac' },
  { width: '88%', hl: 'gum' },
  { width: '55%', hl: 'lemon' },
];

/** Prototype new3 `.doc-scan`: eight grey lines highlighted one after another (skipped under reduced motion). */
export function DocScan() {
  const s = useScanStyles();
  const { c } = useTheme();
  const marks = useRef(SCAN.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return marks.forEach((m) => m.setValue(1));
      anim = Animated.stagger(
        250,
        marks.map((m) => Animated.timing(m, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: false })),
      );
      anim.start();
    });
    return () => {
      cancelled = true;
      anim?.stop();
    };
  }, [marks]);

  return (
    <View style={s.card} aria-hidden>
      {SCAN.map((line, i) => (
        <View key={i} style={[s.ln, { width: line.width }]}>
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: marks[i]!.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: mix(c.hl[line.hl].base, c.card2, c.hlStrength),
            }}
          />
        </View>
      ))}
    </View>
  );
}

export type CheckState = 'done' | 'current' | 'waiting';

/** Prototype `.checks`: ✓ done, spinner for the current step, muted for waiting ones. */
export function Checks({ items, label }: { items: { text: string; state: CheckState }[]; label?: string }) {
  const s = useScanStyles();
  const { c } = useTheme();
  return (
    <View style={s.checks} aria-live="polite" aria-label={label}>
      {items.map((item, i) => (
        <View key={i} style={s.check}>
          <View style={s.mark}>
            {item.state === 'done' ? (
              <Txt v="text" weight={900} color="good">
                ✓
              </Txt>
            ) : item.state === 'current' ? (
              <ActivityIndicator size="small" color={c.grape} style={{ transform: [{ scale: 0.8 }] }} />
            ) : null}
          </View>
          <Txt v="text" color={item.state === 'waiting' ? 'muted' : 'ink'} style={{ flex: 1 }}>
            {item.text}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** Kind tile (`.pl-row .k`): 32px card-2 square with the kind emoji. */
export function KindTile({ emoji, size = 32 }: { emoji: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' }}
      aria-hidden>
      <Txt v="body" size={16} style={{ lineHeight: 21 }}>
        {emoji}
      </Txt>
    </View>
  );
}
