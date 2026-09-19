// 作业要求 (M4 spec §2): the brief's text with each task's line range, for the brief page.
import type { BriefView } from "../../../shared/types";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";

/** GET /api/projects/:id/brief (the caller checked membership). NO_BRIEF when the project keeps no text. */
export async function loadBrief(db: Db, projectId: string): Promise<BriefView> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      briefText: true,
      briefFileName: true,
      tasks: {
        where: { briefFrom: { not: null }, briefTo: { not: null } },
        orderBy: [{ order: "asc" }, { number: "asc" }],
        select: { id: true, title: true, ownerId: true, briefFrom: true, briefTo: true },
      },
    },
  });
  if (!project) throw notFound("Project");
  if (!project.briefText) throw new AppError(404, "NO_BRIEF", "This project has no assignment brief text");
  return {
    text: project.briefText,
    fileName: project.briefFileName,
    items: project.tasks.map((t) => ({ taskId: t.id, title: t.title, ownerMemberId: t.ownerId, from: t.briefFrom!, to: t.briefTo! })),
  };
}
