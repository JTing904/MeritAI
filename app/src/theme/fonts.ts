import { Platform, type TextStyle } from 'react-native';

// Three faces, as in the prototype:
// - display: Bricolage Grotesque for Latin/digits (CJK falls back to Noto Sans SC)
// - body: Noto Sans SC (bundled into the Android app)
// - mono: DM Mono
export type Face = 'display' | 'body' | 'mono';
export type Weight = 400 | 500 | 600 | 700 | 800 | 900;

const CJK = /[⺀-鿿豈-﫿︰-﹏＀-￯]/;

/** Native font files are embedded by the expo-font config plugin; the family is the file name. */
function nativeNoto(weight: Weight): string {
  if (weight >= 800) return 'NotoSansSC_900Black';
  if (weight >= 600) return 'NotoSansSC_700Bold';
  if (weight === 500) return 'NotoSansSC_500Medium';
  return 'NotoSansSC_400Regular';
}

function nativeBricolage(weight: Weight): string {
  return weight >= 800 ? 'BricolageGrotesque_800ExtraBold' : 'BricolageGrotesque_700Bold';
}

const WEB_STACK: Record<Face, string> = {
  display: '"Bricolage Grotesque", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  body: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"DM Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
};

/**
 * Font style for a face and weight. On Android a custom font can't fall back glyph by glyph,
 * so display text that contains Chinese uses Noto Sans SC (as the browser does in the prototype).
 */
export function fontStyle(face: Face, weight: Weight, text?: string): TextStyle {
  if (Platform.OS === 'web') {
    // Noto 600 is not loaded in the prototype either; browsers render it as 700.
    const w = face === 'mono' ? 500 : weight === 600 ? 700 : weight;
    return { fontFamily: WEB_STACK[face], fontWeight: String(w) as TextStyle['fontWeight'] };
  }
  if (face === 'mono') return { fontFamily: 'DMMono_500Medium' };
  if (face === 'display' && !(text && CJK.test(text))) return { fontFamily: nativeBricolage(weight) };
  return { fontFamily: nativeNoto(weight) };
}

const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800' +
  '&family=DM+Mono:wght@500&family=Noto+Sans+SC:wght@400;500;700;900&display=swap';

/** Web only: load the prototype's fonts from Google Fonts (sliced by unicode range, so pages stay light). */
export function loadWebFonts() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.querySelector('link[data-meritai-fonts]')) return;
  for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = href;
    if (href.includes('gstatic')) pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS;
  link.setAttribute('data-meritai-fonts', '');
  document.head.appendChild(link);
}
