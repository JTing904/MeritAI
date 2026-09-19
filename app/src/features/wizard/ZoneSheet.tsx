import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { ZONES, zoneName } from './dates';
import { deviceTimeZone, utcOffsetLabel } from './zoned';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card2, borderRadius: 16, padding: 12 },
    grow: { flex: 1, gap: 2 },
  }),
);

/** Project time-zone choice: the device zone first, then common zones for Malaysian and overseas teams. */
export function ZoneSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string;
  onClose: () => void;
  onPick: (tz: string) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const device = deviceTimeZone();
  const zones = [device, ...ZONES.filter((z) => z !== device)];
  if (!zones.includes(value)) zones.unshift(value);

  return (
    <Sheet visible={visible} onClose={onClose} title={t.wizard.basics.zoneSheet}>
      <View role="radiogroup" aria-label={t.wizard.basics.zoneSheet} style={{ gap: 10 }}>
        {zones.map((z) => {
          const on = z === value;
          return (
            <Pressable
              key={z}
              role="radio"
              aria-checked={on}
              onPress={() => {
                onPick(z);
                onClose();
              }}
              style={({ pressed }) => [s.opt, pressed && { opacity: 0.85 }]}>
              <View style={s.grow}>
                <Txt v="body" weight={700}>
                  {zoneName(z, t.wizard.zones)}
                </Txt>
                <Txt v="meta">{z === device ? `${utcOffsetLabel(z)} · ${t.wizard.basics.zoneDevice}` : utcOffsetLabel(z)}</Txt>
              </View>
              {on ? <Icon name="check" size={18} color={c.grapeText} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
