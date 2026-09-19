import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import type { DeletedProjectCard, PendingInvite, ProjectCard as ProjectCardData, ProjectView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card, SectionHeader } from '@/components/Card';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Logo } from '@/components/Logo';
import { Rich } from '@/components/Rich';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { dueSoonLine } from '@/features/home/dueSoon';
import { EmptyHome } from '@/features/home/EmptyHome';
import { Fab, FAB_SPACE } from '@/features/home/Fab';
import { givenName, projectTag } from '@/features/home/format';
import { InviteCard } from '@/features/home/InviteCard';
import { DeletedCard, DraftCard, ProjectCard } from '@/features/home/ProjectCard';
import { useHome } from '@/features/home/useHome';
import { draftStepHref } from '@/features/wizard/nav';
import { useI18n } from '@/i18n';
import { errorCode } from '@/lib/api';
import { useMe, useSession } from '@/lib/session';
import { useTheme } from '@/theme';

export default function HomeScreen() {
  const { t } = useI18n();
  const { c } = useTheme();
  const me = useMe();
  const { request } = useSession();
  const { show } = useToast();
  const home = useHome();
  const [answering, setAnswering] = useState<{ id: string; kind: 'accept' | 'decline' } | null>(null);
  const [deleting, setDeleting] = useState<ProjectCardData | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const data = home.data;
  const empty = data !== null && data.projects.length === 0 && data.deletedProjects.length === 0;

  const answer = async (invite: PendingInvite, kind: 'accept' | 'decline') => {
    setAnswering({ id: invite.id, kind });
    try {
      if (kind === 'accept') {
        const project = await request<ProjectView>(`/invites/${invite.id}/accept`, { method: 'POST' });
        const canPick = project.packages.some((p) => p.ownerMemberId === null);
        show(canPick ? t.join.joined(project.basics.name) : t.join.joinedNoPick(project.basics.name));
      } else {
        await request<null>(`/invites/${invite.id}/decline`, { method: 'POST' });
        show(t.home.invite.declined);
      }
      home.patch((d) => ({ ...d, invites: d.invites.filter((i) => i.id !== invite.id) }));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setAnswering(null);
      void home.reload();
    }
  };

  const deleteDraft = async () => {
    const draft = deleting;
    if (!draft) return;
    try {
      await request<null>(`/projects/${draft.id}`, { method: 'DELETE' });
      home.patch((d) => ({ ...d, projects: d.projects.filter((p) => p.id !== draft.id) }));
      show(t.home.draft.deleted);
    } catch (err) {
      show(t.errors[errorCode(err)]);
    }
    void home.reload();
  };

  const restore = async (project: DeletedProjectCard) => {
    if (restoring) return;
    setRestoring(project.id);
    try {
      await request<null>(`/projects/${encodeURIComponent(project.id)}/restore`, { method: 'POST' });
      home.patch((d) => ({ ...d, deletedProjects: d.deletedProjects.filter((p) => p.id !== project.id) }));
      show(t.home.deleted.restored(projectTag(project.name, project.shortCode)));
    } catch (err) {
      show(t.errors[errorCode(err)]);
    } finally {
      setRestoring(null);
      void home.reload();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen
        bottomInset={false}
        refreshControl={
          <RefreshControl
            refreshing={home.refreshing}
            onRefresh={home.refresh}
            tintColor={c.grape}
            colors={[c.grape]}
            progressBackgroundColor={c.card}
          />
        }>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
          <Logo />
          <Pressable onPress={() => router.navigate('/me')} role="button" aria-label={t.home.myProfile} hitSlop={6}>
            <Avatar name={me.name} hl={me.color} decorative />
          </Pressable>
        </View>

        <View style={{ gap: 2 }}>
          <Rich parts={[t.home.hello.before, { hl: 'lemon', text: givenName(me.name) }, t.home.hello.after]} />
          {data && (
            <Txt v="text" color="muted" style={{ marginTop: 4 }}>
              {empty ? t.home.subWelcome : dueSoonLine(data.dueSoon, t.home)}
            </Txt>
          )}
        </View>

        {data?.invites.map((invite) => (
          <InviteCard
            key={invite.id}
            invite={invite}
            busy={answering?.id === invite.id ? answering.kind : null}
            onAccept={() => void answer(invite, 'accept')}
            onDecline={() => void answer(invite, 'decline')}
          />
        ))}

        {data === null && !home.error && <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />}

        {data === null && home.error && (
          <Card style={{ gap: 12 }}>
            <Txt v="text" color="bad">
              {t.errors[home.error]}
            </Txt>
            <Button title={t.common.retry} kind="soft" onPress={home.retry} />
          </Card>
        )}

        {empty && <EmptyHome />}

        {data && !empty && (
          <>
            <SectionHeader title={t.home.myProjects} />
            {data.projects.map((p) =>
              p.status === 'DRAFT' ? (
                <DraftCard
                  key={p.id}
                  project={p}
                  onResume={() => router.push(draftStepHref(p.id, p.draftStep))}
                  onDelete={() => setDeleting(p)}
                />
              ) : (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => {
                    // Still has to pick and can: straight to the packages.
                    const pick = p.needsPackage && p.freePackages > 0;
                    router.push({ pathname: pick ? '/project/[id]/pick' : '/project/[id]', params: { id: p.id } });
                  }}
                />
              ),
            )}
            {data.deletedProjects.map((p) => (
              <DeletedCard key={p.id} project={p} busy={restoring === p.id} onRestore={() => void restore(p)} />
            ))}
          </>
        )}

        <View style={{ height: FAB_SPACE }} aria-hidden />
      </Screen>

      <Fab />

      <ConfirmSheet
        visible={deleting !== null}
        title={t.home.draft.deleteTitle(deleting?.name ?? '')}
        body={t.home.draft.deleteBody}
        confirmLabel={t.home.draft.delete}
        danger
        onConfirm={deleteDraft}
        onClose={() => setDeleting(null)}
      />
    </View>
  );
}
