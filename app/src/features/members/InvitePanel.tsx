import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { InviteOutcome } from '@shared/types';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { inviteLink } from '@/features/wizard/DoneStep';
import { Field, Hint, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    codeBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 18,
      backgroundColor: c.card2,
    },
    inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    result: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  }),
);

/** The prototype's `.code-box`: the invite code in mono and 复制链接 (copies the join link). */
export function InviteCodeBox({ code }: { code: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const { show } = useToast();

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(inviteLink(code));
      show(t.members.invite.copied);
    } catch {
      show(t.errors.INTERNAL);
    }
  };

  return (
    <View style={s.codeBox}>
      <Txt v="code" selectable aria-label={t.members.invite.code(code)} style={{ flexShrink: 1 }}>
        {code}
      </Txt>
      <Button
        title={t.members.invite.copyLink}
        kind="soft"
        small
        icon={<Icon name="copy" size={16} color={c.ink} />}
        onPress={copy}
      />
    </View>
  );
}

/**
 * The invite box from the wizard's last step (code + emails / GitHub usernames), for anyone in an
 * active project (REQUIREMENTS §13: members can invite too).
 */
export function InvitePanel({ projectId, inviteCode }: { projectId: string; inviteCode: string | null }) {
  const s = useStyles();
  const { t } = useI18n();
  const copy = t.members.invite;
  const { request } = useSession();
  const { show } = useToast();
  const [targets, setTargets] = useState('');
  const [inviting, setInviting] = useState(false);
  // State updates aren't synchronous: the keyboard's send key right after 邀请 must not post twice.
  const sending = useRef(false);
  const [outcomes, setOutcomes] = useState<InviteOutcome[]>([]);
  const idem = useIdempotencyKey();

  const invite = async () => {
    if (sending.current || !targets.trim()) return;
    sending.current = true;
    setInviting(true);
    try {
      const res = await request<InviteOutcome[]>(`/projects/${encodeURIComponent(projectId)}/invites`, {
        method: 'POST',
        body: { targets },
        idempotencyKey: idem.keyFor(targets),
      });
      idem.done();
      setOutcomes(res);
      const sent = res.filter((o) => o.result === 'INVITED').length;
      if (sent) show(copy.invited(sent));
      // Leave only the entries that need fixing in the box.
      setTargets(
        res
          .filter((o) => o.result === 'INVALID')
          .map((o) => o.target)
          .join(', '),
      );
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      sending.current = false;
      setInviting(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {inviteCode ? <InviteCodeBox code={inviteCode} /> : null}
      <Field label={copy.field}>
        <View style={s.inviteRow}>
          <View style={{ flex: 1 }}>
            <Input
              label={copy.field}
              value={targets}
              onChangeText={setTargets}
              placeholder={copy.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onSubmitEditing={invite}
              returnKeyType="send"
            />
          </View>
          <Button title={copy.send} small loading={inviting} disabled={!targets.trim()} onPress={invite} />
        </View>
      </Field>
      {outcomes.length > 0 ? (
        <View style={{ gap: 4 }} aria-live="polite">
          {outcomes.map((o) => (
            <View key={o.target} style={s.result}>
              <Txt v="meta" color="ink2" numberOfLines={1} style={{ flexShrink: 1 }}>
                {o.target}
              </Txt>
              <Txt v="meta" weight={600} color={o.result === 'INVITED' ? 'good' : o.result === 'INVALID' ? 'bad' : 'muted'}>
                {copy.result[o.result]}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
      <Hint>{copy.hint}</Hint>
    </View>
  );
}
