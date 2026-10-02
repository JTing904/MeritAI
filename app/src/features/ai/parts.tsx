import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles, useTheme } from '@/theme';
import { alpha } from '@/theme/color';
import { Bullets } from '@/features/task/parts';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    tag: { alignSelf: 'center', borderRadius: 11, paddingVertical: 2, paddingHorizontal: 8, backgroundColor: c.grapeSoft },
    priv: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card2, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 15, backgroundColor: c.card2 },
    err: { gap: 10, borderRadius: 20, padding: 16 },
    use: { gap: 5 },
    useHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    bar: { height: 8, borderRadius: 4, backgroundColor: c.card2, overflow: 'hidden' },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
    warnBox: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.warnSoft },
  }),
);

/** 「✨ AI 写的」 (`.ai-tag`) beside a card title. */
export function AiTag() {
  const s = useStyles();
  const { t } = useI18n();
  return (
    <View style={s.tag}>
      <Txt v="chip" size={11.5} weight={700} color="grapeText" maxFontSizeMultiplier={1.4}>
        {t.ai.tag}
      </Txt>
    </View>
  );
}

/** 🔒 privacy line (`.priv`). */
export function PrivacyLine({ children }: { children: string }) {
  const s = useStyles();
  return (
    <View style={s.priv}>
      <Txt v="meta" size={12.5} aria-hidden>
        🔒
      </Txt>
      <Txt v="meta" size={12.5} color="ink2" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

/** `.key-row`: the provider and the masked key, with a small line under it. */
export function KeyRow({ children, sub, tint }: { children: ReactNode; sub?: string | null; tint?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.keyRow, tint && { backgroundColor: alpha(c.card, 0.7) }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {children}
        {sub ? <Txt v="meta" size={12}>{sub}</Txt> : null}
      </View>
    </View>
  );
}

/** The key as `.key` (mono) after the provider's name in bold: 「Gemini · AIza••••3kQx」. */
export function KeyText({ provider, masked }: { provider: string; masked: string }) {
  return (
    <Txt v="small" size={14}>
      <Txt v="small" size={14} weight={700}>
        {provider}
      </Txt>
      {' · '}
      <Txt v="mono" size={14}>
        {masked}
      </Txt>
    </Txt>
  );
}

/** `.err-card` (bad or warn): a heading, then labelled bullet lists and actions. */
export function ErrCard({ tone, title, children }: { tone: 'bad' | 'warn'; title: string; children: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.err, { backgroundColor: tone === 'bad' ? c.badSoft : c.warnSoft }]}>
      <Txt v="body" size={16} weight={900} color={tone}>
        {title}
      </Txt>
      {children}
    </View>
  );
}

/** One labelled list inside an ErrCard (「现在会怎样」 + bullets). */
export function ErrList({ label, lines }: { label: string; lines: string[] }) {
  return (
    <View style={{ gap: 4 }}>
      <Txt v="label" size={12.5}>
        {label}
      </Txt>
      <Bullets lines={lines} color="ink" />
    </View>
  );
}

/** `.use`: a label, 「4 / 约 20 次」 on the right, and a bar. `ratio` null: no limit known (no bar fill). */
export function UseBar({ label, count, ratio, color }: { label: string; count: string; ratio: number | null; color?: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const pct = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={s.use} accessible aria-label={`${label}: ${count}`}>
      <View style={s.useHead}>
        <Txt v="small" weight={700} style={{ flex: 1 }}>
          {label}
        </Txt>
        <Txt v="small" weight={800} color="ink2" tabular>
          {count}
        </Txt>
      </View>
      <View style={s.bar}>
        <View style={[s.fill, { width: `${pct}%`, backgroundColor: color ?? c.grape }]} />
      </View>
    </View>
  );
}

/** `.warn-box`. */
export function WarnBox({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.warnBox}>
      <Txt v="meta" size={12.5} color="warn">
        {children}
      </Txt>
    </View>
  );
}
