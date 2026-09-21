// The project lifecycle's derived dates (M5 spec §3), shared by the views, the tick and the lifecycle writes.
import { AUTO_END_DAYS, AUTO_END_WARN_DAYS, ENDED_KEEP_DAYS } from "../../../shared/constants";
import type { PersonRef, ProjectLifecycle } from "../../../shared/types";
import type { Project } from "../generated/prisma/client";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** AWAITING_CONFIRM ends by itself then (the deadline + 7 days). */
export const autoEndAt = (deadline: Date): Date => new Date(deadline.getTime() + AUTO_END_DAYS * DAY_MS);
/** The leader hears PROJECT_AUTO_END_SOON from then on (the deadline + 6 days). */
export const autoEndWarnAt = (deadline: Date): Date => new Date(deadline.getTime() + AUTO_END_WARN_DAYS * DAY_MS);
/** An ENDED project is deleted for good then (endedAt + 14 days). */
export const endedPurgeAt = (endedAt: Date): Date => new Date(endedAt.getTime() + ENDED_KEEP_DAYS * DAY_MS);

type LifecycleRow = Pick<Project, "status" | "deadline" | "awaitingSince" | "endedAt" | "endedAuto" | "endedById" | "purgeAfter">;

/**
 * ProjectLifecycle for the API. `nameOf` finds the name of a member of this project (the views already
 * loaded them); the member who ended it shows only when their row is still there.
 */
export function toLifecycle(p: LifecycleRow, nameOf: (memberId: string) => string | undefined): ProjectLifecycle {
  const endedName = p.endedById ? nameOf(p.endedById) : undefined;
  const endedBy: PersonRef | null = p.endedById && endedName !== undefined ? { memberId: p.endedById, name: endedName } : null;
  const ended = p.status === "ENDED";
  return {
    status: p.status,
    awaitingSince: p.status === "AWAITING_CONFIRM" ? (p.awaitingSince ?? p.deadline).toISOString() : null,
    autoEndAt: p.status === "AWAITING_CONFIRM" ? autoEndAt(p.deadline).toISOString() : null,
    endedAt: ended ? (p.endedAt?.toISOString() ?? null) : null,
    endedAuto: ended && p.endedAuto,
    endedBy: ended ? endedBy : null,
    purgeAfter: ended ? (p.purgeAfter?.toISOString() ?? null) : null,
  };
}
