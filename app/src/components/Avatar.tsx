import { View } from 'react-native';
import { useTheme } from '@/theme';
import type { Highlighter } from '@/theme/tokens';
import { Txt } from './Txt';

const SIZES = { sm: { box: 26, glyph: 11.5, ring: 2 }, md: { box: 34, glyph: 14, ring: 2 }, lg: { box: 64, glyph: 26, ring: 3 } };

/** Member avatar: the member's highlighter colour with the first character of their name. */
export function Avatar({
  name,
  hl,
  size = 'md',
  decorative,
}: {
  name: string;
  hl: Highlighter;
  size?: keyof typeof SIZES;
  /** True when the name is already shown or read next to the avatar. */
  decorative?: boolean;
}) {
  const { c } = useTheme();
  const s = SIZES[size];
  const glyph = Array.from(name.trim())[0] ?? '?';
  return (
    <View
      {...(decorative
        ? { accessible: false, 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants' as const }
        : { accessible: true, role: 'img' as const, 'aria-label': name })}
      style={{
        width: s.box,
        height: s.box,
        borderRadius: s.box / 2,
        backgroundColor: c.hl[hl].base,
        borderWidth: s.ring,
        borderColor: c.card,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Txt v="body" size={s.glyph} weight={900} color="onHl" style={{ lineHeight: Math.round(s.glyph * 1.2) }}>
        {glyph}
      </Txt>
    </View>
  );
}

/** Overlapping avatars (-9px), as on project cards. */
export function AvatarStack({ people, size = 'sm' }: { people: { name: string; hl: Highlighter }[]; size?: keyof typeof SIZES }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((p, i) => (
        <View key={`${p.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -9 }}>
          <Avatar name={p.name} hl={p.hl} size={size} />
        </View>
      ))}
    </View>
  );
}
