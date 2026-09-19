import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { Txt } from './Txt';

export type ChipTone = 'default' | 'good' | 'warn' | 'bad' | 'grape';

/** Small pill label. `hl` tints it with a member or project colour. */
export function Chip({ children, tone = 'default', hl }: { children: ReactNode; tone?: ChipTone; hl?: Highlighter }) {
  const { c } = useTheme();
  const { bg, fg } = hl
    ? { bg: c.hl[hl].chip, fg: c.ink }
    : {
        default: { bg: c.card2, fg: c.ink2 },
        good: { bg: c.goodSoft, fg: c.good },
        warn: { bg: c.warnSoft, fg: c.warn },
        bad: { bg: c.badSoft, fg: c.bad },
        grape: { bg: c.grapeSoft, fg: c.grapeText },
      }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 11.5, paddingVertical: 2, paddingHorizontal: 9 }}>
      {/* A pill in a row of pills: past 1.4× it pushes rows apart and clips inside cards. */}
      <Txt v="chip" color={fg} maxFontSizeMultiplier={1.4}>
        {children}
      </Txt>
    </View>
  );
}
