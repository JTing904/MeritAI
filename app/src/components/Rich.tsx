import { View } from 'react-native';
import type { Highlighter } from '@/theme/tokens';
import { Highlight } from './Highlight';
import { headingLevel } from './Screen';
import { Txt, type VariantName } from './Txt';

/** A piece of a title: plain text, or text with a highlighter band. `\n` inside plain text forces a line break. */
export type RichPart = string | { hl: Highlighter; text: string };

/**
 * A title made of plain and highlighted parts, e.g. ['嗨，', { hl: 'lemon', text: '思远' }, '！'].
 * Parts sit in a wrapping row so each highlighted part can be measured on its own.
 */
export function Rich({ parts, v = 'title', size, label }: { parts: RichPart[]; v?: VariantName; size?: number; label?: string }) {
  const rows: RichPart[][] = [[]];
  for (const part of parts) {
    if (typeof part === 'string' && part.includes('\n')) {
      part.split('\n').forEach((piece, i) => {
        if (i > 0) rows.push([]);
        if (piece) rows[rows.length - 1]!.push(piece);
      });
    } else rows[rows.length - 1]!.push(part);
  }
  // Read aloud as one line: a break between Latin text is a space ("pts.\nPick"), in Chinese nothing.
  const text = parts
    .map((p) => (typeof p === 'string' ? p : p.text))
    .join('')
    .replace(/([!-~])\n(?=[!-~])/g, '$1 ')
    .replace(/\n/g, '');

  return (
    <View accessible role="heading" {...headingLevel(1)} aria-label={label ?? text}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {row.map((part, i) =>
            typeof part === 'string' ? (
              <Txt key={i} v={v} size={size}>
                {part}
              </Txt>
            ) : (
              <Highlight key={i} v={v} size={size} hl={part.hl}>
                {part.text}
              </Highlight>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
