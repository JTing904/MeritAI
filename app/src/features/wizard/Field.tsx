import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Txt } from '@/components/Txt';
import { makeStyles, useTheme } from '@/theme';
import { fontStyle } from '@/theme/fonts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    field: { gap: 6 },
    labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 4 },
    // The prototype's input is 2 + 12 + 23 (15px × 1.55) + 12 + 2 = 51px tall. Android adds Noto Sans SC's
    // tall font padding and its own line box unless both are pinned, which made inputs ~20px taller.
    input: {
      borderWidth: 2,
      borderColor: c.line,
      borderRadius: 14,
      backgroundColor: c.card,
      paddingVertical: 12,
      paddingHorizontal: 14,
      color: c.ink,
      fontSize: 15,
      lineHeight: 23,
      textAlignVertical: 'center',
      ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
      ...fontStyle('body', 400),
    },
    multiline: { minHeight: 132, lineHeight: 24, textAlignVertical: 'top' },
    box: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  }),
);

/** Label (13/700 ink-2) with an optional muted qualifier, then the control, then hint or error. */
export function Field({
  label,
  small,
  error,
  hint,
  children,
}: {
  label: string;
  small?: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <View style={s.field}>
      <View style={s.labelRow}>
        <Txt v="label">{label}</Txt>
        {small ? (
          <Txt v="label" weight={500} color="muted">
            {small}
          </Txt>
        ) : null}
      </View>
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {typeof hint === 'string' ? <Hint>{hint}</Hint> : hint}
    </View>
  );
}

export type InputProps = TextInputProps & { invalid?: boolean; label: string };

/** The prototype's `.input`: 2px line border that turns grape on focus (red when invalid). */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid, label, style, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const s = useStyles();
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholderTextColor={c.muted}
      multiline={multiline}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        s.input,
        multiline && s.multiline,
        { borderColor: invalid ? c.bad : focused ? c.grape : c.line },
        Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
        style,
      ]}
      {...rest}
    />
  );
});

export function Hint({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <Txt v="meta" center={center}>
      {children}
    </Txt>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Txt v="meta" color="bad" weight={600} aria-live="polite">
      {children}
    </Txt>
  );
}

/** warn-box (warn on warn-soft) or info-box (good on good-soft), with an optional action under the text. */
export function NoteBox({ tone, children, action }: { tone: 'warn' | 'good'; children: ReactNode; action?: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.box, action ? { gap: 10 } : null, { backgroundColor: tone === 'warn' ? c.warnSoft : c.goodSoft }]}>
      <Txt v="meta" color={tone === 'warn' ? 'warn' : 'good'}>
        {children}
      </Txt>
      {action}
    </View>
  );
}
