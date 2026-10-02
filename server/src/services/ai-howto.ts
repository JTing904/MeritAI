// 怎么做 and the checklist (M6 spec §5): a HOWTO job (light model) for a task the leader adds to a running
// project while a key is set, and the leader's / owner's own edits (which take the 「✨ AI 写的」 tag away).
import { AI_HOWTO_MAX_STEPS, AI_HOWTO_STEP_CHARS } from "../../../shared/constants";
import { newNonce } from "../lib/ai/fence";
import { howtoSystem, HowtoOutSchema, taskParts } from "../lib/ai/prompts";
import { cleanList } from "../lib/ai/sanitize";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError, forbidden, notFound } from "../lib/errors";
import { callModel } from "./ai-call";
import { enqueueJob, keyProblem, keyWorked, markDiscarded, markDone, markFailed, stillRunning } from "./ai-job-store";
import type { JobHandler, RunOutcome } from "./ai-jobs";
import { keyUsable, leaderUser } from "./ai-key";
import { lockAsMember, lockProject, TX_OPTIONS, type Tx } from "./tx";

/** Enqueues a HOWTO job for a new task when the project's leader has a usable key (call under the project lock). */
export async function maybeEnqueueHowto(tx: Tx, projectId: string, taskId: string, now: Date): Promise<boolean> {
  if (!keyUsable(await leaderUser(tx, projectId), now)) return false;
  await enqueueJob(tx, { kind: "HOWTO", projectId, taskId, dedupeKey: `howto:${taskId}`, now });
  return true;
}

/** PUT …/tasks/:taskId/howto: the leader or the task's owner rewrites the steps (≤ 8, ≤ 200 characters each). */
export async function replaceHowto(db: Db, projectId: string, taskId: string, userId: string, steps: string[], _now = clock.now()): Promise<void> {
  const clean = steps.map((s) => s.trim()).filter(Boolean);
  if (clean.length > AI_HOWTO_MAX_STEPS || clean.some((s) => s.length > AI_HOWTO_STEP_CHARS)) {
    throw new AppError(400, "VALIDATION", `At most ${AI_HOWTO_MAX_STEPS} steps of at most ${AI_HOWTO_STEP_CHARS} characters`);
  }
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await tx.task.findFirst({ where: { id: taskId, projectId }, select: { id: true, ownerId: true } });
    if (!task) throw notFound("Task");
    if (member.role !== "LEADER" && task.ownerId !== member.id) throw forbidden("Only the leader or the task's owner can edit this");
    await tx.task.update({ where: { id: task.id }, data: { howto: clean, howtoByAi: false } });
  }, TX_OPTIONS);
}

export const howtoHandler: JobHandler = {
  async run(db, job, now): Promise<RunOutcome> {
    const task = job.taskId
      ? await db.task.findFirst({ where: { id: job.taskId, projectId: job.projectId }, omit: { briefExcerpt: false }, include: { project: { select: { locale: true, status: true } } } })
      : null;
    // Gone, or someone wrote the steps meanwhile: nothing to do.
    if (!task || task.howto.length > 0 || task.project.status === "ENDED") {
      await markDiscarded(db, job.id, "not needed", now);
      return { kind: "done" };
    }
    const leader = await leaderUser(db, job.projectId);
    if (!keyUsable(leader, now)) return { kind: "fail", reason: leader?.aiProvider ? "INVALID" : "NO_KEY", retry: false };
    const nonce = newNonce();
    const res = await callModel(db, leader, {
      purpose: "howto",
      tier: "light",
      system: howtoSystem(task.project.locale, nonce),
      parts: [
        ...taskParts({ title: task.title, kind: task.kind, points: task.points, description: task.description, briefExcerpt: task.briefExcerpt }, nonce),
        { text: task.project.locale === "zh" ? "写这个任务的怎么做和完成清单。" : "Write this task's steps and checklist." },
      ],
      schema: HowtoOutSchema,
      maxOutputTokens: 2048,
    }, now);
    if (res.kind !== "ok") return res;
    const howto = cleanList(res.data.howto, AI_HOWTO_MAX_STEPS, AI_HOWTO_STEP_CHARS);
    const checklist = cleanList(res.data.checklist, 6, 200);
    await db.$transaction(async (tx) => {
      await lockProject(tx, job.projectId);
      const fresh = await tx.task.findUnique({ where: { id: task.id }, select: { howto: true, _count: { select: { checklist: true } } } });
      if (!fresh || fresh.howto.length > 0 || !(await stillRunning(tx, job))) {
        await markDiscarded(tx, job.id, "changed", now);
        return;
      }
      const writeList = fresh._count.checklist === 0 && checklist.length > 0;
      await tx.task.update({ where: { id: task.id }, data: { howto, howtoByAi: howto.length > 0, ...(writeList ? { checklistByAi: true } : {}) } });
      if (writeList) await tx.checklistItem.createMany({ data: checklist.map((text, order) => ({ taskId: task.id, text, order })) });
      await markDone(tx, job.id, { model: res.model }, now);
      if (leader) await keyWorked(tx, leader.id, now);
    }, TX_OPTIONS);
    return { kind: "done" };
  },

  async fail(db, job, reason, now, detail) {
    const leader = await leaderUser(db, job.projectId);
    await db.$transaction(async (tx) => {
      await lockProject(tx, job.projectId).catch(() => null);
      await markFailed(tx, job.id, reason, now, detail);
      if (leader && (reason === "QUOTA" || reason === "INVALID")) await keyProblem(tx, leader, reason, now, true);
    }, TX_OPTIONS);
  },
};
