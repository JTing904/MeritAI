import { useState } from 'react';
import { View, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { Txt, VARIANTS, type TxtProps } from './Txt';

type Line = { x: number; y: number; width: number; height: number };

export type HighlightProps = TxtProps & { hl?: Highlighter };

/**
 * The prototype's highlighter stroke: a slanted band half a letter tall behind the text,
 * near the bottom of each line. Native RN has no inline background gradients, so the text's
 * line boxes are measured and a band is drawn behind each one.
 *
 * Geometry matches the CSS `linear-gradient(100deg, transparent .4em, band .4em, band calc(100% - .3em),
 * transparent calc(100% - .3em))` on a 0.5em-tall band over a span padded 0.12em each side:
 * the band's corners sit at 0.406em / 0.318em from the left and 0.216em / 0.305em from the right.
 * Only whole text blocks can be highlighted; for "嗨，<hl>思远</hl>！" use <Rich>.
 */
export function Highlight({ hl = 'lemon', v = 'title', size, children, ...rest }: HighlightProps) {
  const { c } = useTheme();
  const [lines, setLines] = useState<Line[]>([]);
  const fs = size ?? VARIANTS[v].size;
  const band = fs * 0.5;
  const pad = fs * 0.12;

  const onTextLayout = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    setLines(e.nativeEvent.lines.map(({ x, y, width, height }) => ({ x, y, width, height })));
  };

  return (
    <View style={{ paddingHorizontal: pad, marginHorizontal: -0.05 * fs }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
        {lines.map((l, i) => {
          const w = l.width + pad * 2;
          const top = l.y + (l.height - band) * 0.88;
          const points = `${0.406 * fs},0 ${w - 0.216 * fs},0 ${w - 0.305 * fs},${band} ${0.318 * fs},${band}`;
          return (
            <Svg key={i} width={w} height={band} style={{ position: 'absolute', left: l.x, top }}>
              <Polygon points={points} fill={c.hl[hl].band} />
            </Svg>
          );
        })}
      </View>
      <Txt v={v} size={size} onTextLayout={onTextLayout} {...rest}>
        {children}
      </Txt>
    </View>
  );
}
