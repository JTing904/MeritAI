import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { formatTotal } from '@shared/planning';
import type { InviteOutcome, ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card, List } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { useI18n } from '@/i18n';
import { errorCode, type ClientErrorCode } from '@/lib/api';
import { packageSpread } from '@/lib/packages';
import { useIdempotencyKey } from '@/lib/idempotency';
import { useSession } from '@/lib/session';
import { makeStyles, useTheme } from '@/theme';
import { Field, Hint, Input } from './Field';
import { pickHref, projectHref } from './nav';
import { leaveWizard, SubLine, WizardScreen, WizardTitle } from './WizardScreen';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    split: { flexDirection: 'row', height: 18, borderRadius: 9, overflow: 'hidden', gap: 3 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
    n: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    grow: { flex: 1, minWidth: 0, gap: 3 },
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

/** Invite link for now; M2 opens the app's join screen with the code filled in. */
export const inviteLink = (code: string) => `meritai://join/${code}`;

/** Step 6 (Packages mockup): the packages in the waiting grey, the invite code and email/GitHub invites. */
export function DoneStep({ id }: { id: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const { t } = useI18n();
  const w = t.wizard.done;
  const { request } = useSession();
  const idem = useIdempotencyKey();
  const { show } = useToast();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState<ClientErrorCode | null>(null);
  const [targets, setTargets] = useState('');
  const [inviting, setInviting] = useState(false);
  // State updates aren't synchronous: the keyboard's send key right after 邀请 must not post twice.
  const sending = useRef(false);
  const [outcomes, setOutcomes] = useState<InviteOutcome[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProject(await request<ProjectView>(`/projects/${id}`));
    } catch (err) {
      setError(errorCode(err));
    }
  }, [id, request]);
  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (code: string) => {
    try {
      await Clipboard.setStringAsync(inviteLink(code));
      show(w.copied);
    } catch {
      show(t.errors.INTERNAL);
    }
  };

  const invite = async () => {
    if (sending.current || !targets.trim()) return;
    sending.current = true;
    setInviting(true);
    try {
      const res = await request<InviteOutcome[]>(`/projects/${id}/invites`, {
        method: 'POST',
        body: { targets },
        idempotencyKey: idem.keyFor(targets),
      });
      idem.done();
      setOutcomes(res);
      const sent = res.filter((o) => o.result === 'INVITED').length;
      if (sent) show(w.invited(sent));
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

  if (!project) {
    return (
      <WizardScreen step={6} onClose={leaveWizard}>
        {error ? (
          <Card style={{ gap: 10 }}>
            <Txt v="small" color="ink2">
              {t.errors[error]}
            </Txt>
            <Button title={t.common.retry} kind="soft" block onPress={load} />
          </Card>
        ) : (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}>
            <ActivityIndicator color={c.grape} />
          </View>
        )}
      </WizardScreen>
    );
  }

  const packages = [...project.packages].sort((a, b) => a.index - b.index);
  const member = (memberId: string | null) => project.members.find((m) => m.id === memberId) ?? null;
  // The real gap between packages (REQUIREMENTS §13): within 2 points and none empty counts as even.
  const spread = packageSpread(packages);
  const sub =
    spread.kind === 'equal'
      ? w.subEqual(formatTotal(spread.max))
      : spread.kind === 'even'
        ? w.subAbout(formatTotal(spread.average))
        : w.subUneven(formatTotal(spread.max), formatTotal(spread.min));
  const manages = project.basics.leaderManages;

  return (
    <WizardScreen
      step={6}
      onClose={leaveWizard}
      footer={
        <Button
          title={manages ? w.goProject : w.goPick}
          block
          onPress={() => router.replace(manages ? projectHref(id) : pickHref(id))}
        />
      }>
      <WizardTitle parts={[w.titlePre, { hl: 'mint', text: w.titleHl(packages.length) }]} />
      <SubLine>{sub}</SubLine>

      <View style={s.split} aria-hidden>
        {packages.map((p) => {
          const owner = member(p.ownerMemberId);
          return (
            <View key={p.id} style={{ flex: Math.max(p.points, 1), backgroundColor: owner ? c.hl[owner.color].base : c.waiting }} />
          );
        })}
      </View>

      <List>
        {packages.map((p) => {
          const owner = member(p.ownerMemberId);
          return (
            <View key={p.id} style={s.row}>
              <View style={[s.n, { backgroundColor: owner ? c.hl[owner.color].base : c.waiting }]}>
                {/* Dark ink on the dark-mode waiting grey is unreadable; the app's ink works on both greys. */}
                <Txt v="num" size={19} color={owner ? 'onHl' : 'ink'}>
                  {p.index}
                </Txt>
              </View>
              <View style={s.grow}>
                <Txt v="rowTitle">{w.pkgTitle(p.index, p.title)}</Txt>
                <Txt v="meta">{owner ? w.pkgOwned(formatTotal(p.points), owner.name) : w.pkgFree(formatTotal(p.points))}</Txt>
              </View>
            </View>
          );
        })}
      </List>

      <Card style={{ gap: 12 }}>
        <Txt v="body" weight={700}>
          {w.inviteTitle}
        </Txt>
        {project.inviteCode ? (
          <View style={s.codeBox}>
            <Txt v="code" selectable aria-label={w.code(project.inviteCode)} style={{ flexShrink: 1 }}>
              {project.inviteCode}
            </Txt>
            <Button
              title={w.copyLink}
              kind="soft"
              small
              icon={<Icon name="copy" size={16} color={c.ink} />}
              onPress={() => copy(project.inviteCode!)}
            />
          </View>
        ) : null}
        <Field label={w.inviteField}>
          <View style={s.inviteRow}>
            <View style={{ flex: 1 }}>
              <Input
                label={w.inviteField}
                value={targets}
                onChangeText={setTargets}
                placeholder={w.invitePlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onSubmitEditing={invite}
                returnKeyType="send"
              />
            </View>
            <Button title={w.invite} small loading={inviting} disabled={!targets.trim()} onPress={invite} />
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
                  {w.result[o.result]}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
        <Hint>{w.inviteHint}</Hint>
      </Card>
    </WizardScreen>
  );
}
