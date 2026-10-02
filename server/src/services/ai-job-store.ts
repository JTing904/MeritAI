// AiJob rows (M6 spec §3): enqueueing inside a write's transaction, finishing a job, and the key-status
// bookkeeping every job shares. The worker loop itself is services/ai-jobs.ts.
import { randomBytes } from "node:crypto";
import type { AiProviderName } from "../../../shared/constants";
import type { AiFailReason } from "../../../shared/types";
import type { AiJob, AiJobKind, Prisma } from "../generated/prisma/client";
import { usageDay, usageResetAt } from "../lib/ai/usage";
import type { Db } from "../lib/db";
import { notify } from "./notify";
import type { Tx } from "./tx";

export type EnqueueInput = {
  kind: AiJobKind;
  projectId: string;
  taskId?: string | null;
  attemptId?: string | null;
  /** Same key → enqueued once. */
  dedupeKey: string;
  payload?: Prisma.InputJsonValue;
  now: Date;
};

/** A cuid-like id (lowercase letters and digits, like Prisma's): storage keys only accept those. */
export const newRowId = (): string => `c${randomBytes(12).toString("hex")}`;

/** Adds the job unless one with the same dedupeKey exists. Call inside the write's transaction, then kickAiJobs after the commit. */
export async function enqueueJob(tx: Tx, input: EnqueueInput): Promise<void> {
  await tx.aiJob.createMany({
    data: [
      {
        kind: input.kind,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        attemptId: input.attemptId ?? null,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
        runAfter: input.now,
        createdAt: input.now,
      },
    ],
    skipDuplicates: true,
  });
}

let pending = false;

/**
 * Runs the due jobs in this process right after a commit (setImmediate, so the response goes out first).
 * AI_JOB_KICK=off (tests) leaves them to an explicit drain or the tick.
 * TODO(Vercel): a function instance may freeze once the response is sent; wrap the drain in waitUntil()
 * (@vercel/functions) there. The tick (every 10 minutes) picks up whatever was left either way.
 */
export function kickAiJobs(db: Db): void {
  if (process.env.AI_JOB_KICK?.trim().toLowerCase() === "off" || pending) return;
  pending = true;
  setImmediate(() => {
    pending = false;
    void import("./ai-jobs")
      .then((m) => m.drainAiJobs(db))
      .catch((err) => console.error("ai: drain failed", err));
  });
}

/** Re-reads the job under the caller's lock: true while it still runs (not cancelled or replaced meanwhile). */
export async function stillRunning(tx: Tx, job: Pick<AiJob, "id" | "tries">): Promise<boolean> {
  const row = await tx.aiJob.findUnique({ where: { id: job.id }, select: { status: true, tries: true } });
  return row?.status === "RUNNING" && row.tries === job.tries;
}

export async function markDone(tx: Tx, jobId: string, result: Prisma.InputJsonValue, now: Date): Promise<void> {
  await tx.aiJob.update({ where: { id: jobId }, data: { status: "DONE", result, leaseUntil: null, error: null, updatedAt: now } });
}

/** The job's state no longer matches what it was made for: it ends without effect. */
export async function markDiscarded(db: Db | Tx, jobId: string, why: string, now: Date): Promise<void> {
  await db.aiJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "DONE", result: { discarded: why }, leaseUntil: null, updatedAt: now },
  });
}

export async function markFailed(tx: Tx, jobId: string, reason: AiFailReason, now: Date, detail?: string): Promise<void> {
  await tx.aiJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: reason, leaseUntil: null, updatedAt: now, ...(detail ? { result: { detail } } : {}) },
  });
}

/** A call with the key worked: a QUOTA or INVALID status is over. */
export async function keyWorked(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.user.updateMany({ where: { id: userId, aiKeyStatus: { not: "OK" }, aiKeyCipher: { not: null } }, data: { aiKeyStatus: "OK", aiKeyCheckedAt: now } });
}

/**
 * The key's quota ran out or it was refused: the account's status says so (QUOTA until the usage day
 * resets, INVALID until a new key is saved) and, with `tell`, its owner gets AI_KEY_PROBLEM once per usage
 * day and problem (User.aiKeyNotice).
 */
export async function keyProblem(
  tx: Tx,
  user: { id: string; aiProvider: AiProviderName | null; aiKeyNotice: string | null },
  problem: "QUOTA" | "INVALID",
  now: Date,
  tell: boolean,
): Promise<void> {
  if (!user.aiProvider) return;
  const notice = `${problem}:${usageDay(user.aiProvider, now)}`;
  const current = await tx.user.findUnique({ where: { id: user.id }, select: { aiKeyNotice: true, aiProvider: true, aiKeyCipher: true } });
  if (!current?.aiKeyCipher || current.aiProvider !== user.aiProvider) return;
  const sendNow = tell && current.aiKeyNotice !== notice;
  await tx.user.update({
    where: { id: user.id },
    data: { aiKeyStatus: problem, aiKeyCheckedAt: now, ...(sendNow ? { aiKeyNotice: notice } : {}) },
  });
  if (!sendNow) return;
  await notify(tx, {
    userIds: [user.id],
    projectId: null,
    type: "AI_KEY_PROBLEM",
    audience: "ONLY_YOU",
    payload: { provider: user.aiProvider, problem, resetsAt: problem === "QUOTA" ? usageResetAt(user.aiProvider, now).toISOString() : null },
    now,
  });
}
