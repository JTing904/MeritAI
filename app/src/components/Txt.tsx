import { Children, isValidElement, type ReactNode } from 'react';
import { Platform, Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type Colors } from '@/theme';
import { fontStyle, type Face, type Weight } from '@/theme/fonts';

type Variant = {
  size: number;
  /** Line height as a multiple of size. */
  lh: number;
  face: Face;
  weight: Weight;
  /** Letter spacing in em. */
  ls?: number;
  color?: ColorKey;
};

// Type scale from the prototype (§1.8 of the spec).
export const VARIANTS = {
  title: { size: 27, lh: 1.25, face: 'display', weight: 900, ls: -0.01 },
  hero: { size: 21, lh: 1.25, face: 'display', weight: 900 },
  meName: { size: 20, lh: 1.25, face: 'display', weight: 900 },
  brand: { size: 18, lh: 1.2, face: 'display', weight: 800, ls: -0.02 },
  grade: { size: 34, lh: 1.1, face: 'display', weight: 900, ls: 0.02 },
  big: { size: 44, lh: 1.0, face: 'display', weight: 800, ls: -0.03 },
  num: { size: 22, lh: 1.1, face: 'display', weight: 800 },
  appbar: { size: 16, lh: 1.3, face: 'body', weight: 700 },
  appbarSub: { size: 11.5, lh: 1.3, face: 'body', weight: 500, color: 'muted' },
  cardName: { size: 16.5, lh: 1.3, face: 'body', weight: 900 },
  sheetTitle: { size: 16, lh: 1.35, face: 'body', weight: 700 },
  h3: { size: 15, lh: 1.4, face: 'body', weight: 700 },
  body: { size: 15, lh: 1.55, face: 'body', weight: 400 },
  button: { size: 15, lh: 1.55, face: 'body', weight: 700 },
  rowTitle: { size: 14.5, lh: 1.35, face: 'body', weight: 700 },
  text: { size: 14, lh: 1.5, face: 'body', weight: 400 },
  small: { size: 13.5, lh: 1.45, face: 'body', weight: 400 },
  label: { size: 13, lh: 1.35, face: 'body', weight: 700, color: 'ink2' },
  meta: { size: 12.5, lh: 1.4, face: 'body', weight: 400, color: 'muted' },
  chip: { size: 12, lh: 1.55, face: 'body', weight: 600 },
  tab: { size: 11, lh: 1.55, face: 'body', weight: 600 },
  mono: { size: 12, lh: 1.3, face: 'mono', weight: 500 },
  code: { size: 22, lh: 1.2, face: 'mono', weight: 500, ls: 0.12 },
} satisfies Record<string, Variant>;

export type VariantName = keyof typeof VARIANTS;
type ColorKey = { [K in keyof Colors]: Colors[K] extends string ? K : never }[keyof Colors];

export type TxtProps = TextProps & {
  v?: VariantName;
  /** A theme colour name, or any colour string. */
  color?: ColorKey | (string & {});
  weight?: Weight;
  size?: number;
  center?: boolean;
  tabular?: boolean;
};

function plainText(children: ReactNode): string {
  let out = '';
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += String(child);
    else if (isValidElement<{ children?: ReactNode }>(child)) out += plainText(child.props.children);
  });
  return out;
}

export function Txt({ v = 'body', color, weight, size, center, tabular, style, children, ...rest }: TxtProps) {
  const { c } = useTheme();
  const variant: Variant = VARIANTS[v];
  const fontSize = size ?? variant.size;
  const w = weight ?? variant.weight;
  const colorName = color ?? variant.color ?? 'ink';
  const resolved = (c as Record<string, unknown>)[colorName];

  const base: TextStyle = {
    ...fontStyle(variant.face, w, variant.face === 'display' ? plainText(children) : undefined),
    fontSize,
    lineHeight: Math.round(fontSize * variant.lh),
    color: typeof resolved === 'string' ? resolved : colorName,
    letterSpacing: variant.ls ? variant.ls * fontSize : undefined,
    textAlign: center ? 'center' : undefined,
    fontVariant: tabular ? ['tabular-nums'] : undefined,
  };
  if (Platform.OS === 'android') base.includeFontPadding = false;

  return (
    <Text style={[base, style]} {...rest}>
      {children}
    </Text>
  );
}
