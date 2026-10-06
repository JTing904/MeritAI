// The AI job worker (M6 spec §3). Jobs are enqueued in the transaction of the write that needs them
// (ai-job-store.ts), then run right after the commit in this process (kickAiJobs) and by every tick
// (drainAiJobs, which also recovers stale leases). A job:
//
// 1. is claimed atomically (QUEUED and due → RUNNING with a lease; FOR UPDATE SKIP LOCKED, so two workers
//    never take the same one), each claim counting a try;
// 2. runs its handler, which calls the model and then writes its outcome in ONE transaction under the
//    project lock, re-checking that the project / task / attempt is still what the job was made for
//    (otherwise it is discarded);
// 3. on a per-minute limit waits (runAfter, the try not counted); on a transient failure retries after 30 s,
//    2 min, 10 min (3 tries in all), then fails for good; a key problem (QUOTA, INVALID) fails at once.
import type { AiFailReason } from "../../../shared/types";
import type { AiJob, AiJobKind } from "../generated/prisma/client";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { briefHandler } from "./ai-brief";
import { gradeHandler } from "./ai-grade";
import { howtoHandler } from "./ai-howto";
import { resplitHandler } from "./ai-resplit";

/** What a handler's run came to (a "done" handler already wrote the outcome and finished the job). */
export type RunOutcome = { kind: "done" } | { kind: "wait"; until: Date } | { kind: "fail"; reason: AiFailReason; retry: boolean; detail?: string };

export type JobHandler = {
  run(db: Db, job: AiJob, now: Date): Promise<RunOutcome>;
  /** The final failure: its effects and the job FAILED, in one transaction under the project lock. */
  fail(db: Db, job: AiJob, reason: AiFailReason, now: Date, detail?: string): Promise<void>;
};

const HANDLERS: Record<AiJobKind, JobHandler> = { BRIEF: briefHandler, HOWTO: howtoHandler, GRADE: gradeHandler, RESPLIT: resplitHandler };

export const MAX_TRIES = 3;
/** Wait before try 2 and 3. */
export const BACKOFF_MS = [30_000, 120_000, 600_000];
/** A running job whose lease ran out (the process died mid-call) goes back to the queue. */
export const LEASE_MS = 5 * 60_000;

/** RUNNING with an expired lease → QUEUED (its try stays counted). Returns how many. */
export async function recoverStale(db: Db, now: Date): Promise<number> {
  return db.$executeRaw`
    UPDATE "AiJob" SET "status" = 'QUEUED', "leaseUntil" = NULL, "runAfter" = ${now}, "updatedAt" = ${now}
    WHERE "status" = 'RUNNING' AND "leaseUntil" < ${now}`;
}

/** Takes the next due job (oldest first), or null. `kinds`/`ids` narrow it (tests). */
async function claim(db: Db, now: Date, only?: { ids?: string[] }): Promise<AiJob | null> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const ids = only?.ids ?? null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "AiJob" SET "status" = 'RUNNING', "leaseUntil" = ${lease}, "tries" = "tries" + 1, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "AiJob"
      WHERE "status" = 'QUEUED' AND "runAfter" <= ${now} AND (${ids}::text[] IS NULL OR "id" = ANY(${ids}::text[]))
      ORDER BY "runAfter", "createdAt", "id"
      LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  if (rows.length === 0) return null;
  return db.aiJob.findUnique({ where: { id: rows[0]!.id } });
}

/** Runs one claimed job to its next state. */
export async function runJob(db: Db, job: AiJob, now: Date): Promise<void> {
  const handler = HANDLERS[job.kind];
  let outcome: RunOutcome;
  if (job.tries > MAX_TRIES) outcome = { kind: "fail", reason: "ERROR", retry: false, detail: "too many tries" };
  else {
    try {
      outcome = await handler.run(db, job, now);
    } catch (err) {
      console.error(`ai: ${job.kind} job ${job.id} crashed`, (err as Error)?.message ?? err);
      outcome = { kind: "fail", reason: "ERROR", retry: true, detail: "crashed" };
    }
  }
  if (outcome.kind === "done") return;
  if (outcome.kind === "wait") {
    await db.aiJob.updateMany({
      where: { id: job.id, status: "RUNNING", tries: job.tries },
      data: { status: "QUEUED", runAfter: outcome.until, leaseUntil: null, tries: { decrement: 1 }, updatedAt: now },
    });
    return;
  }
  if (outcome.retry && job.tries < MAX_TRIES) {
    await db.aiJob.updateMany({
      where: { id: job.id, status: "RUNNING", tries: job.tries },
      data: {
        status: "QUEUED",
        runAfter: new Date(now.getTime() + BACKOFF_MS[job.tries - 1]!),
        leaseUntil: null,
        error: outcome.reason,
        updatedAt: now,
      },
    });
    return;
  }
  try {
    await handler.fail(db, job, outcome.reason, now, outcome.detail);
  } catch (err) {
    console.error(`ai: failing ${job.kind} job ${job.id} failed`, (err as Error)?.message ?? err);
  }
}

let draining: Promise<number> | null = null;

/**
 * Recovers stale leases, then runs due jobs one after another (at most `max`). One drain at a time per
 * process (a second call waits for the running one). Returns the jobs run.
 */
export async function drainAiJobs(db: Db, now: Date | (() => Date) = () => clock.now(), opts: { max?: number; ids?: string[] } = {}): Promise<number> {
  if (draining && !opts.ids) return draining;
  const at = () => (typeof now === "function" ? now() : now);
  const work = (async () => {
    await recoverStale(db, at());
    let ran = 0;
    const max = opts.max ?? 20;
    while (ran < max) {
      const t = at();
      const job = await claim(db, t, { ids: opts.ids });
      if (!job) break;
      await runJob(db, job, t);
      ran++;
    }
    return ran;
  })();
  if (opts.ids) return work;
  draining = work;
  try {
    return await work;
  } finally {
    draining = null;
  }
}
