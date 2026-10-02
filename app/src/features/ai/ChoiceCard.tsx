import { Pressable, StyleSheet, View } from 'react-native';
import type { ChoiceOptionView } from '@shared/types';
import { Chip, type ChipTone } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    // `.choice`
    card: { flexDirection: 'row', gap: 12, borderWidth: 2, borderColor: c.line, backgroundColor: c.card, borderRadius: 18, padding: 14 },
    on: { borderColor: c.grape, backgroundColor: c.choiceSelected },
    locked: { borderColor: c.line, backgroundColor: c.card2 },
    box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: c.line, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    boxOn: { backgroundColor: c.grape, borderColor: c.grape },
    boxLocked: { backgroundColor: c.muted, borderColor: c.muted },
    body: { flex: 1, minWidth: 0, gap: 4 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    pc: { flexDirection: 'row', gap: 8, marginTop: 4 },
    pcCol: { flex: 1, minWidth: 0, gap: 3, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10 },
  }),
);

/** 1.5 hours → 「1.5」, 8 → 「8」. */
export const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

export type ChoiceMark = { text: string; tone: ChipTone };

/**
 * One option of a 选择题 (`.choice`): a box (square for 任选, round for 选一种做法), the name, why, the
 * workload / material / difficulty chips, 「✨ AI 推荐」, and for a method the 优点 / 缺点 columns.
 * `locked`: someone started it (改选 can't drop it); `dropped`: 改选 would drop it (struck through).
 */
export function ChoiceCard({
  option,
  method,
  on,
  onPress,
  locked,
  dropped,
  mark,
  showKey = true,
}: {
  option: ChoiceOptionView;
  method: boolean;
  on: boolean;
  onPress?: () => void;
  locked?: boolean;
  dropped?: boolean;
  /** An extra chip at the end (「🔒 张博文 已开始」, 「取消」, 「新选」). */
  mark?: ChoiceMark | null;
  showKey?: boolean;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const k = t.ai.choice;
  const name = method || !showKey ? option.label : k.optionName(option.key, option.label);
  const disabled = !onPress || locked;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role={method ? 'radio' : 'checkbox'}
      aria-checked={on}
      aria-disabled={disabled}
      aria-label={[name, option.summary, mark?.text].filter(Boolean).join('，')}
      style={({ pressed }) => [s.card, on && !locked && s.on, locked && s.locked, pressed && !disabled && { opacity: 0.85 }]}>
      <View style={[s.box, method && { borderRadius: 12 }, on && (locked ? s.boxLocked : s.boxOn)]} aria-hidden>
        {on ? <Icon name="check" size={method ? 14 : 16} color={c.onGrape} /> : null}
      </View>
      <View style={s.body}>
        <Txt
          v="body"
          weight={900}
          color={dropped ? 'muted' : 'ink'}
          style={dropped ? { textDecorationLine: 'line-through' } : undefined}>
          {name}
        </Txt>
        {option.summary ? (
          <Txt v="meta" size={12.5} color="ink2">
            {option.summary}
          </Txt>
        ) : null}
        {method && (option.pros.length > 0 || option.cons.length > 0) ? (
          <View style={s.pc}>
            <View style={[s.pcCol, { backgroundColor: c.goodSoft }]}>
              <Txt v="meta" size={12} weight={700} color="good">
                {k.pros}
              </Txt>
              {option.pros.map((p, i) => (
                <Txt key={i} v="meta" size={12} color="ink2">
                  · {p}
                </Txt>
              ))}
            </View>
            <View style={[s.pcCol, { backgroundColor: c.badSoft }]}>
              <Txt v="meta" size={12} weight={700} color="bad">
                {k.cons}
              </Txt>
              {option.cons.map((p, i) => (
                <Txt key={i} v="meta" size={12} color="ink2">
                  · {p}
                </Txt>
              ))}
            </View>
          </View>
        ) : null}
        <View style={s.tags}>
          {method ? (
            <Chip>{k.load(hoursText(option.hours))}</Chip>
          ) : (
            <>
              <Chip>{k.hours(hoursText(option.hours))}</Chip>
              <Chip>{k.material[option.material]}</Chip>
              <Chip>{k.difficulty[option.difficulty]}</Chip>
            </>
          )}
          {option.recommended ? <Chip tone="grape">{k.recommended}</Chip> : null}
          {mark ? <Chip tone={mark.tone}>{mark.text}</Chip> : null}
        </View>
      </View>
    </Pressable>
  );
}
