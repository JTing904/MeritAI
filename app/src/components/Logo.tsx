import { View } from 'react-native';
import { useTheme } from '@/theme';
import { Txt } from './Txt';

/** Brand mark: a lemon "M" tile tilted -6° with a hard gum offset shadow, plus the wordmark. */
export function Logo() {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible role="img" aria-label="MeritAI">
      <View style={{ width: 30, height: 30 }}>
        <View
          style={{
            position: 'absolute',
            left: 3,
            top: 3,
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: c.hl.gum.base,
            transform: [{ rotate: '-6deg' }],
          }}
        />
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            backgroundColor: c.hl.lemon.base,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: '-6deg' }],
          }}>
          <Txt v="brand" size={17} color="onHl" maxFontSizeMultiplier={1.2}>
            M
          </Txt>
        </View>
      </View>
      <Txt v="brand">MeritAI</Txt>
    </View>
  );
}
