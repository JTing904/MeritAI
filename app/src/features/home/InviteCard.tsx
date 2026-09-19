import { StyleSheet, View } from 'react-native';
import type { PendingInvite } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { makeStyles } from '@/theme';
import { projectMeta } from './ProjectCard';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    card: { backgroundColor: c.invite, flexDirection: 'row', alignItems: 'center', gap: 12 },
    body: { flex: 1, minWidth: 0, gap: 2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  }),
);

/** Someone invited me by email or GitHub username (prototype home `.invite`, lilac-tinted). */
export function InviteCard({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: PendingInvite;
  /** Which answer is being sent, if any. */
  busy: 'accept' | 'decline' | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const meta = projectMeta({ ...invite, groupLabel: null }, null, t.home.card);
  return (
    <Card style={s.card}>
      <Txt v="body" size={30} style={{ lineHeight: 38 }} aria-hidden>
        🎉
      </Txt>
      <View style={s.body}>
        <Txt v="text" style={{ lineHeight: 20 }}>
          {t.home.invite.line(invite.inviterName, invite.projectName).map((part, i) =>
            typeof part === 'string' ? (
              part
            ) : (
              <Txt key={i} v="text" weight={700}>
                {part.b}
              </Txt>
            ),
          )}
        </Txt>
        <Txt v="meta">{meta}</Txt>
        <View style={s.actions}>
          <Button
            title={t.home.invite.decline}
            kind="soft"
            small
            disabled={busy === 'accept'}
            loading={busy === 'decline'}
            onPress={onDecline}
          />
          <Button
            title={t.home.invite.accept}
            small
            disabled={busy === 'decline'}
            loading={busy === 'accept'}
            onPress={onAccept}
          />
        </View>
      </View>
    </Card>
  );
}
