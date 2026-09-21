import { StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { InlineText } from '@/features/project/parts';
import type { InlinePart } from '@/i18n/sections/home.zh';

const styles = StyleSheet.create({
  list: { gap: 6 },
  item: { flexDirection: 'row', gap: 8, paddingRight: 4 },
  body: { flex: 1, minWidth: 0 },
});

/** The mockups' `.bul` list: one sentence per point, `{ b }` pieces bold. */
export function Bullets({ items }: { items: (string | InlinePart[])[] }) {
  return (
    <View style={styles.list} role="list">
      {items.map((item, i) => (
        <View key={i} style={styles.item} role="listitem">
          <Txt v="text" color="ink2" aria-hidden>
            •
          </Txt>
          <View style={styles.body}>
            <InlineText parts={typeof item === 'string' ? [item] : item} v="text" color="ink2" />
          </View>
        </View>
      ))}
    </View>
  );
}
