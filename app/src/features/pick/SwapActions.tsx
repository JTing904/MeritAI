import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ProjectView, SwapView } from '@shared/types';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';
import { pendingSwaps } from './foot';

export type SwapActionsProps = {
  /** The pending swap between the viewer and this card's package owner. */
  swap: SwapView;
  project: ProjectView;
  /** Called with the view the swap endpoint returned (accept, decline and cancel all return ProjectView). */
  onChange: (view: ProjectView) => void;
  /** useProject's onError. */
  onError?: (err: unknown) => void;
};

type Action = 'accept' | 'decline' | 'cancel';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    ask: { textAlign: 'center' },
    buttons: { flexDirection: 'row', gap: 10 },
    pending: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      padding: 12,
      borderRadius: 15,
      backgroundColor: c.warnSoft,
    },
    center: { alignItems: 'center' },
    link: { padding: 4 },
  }),
);

/**
 * The foot of a pick card when a swap is pending: the owner asked me (拒绝 / 同意互换), or I asked them
 * (⏳ 等…同意 + 取消申请). No confirmation for any of them (spec §2).
 */
export function SwapActions({ swap, project, onChange, onError }: SwapActionsProps) {
  const s = useStyles();
  const { t } = useI18n();
  const p = t.pick;
  const { request } = useSession();
  const { show } = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  // State updates aren't synchronous: a double tap must not send twice.
  const sending = useRef(false);

  const me = project.viewerMemberId;
  const incoming = swap.targetMemberId === me;
  const otherId = incoming ? swap.requesterMemberId : swap.targetMemberId;
  const name = project.members.find((m) => m.id === otherId)?.name ?? '';
  // Both asked each other: I can still take back my own request from here.
  const mine = incoming
    ? (pendingSwaps(project).find((x) => x.requesterMemberId === me && x.targetMemberId === otherId) ?? null)
    : swap;

  const act = async (action: Action) => {
    const target = action === 'cancel' ? mine : swap;
    if (sending.current || !target) return;
    sending.current = true;
    setBusy(action);
    try {
      const view = await request<ProjectView>(`/swaps/${encodeURIComponent(target.id)}/${action}`, { method: 'POST' });
      onChange(view);
      if (action === 'accept') {
        // Mine is now the requester's old package; its number from the fresh view.
        const got = view.packages.find((x) => x.ownerMemberId === view.viewerMemberId);
        const asked = project.packages.find((x) => x.id === swap.requesterPackageId);
        show(p.toast.accepted(got?.index ?? asked?.index ?? 0));
      } else show(action === 'decline' ? p.toast.declined : p.toast.cancelled);
    } catch (err) {
      if (onError) onError(err);
      else show(t.errors[errorCode(err)]);
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const cancelLink = (
    <View style={s.center}>
      <Pressable
        onPress={() => void act('cancel')}
        disabled={busy !== null}
        role="button"
        aria-disabled={busy !== null}
        aria-busy={busy === 'cancel'}
        hitSlop={8}
        style={({ pressed }) => [s.link, { opacity: busy !== null && busy !== 'cancel' ? 0.45 : pressed ? 0.6 : 1 }]}>
        <Txt v="label" size={13} color="grapeText">
          {p.swap.cancel}
        </Txt>
      </Pressable>
    </View>
  );

  if (incoming) {
    return (
      <>
        <Txt v="text" weight={700} style={s.ask}>
          {p.swap.incoming(name)}
        </Txt>
        <View style={s.buttons}>
          <Button
            title={p.swap.decline}
            kind="soft"
            block
            style={{ flex: 1 }}
            disabled={busy !== null && busy !== 'decline'}
            loading={busy === 'decline'}
            onPress={() => void act('decline')}
          />
          <Button
            title={p.swap.accept}
            block
            style={{ flex: 1 }}
            disabled={busy !== null && busy !== 'accept'}
            loading={busy === 'accept'}
            onPress={() => void act('accept')}
          />
        </View>
        {mine && cancelLink}
      </>
    );
  }

  return (
    <>
      <View style={s.pending}>
        {/* The emoji sits in its own hidden Txt: a nested one would still be read. */}
        <Txt v="text" weight={700} color="warn" aria-hidden>
          {p.swap.waiting.emoji}
        </Txt>
        <Txt v="text" weight={700} color="warn" center style={{ flexShrink: 1 }}>
          {p.swap.waiting.text(name)}
        </Txt>
      </View>
      {cancelLink}
      <Txt v="meta" center>
        {p.swap.hint}
      </Txt>
    </>
  );
}
