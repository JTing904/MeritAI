import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { projectTag } from '@shared/format';
import type { ProjectView } from '@shared/types';
import { AvatarStack } from '@/components/Avatar';
import { Button, LinkButton } from '@/components/Button';
import { Card, List } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Seg } from '@/components/Controls';
import { DevNote } from '@/components/DevNote';
import { Icon } from '@/components/Icon';
import { AppBar, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { activeMembers, peopleLabel } from '@/features/members/format';
import { InviteCodeBox } from '@/features/members/InvitePanel';
import { LoadState } from '@/features/members/LoadState';
import { ProjectInfoSheet } from '@/features/members/ProjectInfoSheet';
import { useProject } from '@/features/project/useProject';
import { useDates, zoneName } from '@/features/wizard/dates';
import { Field, Hint, Input } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  grow: { flex: 1, minWidth: 0, gap: 1 },
  emoji: { fontSize: 20, lineHeight: 26 },
  // Mockup-only controls that later milestones build: visible but not usable yet.
  inert: { opacity: 0.55, pointerEvents: 'none' },
});

/** How many avatars the 成员 row shows (the rest are on the members screen). */
const STACK_MAX = 4;

/** 项目设置 (SettingsLeader mockup). Members see the same page read-only, without the leader-only cards. */
export default function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { project, error, reload, setProject, onError } = useProject(id);
  const tag = project ? projectTag(project.basics.name, project.basics.shortCode) : '';
  const leader = project?.viewerRole === 'LEADER';

  return (
    <Screen header={<AppBar title={t.members.settings.title} sub={project ? t.members.settings.sub(tag, leader) : undefined} />}>
      {project ? (
        <Settings project={project} setProject={setProject} onError={onError} />
      ) : (
        <LoadState error={error} onRetry={reload} />
      )}
    </Screen>
  );
}

function Settings({
  project,
  setProject,
  onError,
}: {
  project: ProjectView;
  setProject: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const s = t.members.settings;
  const { c } = useTheme();
  const { request } = useSession();
  const { show } = useToast();
  const dates = useDates(project.basics.timezone);
  const [editing, setEditing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // A second tap before the first answer must not make two codes.
  const busy = useRef(false);
  const leader = project.viewerRole === 'LEADER';
  const id = project.basics.id;

  const tz = project.basics.timezone;
  const city = tz === 'UTC' ? 'UTC' : zoneName(tz, t.wizard.zones);
  const summary = s.infoSummary(project.basics.name, dates.long(project.basics.deadline), t.members.zoneLabel(city));
  const people = peopleLabel(project, t);
  const stack = activeMembers(project)
    .slice(0, STACK_MAX)
    .map((m) => ({ name: m.name, hl: m.color }));

  const regenerate = async () => {
    if (busy.current) return;
    busy.current = true;
    setRegenerating(true);
    try {
      const { inviteCode } = await request<{ inviteCode: string }>(`/projects/${encodeURIComponent(id)}/invite-code/reset`, {
        method: 'POST',
      });
      setProject({ ...project, inviteCode });
      show(s.regenerated);
    } catch (err) {
      onError(err);
    } finally {
      busy.current = false;
      setRegenerating(false);
    }
  };

  return (
    <>
      <List>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Txt v="text">{s.info}</Txt>
            <Txt v="meta" size={12}>
              {summary}
            </Txt>
          </View>
          {leader ? (
            <Button title={s.edit} kind="soft" small accessibilityLabel={s.editLabel} onPress={() => setEditing(true)} />
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/project/[id]/members', params: { id } })}
          role="button"
          aria-label={`${s.members}: ${people}`}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.pressed }]}>
          <View style={styles.grow}>
            <Txt v="text">{s.members}</Txt>
            <Txt v="meta" size={12}>
              {leader ? s.membersSubLeader(people) : people}
            </Txt>
          </View>
          <View aria-hidden importantForAccessibility="no-hide-descendants">
            <AvatarStack people={stack} />
          </View>
          <Icon name="chevron" size={18} color={c.muted} />
        </Pressable>
      </List>

      <Card style={{ gap: 10 }}>
        <Txt v="body" weight={700}>
          {s.inviteTitle}
        </Txt>
        {project.inviteCode ? <InviteCodeBox code={project.inviteCode} /> : null}
        {leader ? (
          <>
            <View style={{ alignSelf: 'flex-start', opacity: regenerating ? 0.5 : 1 }}>
              <LinkButton title={s.regenerate} onPress={regenerate} />
            </View>
            <Hint>{s.regenerateHint}</Hint>
          </>
        ) : null}
      </Card>

      {leader ? <LeaderOnly /> : null}

      {editing && leader ? (
        <ProjectInfoSheet project={project} onClose={() => setEditing(false)} onSaved={setProject} onError={onError} />
      ) : null}
    </>
  );
}

/** AI key, integrations and 结束项目 exactly as the mockup, disabled until their milestones. */
function LeaderOnly() {
  const { t } = useI18n();
  const s = t.members.settings;
  return (
    <>
      <Card style={{ gap: 10 }}>
        <Txt v="body" weight={700}>
          {s.ai}
        </Txt>
        <View style={styles.inert}>
          <Seg
            label={s.aiProviders}
            value="gemini"
            onChange={() => {}}
            disabled
            options={[
              { value: 'gemini', label: 'Gemini' },
              { value: 'claude', label: 'Claude' },
              { value: 'openai', label: 'OpenAI' },
            ]}
          />
        </View>
        <Field label={s.aiKey('Gemini')} small={s.aiKeySmall}>
          <View style={styles.inert}>
            <Input label={s.aiKey('Gemini')} placeholder={s.aiKeyPlaceholder} editable={false} aria-disabled />
          </View>
        </Field>
        <Hint>{s.aiHint}</Hint>
      </Card>
      <DevNote milestone="M6" />

      <List>
        <View style={styles.row}>
          <Txt style={styles.emoji} aria-hidden>
            🐙
          </Txt>
          <View style={styles.grow}>
            <Txt v="text">{s.github}</Txt>
            <Txt v="meta" size={12}>
              {s.githubSub}
            </Txt>
          </View>
          <Chip>{s.notConnected}</Chip>
        </View>
        <View style={styles.row}>
          <Txt style={styles.emoji} aria-hidden>
            💬
          </Txt>
          <View style={styles.grow}>
            <Txt v="text">{s.discord}</Txt>
            <Txt v="meta" size={12}>
              {s.discordSub}
            </Txt>
          </View>
          <Button title={s.connect} kind="soft" small disabled accessibilityLabel={s.connectLabel(s.discord)} />
        </View>
        <View style={styles.row}>
          <Txt style={styles.emoji} aria-hidden>
            ✈️
          </Txt>
          <View style={styles.grow}>
            <Txt v="text">{s.telegram}</Txt>
          </View>
          <Button title={s.connect} kind="soft" small disabled accessibilityLabel={s.connectLabel(s.telegram)} />
        </View>
      </List>
      <DevNote milestone="M8" />
      <DevNote milestone="M9" />

      <Card style={{ gap: 10 }}>
        <Txt v="body" weight={700}>
          {s.end}
        </Txt>
        <Hint>{s.endHint}</Hint>
        <Button title={s.endButton} kind="danger" block disabled />
      </Card>
      <DevNote milestone="M5" />
    </>
  );
}
