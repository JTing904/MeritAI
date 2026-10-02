import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AI_REVIEWS_PER_TASK_DAY } from '@shared/constants';
import type { ProjectView } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip, type ChipTone } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { Hint } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { useMe } from '@/lib/session';
import { useTheme } from '@/theme';
import { useResetText } from './KeyCard';
import { maskedKey } from './models';
import { KeyRow, PrivacyLine, UseBar, WarnBox } from './parts';

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 4 },
});

const goMe = () => router.navigate('/me');

/**
 * 项目设置 → AI (ProjectAiCard mockup): the leader sees the key on their account and today's reviews; members
 * see whose key it is and the privacy line; without a key everyone sees that the free rules are used (the
 * leader gets 去「我」页填 key).
 */
export function ProjectAiCard({ project }: { project: ProjectView }) {
  const { t } = useI18n();
  const a = t.ai.project;
  const { c } = useTheme();
  const me = useMe();
  const reset = useResetText();
  const ai = project.ai;
  const leader = project.viewerRole === 'LEADER';
  const provider = ai.provider;
  const name = provider ? t.ai.provider[provider] : '';

  let chip: { text: string; tone: ChipTone };
  if (!ai.configured || !provider) chip = { text: a.chipNone, tone: 'default' };
  else if (ai.status === 'INVALID') chip = { text: a.chipInvalid, tone: 'bad' };
  else if (ai.status === 'QUOTA') chip = { text: a.chipQuota, tone: 'warn' };
  else chip = { text: leader ? a.chipOk : a.chipSet(name), tone: 'good' };

  const head = (
    <View style={styles.head}>
      <Txt v="body" size={15.5} weight={900}>
        {a.title}
      </Txt>
      <Chip tone={chip.tone}>{chip.text}</Chip>
    </View>
  );

  if (!ai.configured || !provider) {
    return (
      <Card style={{ gap: 10 }}>
        {head}
        <WarnBox>{leader ? a.noneLeader : a.none}</WarnBox>
        {leader ? <Button title={a.fillKey} kind="soft" block onPress={goMe} /> : null}
        <Hint>{a.leaderChange}</Hint>
      </Card>
    );
  }

  const problem =
    ai.status === 'INVALID' ? (leader ? a.invalidLeader : a.invalidMember) : ai.status === 'QUOTA' ? (leader ? a.quotaLeader : a.quotaMember) : null;

  if (!leader) {
    return (
      <Card style={{ gap: 10 }}>
        {head}
        <Txt v="meta" style={{ marginTop: -4 }}>
          {a.memberLine(ai.leaderName ?? project.members.find((m) => m.role === 'LEADER' && m.active)?.name ?? '', ai.reviewsToday, ai.reviewsLimit)}
        </Txt>
        {problem ? <WarnBox>{problem}</WarnBox> : null}
        <PrivacyLine>{a.privacy[provider]}</PrivacyLine>
      </Card>
    );
  }

  // The leader's own key (the project uses the current leader's): its last 4 are on the viewer's profile.
  const mine = me.ai && me.ai.provider === provider ? me.ai : null;
  return (
    <Card style={{ gap: 10 }}>
      {head}
      <KeyRow>
        <Txt v="small" size={14}>
          {a.usesYourKey(name)}
        </Txt>
        {mine ? (
          <Txt v="mono" size={12.5} color="muted">
            {maskedKey(mine.provider, mine.last4)}
          </Txt>
        ) : null}
      </KeyRow>
      {problem ? <WarnBox>{problem}</WarnBox> : null}
      <UseBar label={a.reviewedToday} count={a.count(ai.reviewsToday, ai.reviewsLimit)} ratio={ai.reviewsLimit ? ai.reviewsToday / ai.reviewsLimit : null} />
      <Hint>{a.limitHint(AI_REVIEWS_PER_TASK_DAY, reset(provider, me.ai?.usageToday?.resetsAt))}</Hint>
      <Pressable onPress={goMe} role="link" hitSlop={8} style={styles.link}>
        <Txt v="label" size={13} color="grapeText">
          {a.goMe}
        </Txt>
        <Icon name="chevron" size={14} color={c.grapeText} />
      </Pressable>
    </Card>
  );
}
