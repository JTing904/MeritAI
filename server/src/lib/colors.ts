import { HIGHLIGHTERS, type Highlighter } from "../../../shared/constants";
import type { Prisma } from "../generated/prisma/client";

/**
 * The first highlighter (in HIGHLIGHTERS order) that nobody in `used` has. When all eight are
 * taken, the least-used one, earliest in the order on ties.
 */
export function pickHighlighter(used: readonly Highlighter[]): Highlighter {
  const counts = new Map<Highlighter, number>(HIGHLIGHTERS.map((h) => [h, 0]));
  for (const h of used) counts.set(h, (counts.get(h) ?? 0) + 1);
  let best: Highlighter = HIGHLIGHTERS[0];
  for (const h of HIGHLIGHTERS) if (counts.get(h)! < counts.get(best)!) best = h;
  return best;
}

/** Colour for a member joining (or rejoining) a project: avoids the other active members' colours. */
export async function pickMemberColor(
  db: Prisma.TransactionClient,
  projectId: string,
  exceptMemberId?: string,
): Promise<Highlighter> {
  const others = await db.member.findMany({
    where: { projectId, leftAt: null, removed: false, ...(exceptMemberId ? { id: { not: exceptMemberId } } : {}) },
    select: { color: true },
  });
  return pickHighlighter(others.map((m) => m.color));
}

/** Tag colour for a new project: avoids the creator's other projects that have not ended. */
export async function pickProjectColor(db: Prisma.TransactionClient, creatorId: string): Promise<Highlighter> {
  const projects = await db.project.findMany({
    where: { createdById: creatorId, status: { not: "ENDED" } },
    select: { color: true },
  });
  return pickHighlighter(projects.map((p) => p.color));
}
