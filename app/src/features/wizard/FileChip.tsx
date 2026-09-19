import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { makeStyles, useTheme } from '@/theme';
import { fileSort } from './upload';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    chip: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16 },
    ico: { width: 38, height: 38, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
    grow: { flex: 1, minWidth: 0, gap: 1 },
    del: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  }),
);

/** The prototype's `.file-chip`; with `error`, the UploadError row (bad-soft, red meta). */
export function FileChip({
  name,
  meta,
  mimeType,
  error,
  onRemove,
  removeLabel,
}: {
  name: string;
  meta: string;
  mimeType?: string | null;
  error?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.chip, { backgroundColor: error ? c.badSoft : c.card2 }]}>
      <View style={s.ico}>
        <Txt v="body" size={19} style={{ lineHeight: 24 }} aria-hidden>
          {fileSort(name, mimeType) === 'image' ? '🖼️' : '📄'}
        </Txt>
      </View>
      <View style={s.grow}>
        <Txt v="small" weight={700} style={Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as object) : undefined}>
          {name}
        </Txt>
        <Txt v="meta" size={12} color={error ? 'bad' : 'muted'} weight={error ? 600 : 400}>
          {meta}
        </Txt>
      </View>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          role="button"
          aria-label={removeLabel}
          hitSlop={7}
          collapsable={false}
          style={({ pressed }) => [s.del, pressed && { backgroundColor: c.card }]}>
          <Icon name="close" size={16} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
