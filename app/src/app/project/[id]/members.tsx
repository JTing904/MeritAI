import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { projectTag } from '@shared/format';
import { formatPoints } from '@shared/planning';
import type { MemberView, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card, List, SectionHeader } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { AppBar, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { activeMembers, dayLabel, joinedRecently, memberPackage, peopleLabel } from '@/features/members/format';
import { InviteSheet } from '@/features/members/InviteSheet';
import { LoadState } from '@/features/members/LoadState';
import { MemberActions } from '@/features/members/MemberActions';
import { useProject } from '@/features/project/useProject';
import { Hint } from '@/features/wizard/Field';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { makeStyles } from '@/theme';

const useStyles = makeStyles((c) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
    grow: { flex: 1, minWidth: 0, gap: 3 },
    name: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    more: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    morePressed: { backgroundColor: c.pressed },
  }),
);

/** 成员 (Members + MemberActions mockups): who is in, who left, invite, leave; the leader's ⋯ per member. */
export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { project, error, reload, setProject, onError } = useProject(id);
  const sub = project
    ? t.members.page.sub(projectTag(project.basics.name, project.basics.shortCode), peopleLabel(project, t))
    : undefined;

  return (
    <Screen header={<AppBar title={t.members.page.title} sub={sub} />}>
      {project ? (
        <Members project={project} setProject={setProject} onError={onError} />
      ) : (
        <LoadState error={error} onRetry={reload} />
      )}
    </Screen>
  );
}

function Members({
  project,
  setProject,
  onError,
}: {
  project: ProjectView;
  setProject: (view: ProjectView) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const p = t.members.page;
  const { request } = useSession();
  const { show } = useToast();
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leader = project.viewerRole === 'LEADER';
  const tag = projectTag(project.basics.name, project.basics.shortCode);

  const active = [...activeMembers(project)].sort((a, b) => (a.role === b.role ? 0 : a.role === 'LEADER' ? -1 : 1));
  // Most recent first.
  const leftAt = (m: MemberView) => (m.leftAt ? Date.parse(m.leftAt) : 0);
  const gone = project.members.filter((m) => !m.active).sort((a, b) => leftAt(b) - leftAt(a));

  const leave = async () => {
    try {
      await request<null>(`/projects/${encodeURIComponent(project.basics.id)}/leave`, { method: 'POST' });
      router.dismissTo('/');
      show(p.left(tag));
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <List>
        {active.map((m) => (
          <MemberRow
            key={m.id}
            project={project}
            member={m}
            onMore={leader && m.id !== project.viewerMemberId ? () => setActionsFor(m.id) : undefined}
          />
        ))}
      </List>

      {gone.length > 0 ? (
        <>
          <SectionHeader title={p.leftTitle} />
          <List>
            {gone.map((m) => (
              <LeftRow key={m.id} member={m} />
            ))}
          </List>
        </>
      ) : null}

      <Button title={p.invite} kind="soft" block onPress={() => setInviting(true)} />

      <Card style={{ gap: 10 }}>
        <Button title={p.leave} kind="danger" block disabled={leader} onPress={() => setLeaving(true)} />
        {leader ? <Hint>{p.leaderCantLeave}</Hint> : null}
      </Card>

      <InviteSheet
        visible={inviting}
        onClose={() => setInviting(false)}
        projectId={project.basics.id}
        inviteCode={project.inviteCode}
      />
      <MemberActions
        project={project}
        memberId={leader ? actionsFor : null}
        onClose={() => setActionsFor(null)}
        onChange={setProject}
        onError={onError}
      />
      <ConfirmSheet
        visible={leaving && !leader}
        title={p.leaveTitle(tag)}
        body={p.leaveBody}
        confirmLabel={p.leaveConfirm}
        danger
        onConfirm={leave}
        onClose={() => setLeaving(false)}
      />
    </>
  );
}

function MemberRow({ project, member, onMore }: { project: ProjectView; member: MemberView; onMore?: () => void }) {
  const s = useStyles();
  const { t } = useI18n();
  const p = t.members.page;
  const pkg = memberPackage(project, member);
  const isLeader = member.role === 'LEADER';
  const sub = pkg
    ? p.pkgLine(pkg.index, pkg.started)
    : isLeader && project.basics.leaderManages
      ? p.managesOnly
      : // The leader was there from the start: 「刚加入」 is for people who joined later.
        p.noPackage(!isLeader && joinedRecently(member));

  return (
    <View style={s.row}>
      <Avatar name={member.name} hl={member.color} decorative />
      <View style={s.grow}>
        <View style={s.name}>
          <Txt v="rowTitle">{member.name}</Txt>
          {isLeader ? <Chip tone="grape">{t.labels.leader}</Chip> : null}
          {member.id === project.viewerMemberId ? <Chip>{t.labels.you}</Chip> : null}
        </View>
        <Txt v="meta">{sub}</Txt>
      </View>
      {onMore ? (
        <Pressable
          onPress={onMore}
          role="button"
          aria-label={p.more(member.name)}
          hitSlop={7}
          style={({ pressed }) => [s.more, pressed && s.morePressed]}>
          <Txt v="body" size={18} color="muted" style={{ lineHeight: 22 }}>
            ⋯
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Someone who left or was removed: faded, with the points that stay theirs. */
function LeftRow({ member }: { member: MemberView }) {
  const s = useStyles();
  const { t } = useI18n();
  const p = t.members.page;
  const day = member.leftAt ? dayLabel(member.leftAt, t.labels.relative) : '';
  const pts = formatPoints(member.earnedPoints);
  return (
    <View style={[s.row, { opacity: 0.6 }]}>
      <Avatar name={member.name} hl={member.color} decorative />
      <View style={s.grow}>
        <Txt v="rowTitle">{member.name}</Txt>
        <Txt v="meta">{member.removed ? p.removedLine(day, pts) : p.leftLine(day, pts)}</Txt>
      </View>
    </View>
  );
}
