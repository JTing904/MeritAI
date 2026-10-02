// The task page's data (TaskDetail, M4 spec §7). Every task route answers with it.
import { projectTag } from "../../../shared/format";
import type { AiFailReason, AttemptView, EvidenceView, TaskDetail, TaskPerson, TaskRef } from "../../../shared/types";
import type { Attempt, Evidence, GradeChange, Member, Prisma } from "../generated/prisma/client";
import { canSee, isActiveMember } from "../lib/access";
import { toLifecycle } from "../lib/lifecycle";
import { notFound } from "../lib/errors";
import {
  countingAttempt,
  effectiveDue,
  MAX_EVIDENCE_FILE_BYTES,
  MAX_EVIDENCE_ITEMS,
  MAX_PROJECT_STORAGE_BYTES,
  UNDO_START_MS,
} from "../lib/grading";
import { isFinished } from "../lib/package-state";
import { sortLeaderFirst, toTaskView, type AttemptStat } from "./views";
import { clock } from "../lib/clock";
import { reviewsLeft } from "./ai-grade";
import { leaderUser, projectAi } from "./ai-key";

type Db = Prisma.TransactionClient;

const TASK_ORDER = [{ order: "asc" as const }, { number: "asc" as const }];
const OWNER = { include: { user: { select: { name: true } } } } as const;

type FullAttempt = Attempt & { evidence: Evidence[]; changes: GradeChange[] };

const stat = (a: FullAttempt): AttemptStat => ({ no: a.no, status: a.status, late: a.late, aiState: a.aiState, _count: { evidence: a.evidence.length } });

function toEvidenceView(e: Evidence): EvidenceView {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    url: e.url,
    sizeBytes: e.sizeBytes,
    mimeType: e.mimeType,
    addedByMemberId: e.addedById,
    createdAt: e.createdAt.toISOString(),
  };
}

function toAttemptView(a: FullAttempt, countingId: string | null): AttemptView {
  return {
    id: a.id,
    no: a.no,
    status: a.status,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    submittedByMemberId: a.submittedById,
    late: a.late,
    evidence: a.evidence.map(toEvidenceView),
    grade: a.grade,
    gradeNote: a.gradeNote,
    gradedByMemberId: a.gradedById,
    gradedAt: a.gradedAt?.toISOString() ?? null,
    selfGraded: a.selfGraded,
    outsideApp: a.outsideApp,
    outsideNote: a.outsideNote,
    meeting:
      a.meetingSummary === null
        ? null
        : { summary: a.meetingSummary, attendeeMemberIds: a.attendeeIds, absentMemberIds: a.absentIds },
    changes: a.changes.map((c) => ({
      id: c.id,
      fromGrade: c.fromGrade,
      toGrade: c.toGrade,
      reason: c.reason,
      byMemberId: c.byId,
      createdAt: c.createdAt.toISOString(),
      undoneAt: c.undoneAt?.toISOString() ?? null,
    })),
    counting: a.id === countingId,
    aiState: a.aiState,
    aiFailReason: (a.aiFailReason as AiFailReason | null) ?? null,
    gradedByAi: a.gradedByAi,
    aiProvider: a.aiProvider,
    aiModel: a.aiModel,
    aiReasons: a.aiReasons,
    aiSuggestions: a.aiSuggestions,
  };
}

const taskRef = (t: { id: string; title: string; ownerId: string | null; owner: { user: { name: string } } | null }): TaskRef => ({
  taskId: t.id,
  title: t.title,
  ownerMemberId: t.ownerId,
  ownerName: t.owner?.user.name ?? null,
});

/**
 * The task as the user `viewer.userId` sees it at `now`: 404 for an unknown task in this project, and
 * for anyone who may not see the project (canSee, checked against the members this loads anyway, A14).
 */
export async function loadTaskDetail(
  db: Db,
  projectId: string,
  taskId: string,
  viewer: Pick<Member, "userId">,
  now = clock.now(),
): Promise<TaskDetail> {
  const task = await db.task.findFirst({
    where: { id: taskId, projectId },
    // The quoted brief lines are omitted everywhere else (lib/db.ts OMIT); this page shows them.
    omit: { briefExcerpt: false },
    include: {
      project: {
        include: { members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { name: true } } } } },
      },
      package: { select: { index: true } },
      attempts: {
        orderBy: { no: "asc" },
        include: {
          evidence: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          changes: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        },
      },
      checklist: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      prereqTask: {
        include: { owner: OWNER, attempts: { select: { no: true, late: true }, orderBy: { no: "desc" }, take: 1 } },
      },
      waitingTasks: { orderBy: TASK_ORDER, include: { owner: OWNER } },
    },
  });
  if (!task) throw notFound("Task");
  const { project } = task;

  // Read here, after the write this detail may follow (a transfer changes roles).
  const me = project.members.find((m) => m.userId === viewer.userId);
  if (!me || !canSee(project, me)) throw notFound("Project");
  const leader = project.members.find((m) => m.role === "LEADER" && isActiveMember(m)) ?? null;
  const person = (m: (typeof project.members)[number]): TaskPerson => ({
    memberId: m.id,
    name: m.user.name,
    color: m.color,
    active: isActiveMember(m),
  });
  const owner = project.members.find((m) => m.id === task.ownerId) ?? null;

  const counting = countingAttempt(task.attempts);
  const countingId = counting?.id ?? null;
  const attempts = task.attempts.map((a) => toAttemptView(a, countingId));
  const current = attempts.find((a) => a.status !== "GRADED") ?? null;

  // 「这一项拆成了 N 个任务」: the other parts cut from the same brief item.
  const briefSiblings: TaskRef[] =
    task.briefSplit && task.briefFrom !== null && task.briefTo !== null
      ? (
          await db.task.findMany({
            where: { projectId, briefSplit: true, briefFrom: task.briefFrom, briefTo: task.briefTo, id: { not: task.id } },
            orderBy: TASK_ORDER,
            include: { owner: OWNER },
          })
        ).map(taskRef)
      : [];

  // Only the owner undoes their own start: within 24 h, and only while nothing was handed in.
  const startedAt = task.startedAt?.getTime() ?? null;
  const undoable =
    startedAt !== null &&
    task.ownerId === me.id &&
    task.startedById === task.ownerId &&
    task.status === "DOING" &&
    task.attempts.length === 0 &&
    now.getTime() - startedAt <= UNDO_START_MS;

  const used = await db.evidence.aggregate({
    where: { kind: "FILE", task: { projectId } },
    _sum: { sizeBytes: true },
  });

  const prereq = task.prereqTask;
  const leaderRow = await leaderUser(db, projectId);
  const ai = await projectAi(db, projectId, leaderRow, now);
  return {
    task: toTaskView(task, project, now, task.attempts.map(stat)),
    project: {
      id: project.id,
      tag: projectTag(project.name, project.shortCode),
      color: project.color,
      deadline: project.deadline.toISOString(),
      timezone: project.timezone,
      viewerMemberId: me.id,
      viewerRole: me.role,
      leaderMemberId: leader?.id ?? null,
      leaderName: leader?.user.name ?? null,
      lifecycle: toLifecycle(project, (id) => project.members.find((m) => m.id === id)?.user.name),
      ai,
    },
    howto: task.howto,
    howtoByAi: task.howtoByAi,
    checklistByAi: task.checklistByAi,
    aiReviewsLeftToday: await reviewsLeft(db, projectId, task.id, now),
    owner: owner ? person(owner) : null,
    packageIndex: task.package?.index ?? null,
    attempts,
    current,
    countingAttemptId: countingId,
    checklist: task.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done, order: c.order })),
    prereq: prereq
      ? {
          taskId: prereq.id,
          title: prereq.title,
          ownerMemberId: prereq.ownerId,
          ownerName: prereq.owner?.user.name ?? null,
          finished: isFinished(prereq),
          finishedAt: prereq.finishedAt?.toISOString() ?? null,
          dueAt: effectiveDue(prereq, project).toISOString(),
          status: prereq.status,
          late: prereq.attempts[0]?.late ?? false,
        }
      : null,
    waitedBy: task.waitingTasks.map(taskRef),
    briefSiblings,
    undoStartUntil: undoable ? new Date(startedAt + UNDO_START_MS).toISOString() : null,
    storage: {
      usedBytes: used._sum.sizeBytes ?? 0,
      capBytes: MAX_PROJECT_STORAGE_BYTES,
      maxFileBytes: MAX_EVIDENCE_FILE_BYTES,
      maxItems: MAX_EVIDENCE_ITEMS,
    },
    members: sortLeaderFirst(project.members).map(person),
    finishedAt: task.finishedAt?.toISOString() ?? null,
  };
}

/** The task as `userId` sees it now (after a write: the membership is read with the detail). */
export async function loadTaskDetailFor(db: Db, projectId: string, taskId: string, userId: string, now = clock.now()): Promise<TaskDetail> {
  return loadTaskDetail(db, projectId, taskId, { userId }, now);
}
