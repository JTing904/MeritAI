import { Pressable, StyleSheet, View } from 'react-native';
import type { TaskKind } from '@shared/types';
import { Sheet, SheetOption } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';

export const KINDS: TaskKind[] = ['CODE', 'DOC', 'RESEARCH', 'DESIGN', 'MEETING'];

/** The pills and the chip are about 34px tall; this brings their touch area to 44px. */
const HIT_Y = { top: 5, bottom: 5 };

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: { borderWidth: 2, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: c.card, borderColor: c.line },
    on: { borderColor: c.grape, backgroundColor: c.grapeSoft },
  }),
);

/** Inline kind choice (prototype `.kind-pick`): 💻 代码 / 📄 文档 / … with the selected one in grape. */
export function KindPills({ value, onChange, label }: { value: TaskKind; onChange: (k: TaskKind) => void; label: string }) {
  const s = useStyles();
  const { t } = useI18n();
  return (
    <View style={s.wrap} role="radiogroup" aria-label={label}>
      {KINDS.map((k) => {
        const on = k === value;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            role="radio"
            aria-checked={on}
            collapsable={false}
            hitSlop={HIT_Y}
            style={[s.pill, on && s.on]}>
            <Txt v="small" size={13} weight={700} color={on ? 'grapeText' : 'ink2'}>
              {t.labels.kindEmoji[k]} {t.labels.kind[k]}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The manual-mode kind chip (「🔎 调研 ▾」) that opens a sheet of kinds. */
export function KindChip({ value, onPress, label }: { value: TaskKind; onPress: () => void; label: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      role="button"
      aria-label={`${label}: ${t.labels.kind[value]}`}
      hitSlop={HIT_Y}
      style={({ pressed }) => ({
        minHeight: 34,
        justifyContent: 'center',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderWidth: 2,
        borderColor: c.line,
        borderRadius: 12,
        backgroundColor: pressed ? c.card2 : c.card,
      })}>
      <Txt v="small" size={13} weight={600}>
        {t.labels.kindEmoji[value]} {t.labels.kind[value]} ▾
      </Txt>
    </Pressable>
  );
}

export function KindSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (k: TaskKind) => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.wizard.manual.kindSheet}>
      {KINDS.map((k) => (
        <SheetOption
          key={k}
          emoji={t.labels.kindEmoji[k]}
          title={t.labels.kind[k]}
          onPress={() => {
            onPick(k);
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}
