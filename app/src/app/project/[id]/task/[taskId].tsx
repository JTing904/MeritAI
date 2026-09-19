import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { AttemptView, DevTaskStatusInput, ProjectView, TaskDetail } from '@shared/types';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { AppBar, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Txt } from '@/components/Txt';
import { GradeSheet } from '@/features/grading/GradeSheet';
import { OverrideSheet } from '@/features/grading/OverrideSheet';
import { Confetti } from '@/features/pick/Confetti';
import { useProject } from '@/features/project/useProject';
import { AttemptResult } from '@/features/task/AttemptResult';
import { Attempts } from '@/features/task/Attempts';
import { BriefExcerpt } from '@/features/task/BriefExcerpt';
import { Checklist } from '@/features/task/Checklist';
import { ChecklistEditSheet } from '@/features/task/ChecklistEditSheet';
import { EvidenceSection } from '@/features/task/EvidenceSection';
import { MeetingCard } from '@/features/task/MeetingCard';
import { historyAttempts, isFullGrade, showsEvidenceEditor, type RunWrite, type TaskCtx } from '@/features/task/model';
import { PrereqCard } from '@/features/task/PrereqCard';
import { PrereqSheet } from '@/features/task/PrereqSheet';
import { TaskEditActiveSheet } from '@/features/task/TaskEditActiveSheet';
import { TaskHead } from '@/features/task/TaskHead';
import { useTaskDetail } from '@/features/task/useTaskDetail';
import { useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme';

const styles = StyleSheet.create({
  root: { flex: 1 },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

const DEV_STATUSES: DevTaskStatusInput['status'][] = ['TODO', 'DOING', 'DONE', 'HALF'];

type OpenSheet =
  | { kind: 'edit' | 'prereq' | 'checklist' }
  | { kind: 'grade'; mode: 'pending' | 'outside' }
  | { kind: 'override'; attemptId: string };

/**
 * 任务详情 (M4, boards 1–9): head → 作业要求（原文）→ 前置任务 → 清单 → 开始做 → 交证据 → 评级结果.
 * What shows depends on who is looking (the owner, the leader, anyone else) and where the task is.
 * `?grade=1` (去评级, the review queue) opens the grading sheet once, only while an attempt waits for review.
 */
export default function TaskScreen() {
  const { id, taskId, grade } = useLocalSearchParams<{ id: string; taskId: string; grade?: string }>();
  const { t } = useI18n();
  const { c } = useTheme();
  const k = t.task;
  const { request } = useSession();
  const { show } = useToast();
  const { project, error: projectError, reload: reloadProject, setProject } = useProject(id);
  const { detail, error: detailError, reload, setDetail, onError } = useTaskDetail(id, taskId);
  const [busy, setBusyState] = useState<string | null>(null);
  // The same, synchronously: a second tap in the same frame must not start a second write.
  const busyRef = useRef<string | null>(null);
  const claim = useCallback((key: string) => {
    if (busyRef.current !== null) return false;
    busyRef.current = key;
    setBusyState(key);
    return true;
  }, []);
  const release = useCallback(() => {
    busyRef.current = null;
    setBusyState(null);
  }, []);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [resubmitting, setResubmitting] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const base = `/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`;

  const run = useCallback<RunWrite>(
    async (key, path, init, opts) => {
      if (!claim(key)) return false;
      try {
        const next = await request<TaskDetail>(path, init);
        setDetail(next);
        // The project's chips and package rows follow the task: refresh them quietly.
        void reloadProject();
        opts?.done?.(next);
        return true;
      } catch (err) {
        if (!opts?.fail?.(err)) onError(err);
        return false;
      } finally {
        release();
      }
    },
    [request, setDetail, reloadProject, onError, claim, release],
  );

  // Confetti when my task becomes DONE with 优秀 / 合格 while I'm looking (a load or a write); meetings
  // fire it themselves on 我开完了.
  const previous = useRef<TaskDetail | null>(null);
  useEffect(() => {
    if (!detail) return;
    const before = previous.current;
    previous.current = detail;
    if (!before || before.task.id !== detail.task.id) return;
    const mine = detail.owner !== null && detail.owner.memberId === detail.project.viewerMemberId;
    const good = detail.task.grade === 'EXCELLENT' || detail.task.grade === 'PASS';
    if (mine && good && before.task.status !== 'DONE' && detail.task.status === 'DONE') setBurst((n) => n + 1);
  }, [detail]);

  // ?grade=1: open the grading sheet once, and only while there is something to grade.
  useEffect(() => {
    if (!grade || !detail) return;
    router.setParams({ grade: undefined });
    if (detail.current?.status === 'PENDING' && detail.project.viewerRole === 'LEADER') setSheet({ kind: 'grade', mode: 'pending' });
  }, [grade, detail]);

  const ctx = useMemo<TaskCtx | null>(() => {
    if (!project || !detail) return null;
    const viewerId = detail.project.viewerMemberId;
    const names = new Map<string, string>();
    for (const m of project.members) names.set(m.id, m.name);
    for (const m of detail.members) names.set(m.memberId, m.name);
    return {
      project,
      detail,
      task: detail.task,
      viewerId,
      leader: detail.project.viewerRole === 'LEADER',
      mine: detail.owner !== null && detail.owner.memberId === viewerId,
      running: project.basics.status === 'ACTIVE',
      busy,
      run,
      nameOf: (memberId) => (memberId ? (names.get(memberId) ?? null) : null),
      base,
      toast: show,
      onError,
    };
  }, [project, detail, busy, run, base, show, onError]);

  const history = useMemo(() => {
    if (!ctx) return [];
    const editing = showsEvidenceEditor(ctx, resubmitting) && ctx.detail.current?.status === 'DRAFT';
    return historyAttempts(ctx.detail, editing);
  }, [ctx, resubmitting]);
  const latestId = history.at(-1)?.id ?? null;
  // A new attempt appeared (handed in, graded): show the latest again.
  useEffect(() => setShownId(null), [latestId]);

  const start = async () => {
    if (!claim('start')) return;
    try {
      setProject(await request<ProjectView>(`${base}/start`, { method: 'POST' }));
      show(k.start.done);
      await reload();
    } catch (err) {
      onError(err);
    } finally {
      release();
    }
  };

  const devStatus = async (status: DevTaskStatusInput['status']) => {
    if (!claim(`dev-${status}`)) return;
    try {
      const body: DevTaskStatusInput = { status };
      await request<null>(`/dev/tasks/${encodeURIComponent(taskId)}/status`, { method: 'POST', body });
      await Promise.all([reload(), reloadProject()]);
    } catch (err) {
      onError(err);
    } finally {
      release();
    }
  };

  const onSheetChange = (next: TaskDetail) => {
    setDetail(next);
    void reloadProject();
  };

  let content;
  // Either request failing leaves nothing to show: say why (never an endless spinner) and offer 再试一次.
  const error = (detail ? null : detailError) ?? (project ? null : projectError);
  if (error) {
    content = (
      <Card style={{ gap: 12 }}>
        <Txt v="text" color="bad">
          {t.errors[error]}
        </Txt>
        <Button title={t.common.retry} kind="soft" onPress={() => void Promise.all([reload(), reloadProject()])} />
      </Card>
    );
  } else if (!ctx) {
    content = <ActivityIndicator color={c.grape} style={{ paddingVertical: 24 }} />;
  } else {
    const { task, detail: d, mine, leader, running } = ctx;
    const viewerId = ctx.viewerId;
    const pending = d.current?.status === 'PENDING';
    const editor = showsEvidenceEditor(ctx, resubmitting);
    const secondRound = d.attempts.some((a) => a.status === 'GRADED');
    const shown: AttemptView | null = history.find((a) => a.id === shownId) ?? history.at(-1) ?? null;
    const canStart =
      mine &&
      running &&
      task.kind !== 'MEETING' &&
      (task.startedAt === null ? task.status === 'TODO' : task.status === 'DOING' && task.startedByMemberId !== viewerId);
    const meeting = mine && running && task.kind === 'MEETING' && task.status !== 'DONE' && !pending;
    const canRedo =
      mine &&
      running &&
      task.kind !== 'MEETING' &&
      task.grade !== null &&
      !isFullGrade(task.grade) &&
      d.current === null &&
      !resubmitting;
    const outside = leader && !mine && running && !pending && task.status !== 'DONE' && task.kind !== 'MEETING' && d.owner !== null;
    const evidence = editor ? <EvidenceSection ctx={ctx} onSubmitted={() => setResubmitting(false)} /> : null;

    content = (
      <>
        <TaskHead ctx={ctx} onEdit={() => setSheet({ kind: 'edit' })} />
        <BriefExcerpt ctx={ctx} />
        <PrereqCard ctx={ctx} onChange={() => setSheet({ kind: 'prereq' })} />
        <Checklist ctx={ctx} setDetail={setDetail} onEdit={() => setSheet({ kind: 'checklist' })} />
        {canStart ? (
          <View style={{ gap: 6 }}>
            <Button
              title={k.start.button}
              block
              icon={<Icon name="play" size={18} color={c.onGrape} />}
              loading={busy === 'start'}
              disabled={busy !== null && busy !== 'start'}
              onPress={start}
            />
            <Txt v="meta" center>
              {k.start.hint}
            </Txt>
          </View>
        ) : null}
        {/* First round: 交证据 comes before the result. A resubmission opens under the result it answers. */}
        {secondRound ? null : evidence}
        {meeting ? <MeetingCard ctx={ctx} onDone={() => setBurst((n) => n + 1)} /> : null}
        {shown ? <Attempts ctx={ctx} attempts={history} shown={shown} onShow={setShownId} /> : null}
        {shown ? (
          <AttemptResult
            ctx={ctx}
            shown={shown}
            canRedo={canRedo && shown.status === 'GRADED'}
            onRedo={() => setResubmitting(true)}
            onGrade={() => setSheet({ kind: 'grade', mode: 'pending' })}
            onOverride={(a) => setSheet({ kind: 'override', attemptId: a.id })}
          />
        ) : null}
        {secondRound ? evidence : null}
        {outside ? (
          <Button
            title={t.task.result.outside}
            kind="soft"
            small
            disabled={busy !== null}
            onPress={() => setSheet({ kind: 'grade', mode: 'outside' })}
          />
        ) : null}

        {__DEV__ && running && task.ownerMemberId && task.packageId ? (
          <Card style={{ gap: 10 }}>
            <Txt v="text" weight={700}>
              {k.dev.title}
            </Txt>
            <Txt v="meta">{k.dev.hint}</Txt>
            <View style={styles.devRow}>
              {DEV_STATUSES.map((st) => (
                <Button
                  key={st}
                  title={t.labels.status[st]}
                  kind="soft"
                  small
                  loading={busy === `dev-${st}`}
                  disabled={busy !== null && busy !== `dev-${st}`}
                  onPress={() => devStatus(st)}
                />
              ))}
            </View>
          </Card>
        ) : null}
      </>
    );
  }

  const override = ctx && sheet?.kind === 'override' ? (ctx.detail.attempts.find((a) => a.id === sheet.attemptId) ?? null) : null;
  const tag = detail?.project.tag ?? '';

  return (
    <View style={styles.root}>
      <Screen header={<AppBar title={k.title} sub={detail ? k.sub(tag, detail.packageIndex) : undefined} />}>{content}</Screen>
      {ctx && sheet?.kind === 'edit' ? (
        <TaskEditActiveSheet
          ctx={ctx}
          onClose={() => setSheet(null)}
          onSaved={(p) => {
            setProject(p);
            void reload();
          }}
        />
      ) : null}
      {ctx && sheet?.kind === 'prereq' ? <PrereqSheet ctx={ctx} onClose={() => setSheet(null)} /> : null}
      {ctx && sheet?.kind === 'checklist' ? <ChecklistEditSheet ctx={ctx} onClose={() => setSheet(null)} /> : null}
      {ctx && sheet?.kind === 'grade' ? (
        <GradeSheet
          project={ctx.project}
          detail={ctx.detail}
          mode={sheet.mode}
          onClose={() => setSheet(null)}
          onChange={onSheetChange}
          onError={onError}
        />
      ) : null}
      {ctx && override ? (
        <OverrideSheet
          project={ctx.project}
          detail={ctx.detail}
          attempt={override}
          onClose={() => setSheet(null)}
          onChange={onSheetChange}
          onError={onError}
        />
      ) : null}
      <Confetti burst={burst} />
    </View>
  );
}
