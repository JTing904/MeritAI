// Design tokens from the approved prototype (docs/prototype/index.html).
import { HIGHLIGHTERS, type Highlighter } from '@shared/constants';
import { alpha, mix } from './color';

// Highlighter ("荧光笔") colours: the first six come from the prototype; lime and aqua were added for 8-person teams.
export { HIGHLIGHTERS, type Highlighter };

const HL_LIGHT: Record<Highlighter, string> = {
  lemon: '#FFD84A',
  gum: '#FF86BA',
  mint: '#3FD89B',
  sky: '#5AAEFF',
  tang: '#FF9E47',
  lilac: '#B794FF',
  lime: '#B7E35A',
  aqua: '#45D4DE',
};

const HL_DARK: Record<Highlighter, string> = {
  lemon: '#F2C94C',
  gum: '#F07AAE',
  mint: '#36C98E',
  sky: '#4F9EF0',
  tang: '#F0913E',
  lilac: '#A987F5',
  lime: '#A6D24F',
  aqua: '#3DC1CB',
};

const LIGHT = {
  paper: '#F5F4FA',
  card: '#FFFFFF',
  card2: '#EFEDF7',
  ink: '#1E1B2E',
  ink2: '#4A4660',
  muted: '#625D76',
  line: '#E1DEEC',
  grape: '#6246EA',
  grapePress: '#4429C4',
  grapeSoft: '#ECE8FF',
  grapeText: '#4E33D2',
  onGrape: '#FFFFFF',
  onHl: '#1E1B2E',
  good: '#0B7A4C',
  goodSoft: '#DDF6EA',
  warn: '#8F5100',
  warnSoft: '#FFEFD2',
  bad: '#B8223C',
  badSoft: '#FFE4E9',
  onBad: '#FFFFFF',
  onInkGood: '#3FD89B',
  /** Unpicked packages ("待选色"): one neutral grey, per the confirmed requirements. */
  waiting: '#C9C5D6',
  /** Prototype --shadow (cards, lists, toast). */
  shadow: '0 1px 0 rgba(30,27,46,0.04), 0 10px 28px -16px rgba(30,27,46,0.28)',
  hlStrength: 1,
};

type Base = typeof LIGHT;

const DARK: Base = {
  paper: '#15131E',
  card: '#1F1C2B',
  card2: '#2A2639',
  ink: '#F3F1FA',
  ink2: '#CFCAE3',
  muted: '#A7A2BE',
  line: '#332F46',
  grape: '#6A52F0',
  grapePress: '#4A33C8',
  grapeSoft: '#2D2652',
  grapeText: '#BCAFFF',
  onGrape: '#FFFFFF',
  onHl: '#1E1B2E',
  good: '#52D69B',
  goodSoft: '#173A2C',
  warn: '#F4B35A',
  warnSoft: '#3A2C14',
  bad: '#FF7A8F',
  badSoft: '#401B24',
  onBad: '#1E1B2E',
  onInkGood: '#0B7A4C',
  waiting: '#4A4560',
  shadow: '0 1px 0 rgba(0,0,0,0.2), 0 12px 28px -16px rgba(0,0,0,0.7)',
  hlStrength: 0.48,
};

/** Precomputed tints of one highlighter colour for a theme (prototype color-mix values). */
export type HlSet = {
  /** Full colour: avatars, picked packages, bars, ring stroke. Stays bright in dark mode. */
  base: string;
  /** The highlighter band behind text (dimmed in dark mode). */
  band: string;
  /** 30% into card: kind tile. */
  tile: string;
  /** 34% into card: chip / podium block. */
  chip: string;
  /** 32% into card: notification emoji tile. */
  notif: string;
  /** 40% into card: badge coin. */
  coin: string;
  /** Darker lip under a highlighter button. */
  lip: string;
};

function buildTheme(base: Base, hls: Record<Highlighter, string>) {
  const hl = {} as Record<Highlighter, HlSet>;
  for (const name of HIGHLIGHTERS) {
    const c = hls[name];
    hl[name] = {
      base: c,
      band: mix(c, base.paper, base.hlStrength),
      tile: mix(c, base.card, 0.3),
      chip: mix(c, base.card, 0.34),
      notif: mix(c, base.card, 0.32),
      coin: mix(c, base.card, 0.4),
      lip: mix(c, '#000000', 0.62),
    };
  }
  return {
    ...base,
    hl,
    /** Invite card: lilac 22% into card. */
    invite: mix(hls.lilac, base.card, 0.22),
    /** Selected choice card: grape-soft 60% into card. */
    choiceSelected: mix(base.grapeSoft, base.card, 0.6),
    dangerLip: mix(base.bad, base.card, 0.3),
    appbar: alpha(base.paper, 0.92),
    pressed: alpha(base.card2, 0.6),
    overrideBorder: alpha(base.grape, 0.4),
    scrim: 'rgba(20, 16, 36, 0.45)',
    weekTile: alpha(base.paper, 0.1),
  };
}

export const lightColors = buildTheme(LIGHT, HL_LIGHT);
export const darkColors = buildTheme(DARK, HL_DARK);
export type Colors = typeof lightColors;

export const radius = {
  card: 20,
  sheet: 26,
  panel: 22,
  tile18: 18,
  chipLg: 16,
  button: 15,
  input: 14,
  kind: 13,
  sm: 12,
  // No 'pill: 999': Android drops oversized radii when the background changes after mount. Use half the height.
} as const;

/** Spacing values the prototype uses; gutter is the screen side padding. */
export const space = { xxs: 2, xs: 4, s: 6, sm: 8, m: 10, ml: 12, mm: 14, l: 16, gutter: 18, xl: 20, xxl: 28 } as const;

/** Maximum content width: phones use the full width; tablets and desktop get a centred phone column. */
export const MAX_WIDTH = 520;
