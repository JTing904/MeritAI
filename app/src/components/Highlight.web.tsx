import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { Txt, type TxtProps } from './Txt';

export type HighlightProps = TxtProps & { hl?: Highlighter };

/** Web: the exact CSS from the prototype's `.hl` (a gradient band that clones onto every wrapped line). */
export function Highlight({ hl = 'lemon', v = 'title', children, ...rest }: HighlightProps) {
  const { c } = useTheme();
  const band = c.hl[hl].band;
  return (
    <Txt v={v} {...rest}>
      <span
        style={{
          backgroundImage: `linear-gradient(100deg, transparent 0.4em, ${band} 0.4em, ${band} calc(100% - 0.3em), transparent calc(100% - 0.3em))`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 0.5em',
          backgroundPosition: '0 88%',
          padding: '0 0.12em',
          margin: '0 -0.05em',
          WebkitBoxDecorationBreak: 'clone',
          boxDecorationBreak: 'clone',
        }}>
        {children}
      </span>
    </Txt>
  );
}
