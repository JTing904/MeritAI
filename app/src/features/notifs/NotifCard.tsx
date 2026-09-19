import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import type { InlinePart } from '@/i18n/sections/home.zh';
import { makeStyles, useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import type { NotifAction, NotifLook } from './describe';

// Prototype `.notif`: 40px emoji tile, 12px gap, 14px padding; the actions line up with the text.
const TILE = 40;
const PAD = 14;
const GAP = 12;

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: radius.card, boxShadow: c.shadow, overflow: 'hidden' },
    pressed: { backgroundColor: c.pressed },
    main: { flexDirection: 'row', alignItems: 'flex-start', gap: GAP, padding: PAD },
    tile: { width: TILE, height: TILE, borderRadius: radius.kind, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, paddingRight: 14 },
    dot: { position: 'absolute', top: 20, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: c.grape },
    acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: PAD + TILE + GAP, paddingRight: PAD, paddingBottom: PAD },
  }),
);

function Inline({ parts }: { parts: InlinePart[] }) {
  return (
    <Txt v="text">
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <Txt key={i} v="text" weight={700}>
            {part.b}
          </Txt>
        ),
      )}
    </Txt>
  );
}

/**
 * One notification (prototype `.notif`): tinted emoji tile, text with names in bold, meta line, grape dot
 * when unread, buttons. Tapping the text opens the project (M4: the task); the buttons sit outside that pressable.
 */
export function NotifCard({
  look,
  meta,
  unread,
  busy,
  onOpen,
  onAction,
}: {
  look: NotifLook;
  meta: string;
  unread: boolean;
  /** The action being sent, if any (its button spins, the others wait). */
  busy: NotifAction | null;
  onOpen: (() => void) | null;
  onAction: (action: NotifAction) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const [pressed, setPressed] = useState(false);
  const copy = t.notifs.actions;

  const content = (
    <>
      <View style={[s.tile, { backgroundColor: c.hl[look.tint].notif }]} aria-hidden>
        <Txt v="body" size={20} style={{ lineHeight: 26 }}>
          {look.emoji}
        </Txt>
      </View>
      <View style={s.body}>
        <Inline parts={look.parts} />
        <Txt v="meta" size={11.5} style={{ marginTop: 4 }}>
          {meta}
        </Txt>
      </View>
      {unread && <View style={s.dot} role="img" aria-label={t.notifs.unread} />}
    </>
  );

  const hasActions = look.actions.length > 0;
  const mainStyle = [s.main, hasActions && { paddingBottom: 10 }];

  return (
    <View style={s.card}>
      {/* collapsable={false}: its background appears on press (see TabBar). */}
      <View collapsable={false} style={pressed ? s.pressed : undefined}>
        {onOpen ? (
          <Pressable
            onPress={onOpen}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            role="link"
            style={mainStyle}>
            {content}
          </Pressable>
        ) : (
          <View style={mainStyle}>{content}</View>
        )}
        {hasActions && (
          <View style={s.acts}>
            {look.actions.map((action) => (
              <Button
                key={action}
                title={copy[action]}
                kind={action === 'decline' || action === 'openTask' ? 'soft' : 'primary'}
                small
                loading={busy === action}
                disabled={busy !== null && busy !== action}
                onPress={() => onAction(action)}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
