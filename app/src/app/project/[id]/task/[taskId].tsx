import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { projectTag } from '@shared/format';
import { formatPoints } from '@shared/planning';
import type { DevTaskStatusInput, ProjectView, TaskView } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip, type ChipTone } from '@/components/Chip';
import { DevNote } from '@/components/DevNote';
import { AppBar, headingLevel, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { memberById, packageById, useLocalDates } from '@/features/project/parts';
import { useProject } from '@/features/project/useProject';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { displayStatus, type StatusKey } from '@/lib/status';
import { useTheme } from '@/theme';

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  owner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

const STATUS_TONE: Record<StatusKey, ChipTone> = {
  TODO: 'default',
  DOING: 'default',
  REVIEWING: 'grape',
  DONE: 'good',
  HALF: 'warn',
  FAIL: 'bad',
  OVERDUE: 'bad',
};

const DEV_STATUSES: DevTaskStatusInput['status'][] = ['TODO', 'DOING', 'DONE', 'HALF'];

/** 任务详情, temporary for M3 (M4 builds the real page): the task, 开始做 for its owner, and a dev status card. */
export default function TaskScreen() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const k = t.project.task;
  const { request } = useSession();
  const { show } = useToast();
  const { project, error, reload, setProject, onError } = useProject(id);
  const dates = useLocalDates();
  const [busy, setBusy] = useState<string | null>(null);

  const task = project?.tasks.find((x) => x.id === taskId) ?? null;
  const pkg = project && task ? packageById(project, task.packageId) : null;
  const tag = project ? projectTag(project.basics.name, project.basics.shortCode) : '';

  const start = async (p: ProjectView, x: TaskView) => {
    setBusy('start');
    try {
      setProject(await request<ProjectView>(`/projects/${p.basics.id}/tasks/${x.id}/start`, { method: 'POST' }));
      show(k.started);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const devStatus = async (x: TaskView, status: DevTaskStatusInput['status']) => {
    setBusy(status);
    try {
      const body: DevTaskStatusInput = { status };
      await request<null>(`/dev/tasks/${x.id}/status`, { method: 'POST', body });
      await reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  let content;
  if (error) {
    content = (
      <Card style={{ gap: 12 }}>
        <Txt v="text" color="bad">
          {t.errors[error]}
        </Txt>
        <Button title={t.common.retry} kind="soft" onPress={() => void reload()} />
      </Card>
    );
  } else if (!project) {
    content = <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />;
  } else if (!task) {
    content = (
      <Card>
        <Txt v="text" color="bad">
          {t.errors.NOT_FOUND}
        </Txt>
      </Card>
    );
  } else {
    const status = displayStatus(task);
    const owner = memberById(project, task.ownerMemberId);
    const mine = owner !== null && owner.id === project.viewerMemberId;
    const running = project.basics.status === 'ACTIVE';
    const canStart = mine && running && task.status === 'TODO' && task.startedAt === null;
    content = (
      <>
        <Card style={{ gap: 12 }}>
          <View style={styles.chips}>
            <Chip hl={project.basics.color}>
              {t.labels.kindEmoji[task.kind]} {t.labels.kind[task.kind]}
            </Chip>
            <Chip tone={STATUS_TONE[status]}>
              {t.labels.statusEmoji[status]} {t.labels.status[status]}
            </Chip>
            <Chip tone="grape">{t.labels.contribution(formatPoints(task.points))}</Chip>
            <Chip tone={task.overdue ? 'bad' : 'default'}>{k.due(dates.dateTime(task.dueAt ?? project.basics.deadline))}</Chip>
          </View>
          <Txt v="hero" size={24} role="heading" {...headingLevel(2)}>
            {task.title}
          </Txt>
          {task.description ? (
            <Txt v="text" color="ink2">
              {task.description}
            </Txt>
          ) : null}
          {owner ? (
            <View style={styles.owner}>
              <Avatar name={owner.name} hl={owner.color} size="sm" decorative />
              <Txt v="small" weight={600}>
                {mine ? k.ownerYou : k.owner(owner.name)}
              </Txt>
            </View>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Chip tone="warn">{k.noOwner}</Chip>
            </View>
          )}
          {canStart ? (
            <Button
              title={k.start}
              block
              loading={busy === 'start'}
              disabled={busy !== null && busy !== 'start'}
              onPress={() => start(project, task)}
            />
          ) : null}
        </Card>

        <DevNote milestone="M4" />

        {__DEV__ && task.ownerMemberId && task.packageId ? (
          <Card style={{ gap: 10 }}>
            <Txt v="text" weight={700}>
              {k.devTitle}
            </Txt>
            <Txt v="meta">{k.devHint}</Txt>
            <View style={styles.devRow}>
              {DEV_STATUSES.map((st) => (
                <Button
                  key={st}
                  title={t.labels.status[st]}
                  kind="soft"
                  small
                  loading={busy === st}
                  disabled={busy !== null && busy !== st}
                  onPress={() => devStatus(task, st)}
                />
              ))}
            </View>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <Screen header={<AppBar title={k.title} sub={project ? k.sub(tag, pkg?.index ?? null) : undefined} />}>{content}</Screen>
  );
}
