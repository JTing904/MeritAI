import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles } from '@/theme';
import { gradeTone, LEADER_GRADES, type LeaderGrade } from './grades';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    grid: { gap: 8 },
    pair: { flexDirection: 'row', gap: 8 },
    // The mockup's `.lvl`: 2px line border on the card, grape ring on grape-soft when chosen. The border is
    // always there (only its colour changes) so the layout doesn't jump.
    lvl: {
      flex: 1,
      minWidth: 0,
      gap: 2,
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: 16,
      backgroundColor: c.card,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    on: { borderColor: c.grape, backgroundColor: c.grapeSoft },
    pressed: { opacity: 0.85 },
    off: { opacity: 0.55 },
  }),
);

export type LevelOption = { grade: LeaderGrade; sub: string; disabled?: boolean };

/** The 2×2 等级 buttons (`.lvls`): 优秀 / 合格 / 拿一半 / 不通过 in good / good / warn / bad, each with its points line. */
export function Levels({
  options,
  value,
  onChange,
  label,
}: {
  /** One per LEADER_GRADES entry, in that order. */
  options: LevelOption[];
  value: LeaderGrade | null;
  onChange: (grade: LeaderGrade) => void;
  label: string;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const byGrade = new Map(options.map((o) => [o.grade, o]));
  const rows = [LEADER_GRADES.slice(0, 2), LEADER_GRADES.slice(2)];
  return (
    <View style={s.grid} role="radiogroup" aria-label={label}>
      {rows.map((row, i) => (
        <View key={i} style={s.pair}>
          {row.map((grade) => {
            const o = byGrade.get(grade);
            const on = value === grade;
            const disabled = !!o?.disabled;
            const pick = () => {
              if (!disabled) onChange(grade);
            };
            return (
              <Pressable
                key={grade}
                onPress={pick}
                disabled={disabled}
                role="radio"
                aria-checked={on}
                aria-disabled={disabled}
                aria-label={o ? `${t.labels.grade[grade]} · ${o.sub}` : t.labels.grade[grade]}
                {...(Platform.OS === 'web' && !disabled
                  ? {
                      onKeyDown: (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
                        if (e.nativeEvent.key === ' ') {
                          e.preventDefault?.();
                          pick();
                        }
                      },
                    }
                  : {})}
                style={({ pressed }) => [s.lvl, on && s.on, disabled && s.off, pressed && !disabled && s.pressed]}>
                <Txt v="body" size={16} weight={700} color={gradeTone(grade)}>
                  {t.labels.grade[grade]}
                </Txt>
                {o ? (
                  <Txt v="meta" size={12}>
                    {o.sub}
                  </Txt>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
