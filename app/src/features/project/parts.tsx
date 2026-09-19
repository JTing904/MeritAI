import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MemberView, PackageView, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Txt, type VariantName } from '@/components/Txt';
import { deviceTimeZone } from '@/features/wizard/zoned';
import { useDates } from '@/features/wizard/dates';
import type { Inline } from '@/i18n/sections/project.zh';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    tile: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.card2 },
    optPressed: { opacity: 0.85 },
    optGrow: { flex: 1, minWidth: 0, gap: 1 },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    noticeBody: { flex: 1, minWidth: 0, gap: 2 },
    more: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  }),
);

/** Dates as the viewer reads them: in this device's time zone (REQUIREMENTS: everyone sees local times). */
export function useLocalDates() {
  return useDates(deviceTimeZone());
}

export const memberById = (project: ProjectView, id: string | null): MemberView | null =>
  (id && project.members.find((m) => m.id === id)) || null;

export const ownerOf = (project: ProjectView, pkg: PackageView): MemberView | null => memberById(project, pkg.ownerMemberId);

export const packageById = (project: ProjectView, id: string | null): PackageView | null =>
  (id && project.packages.find((p) => p.id === id)) || null;

export const isFinished = (status: string) => status === 'DONE' || status === 'HALF';

/** The prototype's `.pkg-num`: the package number on the owner's colour, or the waiting grey when free. */
export function PackageTile({ index, owner }: { index: number; owner: MemberView | null }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.tile, { backgroundColor: owner ? c.hl[owner.color].base : c.waiting }]} aria-hidden>
      {/* Dark ink on the dark-mode waiting grey is unreadable; the app's ink works on both greys. */}
      <Txt v="num" size={19} color={owner ? 'onHl' : 'ink'}>
        {index}
      </Txt>
    </View>
  );
}

/** Sheet option (`.opt-row`): a leading tile or avatar, a bold title and a muted line. */
export function OptRow({
  leading,
  title,
  sub,
  onPress,
  disabled,
  busy,
}: {
  leading: ReactNode;
  title: string;
  sub?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const s = useStyles();
  const inactive = !!(disabled || busy);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      role="button"
      aria-disabled={inactive}
      aria-busy={!!busy}
      style={({ pressed }) => [s.opt, pressed && !inactive && s.optPressed, disabled && { opacity: 0.55 }]}>
      {leading}
      <View style={s.optGrow}>
        <Txt v="body" weight={700}>
          {title}
        </Txt>
        {sub ? <Txt v="meta">{sub}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** A sentence whose `{ b }` pieces are bold. */
export function InlineText({ parts, v = 'text', color }: { parts: Inline[]; v?: VariantName; color?: string }) {
  return (
    <Txt v={v} color={color}>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <Txt key={i} v={v} color={color} weight={700}>
            {part.b}
          </Txt>
        ),
      )}
    </Txt>
  );
}

/** A card with an emoji, a bold title, an optional line and an optional action (NoPackage mockup). */
export function NoticeCard({
  tone,
  emoji,
  title,
  body,
  action,
}: {
  /** warn: the NoPackage mockup's warn-soft card. */
  tone: 'plain' | 'warn';
  emoji: string;
  title: string;
  body?: string;
  action?: { title: string; onPress: () => void; kind?: 'primary' | 'soft' };
}) {
  const s = useStyles();
  const { c } = useTheme();
  const warn = tone === 'warn';
  return (
    <Card style={[s.notice, warn && { backgroundColor: c.warnSoft }]}>
      <Txt v="body" size={26} style={{ lineHeight: 34 }} aria-hidden>
        {emoji}
      </Txt>
      <View style={s.noticeBody}>
        <Txt v="text" weight={700} color={warn ? 'warn' : 'ink'}>
          {title}
        </Txt>
        {body ? (
          <Txt v="meta" color={warn ? 'warn' : 'muted'}>
            {body}
          </Txt>
        ) : null}
        {action ? (
          <View style={{ marginTop: 8 }}>
            <Button title={action.title} kind={action.kind ?? 'primary'} small onPress={action.onPress} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** The leader's `⋯` next to a task (`.more`). */
export function MoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      role="button"
      aria-label={label}
      hitSlop={7}
      style={({ pressed }) => [s.more, pressed && { backgroundColor: c.card }]}>
      <Txt v="body" size={18} color="muted" style={{ lineHeight: 22 }}>
        ⋯
      </Txt>
    </Pressable>
  );
}
