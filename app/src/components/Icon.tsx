import { Platform } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Line icons from the prototype: 24 viewBox, round caps and joins, stroke 2 unless noted.
export type IconName =
  | 'home'
  | 'tasks'
  | 'bell'
  | 'user'
  | 'plus'
  | 'back'
  | 'close'
  | 'gear'
  | 'upload'
  | 'file'
  | 'copy'
  | 'chevron'
  | 'sparkle'
  | 'shuffle'
  | 'check'
  | 'link'
  | 'external'
  | 'undo'
  | 'play'
  | 'image'
  | 'table'
  | 'door'
  | 'trash';

const HIDDEN =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as object)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

const STROKE: Partial<Record<IconName, number>> = { plus: 2.6, back: 2.4, close: 2.4, check: 3 };

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={STROKE[name] ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...HIDDEN}>
      {GLYPHS[name]}
    </Svg>
  );
}

const GLYPHS: Record<IconName, React.ReactNode> = {
  home: <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  tasks: (
    <>
      <Rect x={3} y={3} width={18} height={18} rx={5} />
      <Path d="m8 12 3 3 5-6" />
    </>
  ),
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  user: (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  back: <Path d="m15 18-6-6 6-6" />,
  close: <Path d="M18 6 6 18M6 6l12 12" />,
  gear: (
    <>
      <Path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <Circle cx={15} cy={6} r={2} />
      <Circle cx={9} cy={12} r={2} />
      <Circle cx={17} cy={18} r={2} />
    </>
  ),
  upload: (
    <>
      <Path d="M12 15V4M7 9l5-5 5 5" />
      <Path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  file: (
    <>
      <Path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <Path d="M14 3v5h5" />
    </>
  ),
  copy: (
    <>
      <Rect x={8} y={8} width={12} height={12} rx={2} />
      <Path d="M4 16V5a1 1 0 0 1 1-1h11" />
    </>
  ),
  chevron: <Path d="m9 18 6-6-6-6" />,
  sparkle: <Path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  shuffle: (
    <>
      <Path d="M16 3h5v5" />
      <Path d="M4 20 21 3" />
      <Path d="M21 16v5h-5" />
      <Path d="m15 15 6 6" />
      <Path d="M4 4l5 5" />
    </>
  ),
  check: <Path d="m5 12 5 5L20 7" />,
  // M4 (mockups batch 3).
  link: (
    <>
      <Path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <Path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" />
    </>
  ),
  external: (
    <>
      <Path d="M14 4h6v6" />
      <Path d="M20 4 10 14" />
      <Path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>
  ),
  undo: (
    <>
      <Path d="M9 14 4 9l5-5" />
      <Path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  play: <Path d="m6 4 14 8-14 8z" />,
  image: (
    <>
      <Rect x={3} y={3} width={18} height={18} rx={3} />
      <Circle cx={8.5} cy={8.5} r={1.5} />
      <Path d="m21 15-5-5L5 21" />
    </>
  ),
  table: (
    <>
      <Rect x={3} y={3} width={18} height={18} rx={3} />
      <Path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  // Leader leaves / deletes the project (LeaderLeave mockup).
  door: (
    <>
      <Path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <Path d="M9 16l-4-4 4-4" />
      <Path d="M5 12h11" />
    </>
  ),
  trash: (
    <>
      <Path d="M4 7h16" />
      <Path d="M9 7V4h6v3" />
      <Path d="M6 7l1 13h10l1-13" />
    </>
  ),
};
