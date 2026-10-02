// AI review of a handed-in attempt (M6 spec §6). On submit of another member's non-meeting task, with a usable
// leader key and today's limits (3 per task, 30 per project) not reached, the attempt stays PENDING with
// aiState QUEUED and a GRADE job is enqueued; the job grades it like a leader would (the leader can still
// override or undo). Anything the AI can't do puts it in the leader's 待我审核 at once.
import { AI_REVIEWS_PER_PROJECT_DAY, AI_REVIEWS_PER_TASK_DAY } from "../../../shared/constants";
import type { AiFailReason } from "../../../shared/types";
import type { AiJob, Attempt, Project, Task } from "../generated/prisma/client";
import { isActiveMember } from "../lib/access";
import { readEvidence } from "../lib/ai/evidence";
import { newNonce } from "../lib/ai/fence";
import { gradeForScore, gradeParts, gradeSystem, GradeOutSchema } from "../lib/ai/prompts";
import { clampNumber, clampText, cleanList } from "../lib/ai/sanitize";
import type { Db } from "../lib/db";
import { callModel } from "./ai-call";
import { enqueueJob, keyProblem, keyWorked, markDiscarded, markDone, markFailed, stillRunning } from "./ai-job-store";
import type { JobHandler, RunOutcome } from "./ai-jobs";
import { keyUsable, leaderUser, reviewsToday } from "./ai-key";
import { taskUnderLock } from "./attempts";
import { afterGrade } from "./grading-service";
import { bumpPackages, notify, recordEvent } from "./notify";
import { personRef } from "./packages";
import { lockProject, TX_OPTIONS, type Tx } from "./tx";

export type AiReviewDecision =
  /** No AI: the leader grades as before (no key, a refused key, the leader's own task, a meeting). */
  | { kind: "leader" }
  | { kind: "queued" }
  /** Not sent to the AI; the leader grades it (with this reason shown). */
  | { kind: "skipped"; reason: "TASK_LIMIT" | "PROJECT_LIMIT" }
  | { kind: "failed"; reason: "LINKS_ONLY" };

/** Under the project lock, at submit: does the AI review this attempt? */
export async function decideAiReview(
  tx: Tx,
  project: Pick<Project, "id">,
  task: Pick<Task, "id" | "kind">,
  evidence: { kind: "FILE" | "LINK" }[],
  now: Date,
): Promise<AiReviewDecision> {
  if (task.kind === "MEETING") return { kind: "leader" };
  const leader = await leaderUser(tx, project.id);
  if (!leader || !keyUsable(leader, now)) return { kind: "leader" };
  if (evidence.every((e) => e.kind === "LINK")) return { kind: "failed", reason: "LINKS_ONLY" };
  const provider = leader.aiProvider!;
  if ((await reviewsToday(tx, project.id, provider, now)) >= AI_REVIEWS_PER_PROJECT_DAY) return { kind: "skipped", reason: "PROJECT_LIMIT" };
  if ((await reviewsToday(tx, project.id, provider, now, task.id)) >= AI_REVIEWS_PER_TASK_DAY) return { kind: "skipped", reason: "TASK_LIMIT" };
  return { kind: "queued" };
}

/** Enqueues the GRADE job for a just-submitted attempt (same transaction). */
export async function enqueueGrade(tx: Tx, projectId: string, taskId: string, attempt: Pick<Attempt, "id">, submittedAt: Date): Promise<void> {
  await enqueueJob(tx, {
    kind: "GRADE",
    projectId,
    taskId,
    attemptId: attempt.id,
    dedupeKey: `grade:${attempt.id}:${submittedAt.getTime()}`,
    payload: { submittedAt: submittedAt.toISOString() },
    now: submittedAt,
  });
}

/** 今天这个任务还能 AI 审核 N 次 (null: no usable key). */
export async function reviewsLeft(db: Db | Tx, projectId: string, taskId: string, now: Date): Promise<number | null> {
  const leader = await leaderUser(db, projectId);
  if (!leader || !keyUsable(leader, now)) return null;
  const provider = leader.aiProvider!;
  const project = AI_REVIEWS_PER_PROJECT_DAY - (await reviewsToday(db, projectId, provider, now));
  const task = AI_REVIEWS_PER_TASK_DAY - (await reviewsToday(db, projectId, provider, now, taskId));
  return Math.max(0, Math.min(project, task));
}

/** The leader hears AI_REVIEW_FAILED (never about their own task, never after leaving). */
export async function tellLeaderFailed(
  tx: Tx,
  projectId: string,
  task: { id: string; title: string; ownerId: string | null },
  attemptNo: number,
  reason: AiFailReason,
  now: Date,
): Promise<void> {
  const leader = await tx.member.findFirst({ where: { projectId, role: "LEADER" }, include: { user: { select: { aiProvider: true } } } });
  if (!leader || !isActiveMember(leader) || leader.id === task.ownerId) return;
  const owner = task.ownerId ? await tx.member.findUnique({ where: { id: task.ownerId }, include: { user: { select: { name: true } } } }) : null;
  await notify(tx, {
    userIds: [leader.userId],
    projectId,
    type: "AI_REVIEW_FAILED",
    audience: "ONLY_LEADER",
    payload: {
      taskId: task.id,
      title: task.title,
      attemptNo,
      submitter: owner ? personRef(owner) : null,
      reason,
      provider: leader.user.aiProvider,
    },
    now,
  });
}

type JobAttempt = { submittedAt?: string };

/** The attempt the job was made for, if it still waits for this very submission. */
async function targetAttempt(db: Db | Tx, job: AiJob) {
  if (!job.attemptId) return null;
  const attempt = await db.attempt.findUnique({
    where: { id: job.attemptId },
    include: { evidence: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  const at = (job.payload as JobAttempt | null)?.submittedAt;
  if (!attempt || attempt.status !== "PENDING" || !attempt.submittedAt || attempt.submittedAt.toISOString() !== at) return null;
  if (attempt.aiState !== "QUEUED" && attempt.aiState !== "RUNNING") return null;
  return attempt;
}

export const gradeHandler: JobHandler = {
  async run(db, job, now): Promise<RunOutcome> {
    const attempt = await targetAttempt(db, job);
    if (!attempt) {
      await markDiscarded(db, job.id, "not waiting any more", now);
      return { kind: "done" };
    }
    const task = await db.task.findUnique({
      where: { id: attempt.taskId },
      omit: { briefExcerpt: false },
      include: { project: { select: { locale: true } }, checklist: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    });
    if (!task) {
      await markDiscarded(db, job.id, "task gone", now);
      return { kind: "done" };
    }
    // 「AI 审核中」 from now on (a small write under the project lock).
    await db.$transaction(async (tx) => {
      await lockProject(tx, job.projectId);
      await tx.attempt.updateMany({ where: { id: attempt.id, status: "PENDING", aiState: "QUEUED" }, data: { aiState: "RUNNING" } });
    }, TX_OPTIONS);

    const leader = await leaderUser(db, job.projectId);
    if (!keyUsable(leader, now)) return { kind: "fail", reason: leader?.aiProvider ? "INVALID" : "NO_KEY", retry: false };
    const { pieces, readable } = await readEvidence(attempt.evidence);
    if (readable === 0) {
      return { kind: "fail", reason: pieces.every((p) => p.kind === "link") ? "LINKS_ONLY" : "UNREADABLE", retry: false };
    }

    const nonce = newNonce();
    const locale = task.project.locale;
    const res = await callModel(db, leader, {
      purpose: "grade",
      tier: "good",
      lightFallback: true,
      system: gradeSystem(locale, nonce),
      parts: gradeParts(
        {
          title: task.title,
          kind: task.kind,
          points: task.points,
          description: task.description,
          briefExcerpt: task.briefExcerpt,
          howto: task.howto,
          checklist: task.checklist.map((c) => c.text),
        },
        pieces,
        locale,
        nonce,
      ),
      schema: GradeOutSchema,
      maxOutputTokens: 4096,
    }, now);
    if (res.kind !== "ok") return res;

    const score = clampNumber(res.data.score, 0, 100, 0);
    const grade = gradeForScore(score);
    const reasons = cleanList(res.data.reasons, 4, 300);
    const suggestions = cleanList(res.data.suggestions, 4, 300);
    const summary = clampText(res.data.summary, 500) || null;
    // 拿一半 / 不通过 must say why (2–4 reasons) and how to fix it; an answer without them is asked again.
    if ((grade === "HALF" || grade === "FAIL") && (reasons.length < 2 || suggestions.length < 1)) {
      return { kind: "fail", reason: "ERROR", retry: true, detail: "a low grade without reasons" };
    }

    await db.$transaction(async (tx) => {
      await lockProject(tx, job.projectId);
      const still = await targetAttempt(tx, job);
      if (!still || !(await stillRunning(tx, job))) {
        await markDiscarded(tx, job.id, "changed", now);
        return;
      }
      const { count } = await tx.attempt.updateMany({
        where: { id: still.id, status: "PENDING" },
        data: {
          status: "GRADED",
          grade,
          gradeNote: summary,
          gradedById: null,
          gradedAt: now,
          gradedByAi: true,
          aiState: "DONE",
          aiFailReason: null,
          aiProvider: res.provider,
          aiModel: res.model,
          aiReasons: reasons,
          aiSuggestions: suggestions,
        },
      });
      if (count !== 1) {
        await markDiscarded(tx, job.id, "changed", now);
        return;
      }
      const locked = await taskUnderLock(tx, job.projectId, still.taskId);
      const { earned, counting } = await afterGrade(tx, locked, still.id, "", now);
      const owner = locked.owner;
      if (owner && isActiveMember(owner)) {
        await notify(tx, {
          userIds: [owner.userId],
          projectId: job.projectId,
          type: "GRADED",
          audience: "ONLY_YOU",
          payload: {
            taskId: locked.id,
            title: locked.title,
            attemptNo: still.no,
            grade,
            points: locked.points,
            earned,
            counting,
            byAi: true,
            reasonsCount: reasons.length,
          },
          now,
        });
      }
      await recordEvent(tx, {
        projectId: job.projectId,
        actorId: null,
        type: "GRADED",
        payload: {
          taskId: locked.id,
          title: locked.title,
          owner: owner ? personRef(owner) : null,
          grade,
          attemptNo: still.no,
          selfGraded: false,
          outsideApp: false,
          byAi: true,
        },
        now,
      });
      await bumpPackages(tx, job.projectId);
      await markDone(tx, job.id, { model: res.model, tier: res.tier, grade }, now);
      if (leader) await keyWorked(tx, leader.id, now);
    }, TX_OPTIONS);
    return { kind: "done" };
  },

  async fail(db, job, reason, now, detail) {
    const leader = await leaderUser(db, job.projectId);
    await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: job.projectId }, select: { id: true } });
      if (!project) return;
      await lockProject(tx, project.id);
      const attempt = await targetAttempt(tx, job);
      await markFailed(tx, job.id, reason, now, detail);
      if (leader && (reason === "QUOTA" || reason === "INVALID")) await keyProblem(tx, leader, reason, now, true);
      if (!attempt) return;
      // To the leader's 待我审核 at once; the member doesn't need to do anything.
      await tx.attempt.updateMany({ where: { id: attempt.id, status: "PENDING" }, data: { aiState: "FAILED", aiFailReason: reason } });
      const task = await tx.task.findUnique({ where: { id: attempt.taskId }, select: { id: true, title: true, ownerId: true } });
      if (task) await tellLeaderFailed(tx, project.id, task, attempt.no, reason, now);
    }, TX_OPTIONS);
  },
};
