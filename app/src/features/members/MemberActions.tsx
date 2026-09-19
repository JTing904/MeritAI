import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatTotal } from '@shared/planning';
import type { MemberView, ProjectView } from '@shared/types';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';
import { memberPackage } from './format';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card2, borderRadius: 16, padding: 12 },
    grow: { flex: 1, minWidth: 0, gap: 1 },
  }),
);

type OptionProps = { emoji: string; title: string; sub: string; danger?: boolean; onPress: () => void };

/** A sheet option (the mockup's `.opt-row`): emoji, title (red when dangerous), explanation. */
function Option({ emoji, title, sub, danger, onPress }: OptionProps) {
  const s = useStyles();
  return (
    <Pressable onPress={onPress} role="button" style={({ pressed }) => [s.opt, pressed && { opacity: 0.85 }]}>
      <Txt v="body" size={22} style={{ lineHeight: 28 }} aria-hidden>
        {emoji}
      </Txt>
      <View style={s.grow}>
        <Txt v="body" weight={700} color={danger ? 'bad' : 'ink'}>
          {title}
        </Txt>
        <Txt v="meta">{sub}</Txt>
      </View>
    </Pressable>
  );
}

/**
 * The leader's ⋯ on a member (MemberActions mockup): 转让组长 or 移出项目, each asked again with
 * ConfirmSheet. `memberId` null = closed; the sheet also closes when that member is no longer active.
 */
export function MemberActions({
  project,
  memberId,
  onClose,
  onChange,
  onError,
}: {
  project: ProjectView;
  memberId: string | null;
  onClose: () => void;
  onChange: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const a = t.members.actions;
  const { request } = useSession();
  const { show } = useToast();
  // Tied to the member it was opened for, so a confirm left open (its member left meanwhile) never
  // reappears for the next member.
  const [asked, setAsked] = useState<{ kind: 'transfer' | 'remove'; memberId: string } | null>(null);

  const member = project.members.find((m) => m.id === memberId && m.active) ?? null;
  // The confirm sheets keep their text while they close (on the web a closing Modal renders once more).
  const last = useRef<MemberView | null>(null);
  if (member) last.current = member;
  const name = last.current?.name ?? '';
  const confirm = asked && asked.memberId === memberId ? asked.kind : null;
  const ask = (kind: 'transfer' | 'remove') => {
    if (memberId) setAsked({ kind, memberId });
  };
  const pkg = member ? memberPackage(project, member) : null;
  const managesOnly = project.basics.leaderManages;

  const close = () => {
    setAsked(null);
    onClose();
  };

  const act = async (kind: 'transfer' | 'remove') => {
    if (!member) return;
    try {
      const view = await request<ProjectView>(
        `/projects/${encodeURIComponent(project.basics.id)}/members/${encodeURIComponent(member.id)}/${kind}`,
        { method: 'POST' },
      );
      onChange(view);
      show(kind === 'transfer' ? a.transferred(member.name) : a.removed(member.name));
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <Sheet visible={!!member && confirm === null} onClose={close} title={member?.name}>
        {member ? (
          <>
            <Txt v="small" color="ink2">
              {pkg ? a.sub(pkg.index, formatTotal(pkg.points), pkg.started) : a.noPackage}
            </Txt>
            <Option emoji="👑" title={a.transfer} sub={a.transferSub} onPress={() => ask('transfer')} />
            <Option emoji="🚪" title={a.remove} sub={a.removeSub} danger onPress={() => ask('remove')} />
            <Txt v="meta">{a.hint}</Txt>
          </>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={!!member && confirm === 'transfer'}
        title={a.transferTitle(name)}
        body={a.transferBody(managesOnly)}
        confirmLabel={a.transferConfirm}
        onConfirm={() => act('transfer')}
        onClose={close}
      />
      <ConfirmSheet
        visible={!!member && confirm === 'remove'}
        title={a.removeTitle(name)}
        body={a.removeSub}
        confirmLabel={a.removeConfirm}
        danger
        onConfirm={() => act('remove')}
        onClose={close}
      />
    </>
  );
}
