// 我的任务 (M4 spec §2): every task I own in my ACTIVE projects.
import { projectTag } from "../../../shared/format";
import type { MyTaskRow, MyTasksView } from "../../../shared/types";
import type { User } from "../generated/prisma/client";
import type { Db } from "../lib/db";
import { countingAttempt } from "../lib/grading";
import { earnedPoints, effectiveDue, isOverdue, needsPackage } from "../lib/package-state";

/**
 * 待完成 holds everything not yet at full points: a task waiting for review or graded 拿一半 stays
 * there (「可重交拿满」), and never counts as overdue. The app groups it by effective due; the server
 * sends every row sorted by that due (earliest first) and 已完成 newest finished first.
 */
const OPEN_STATUSES = new Set(["TODO", "DOING", "REVIEWING", "HALF", "FAIL"]);

/** GET /api/tasks/mine */
export async function myTasks(db: Db, user: User, now = new Date()): Promise<MyTasksView> {
  const memberships = await db.member.findMany({
    where: { userId: user.id, leftAt: null, removed: false, project: { status: "ACTIVE", deletedAt: null } },
    orderBy: { joinedAt: "asc" },
    include: {
      project: true,
      package: { select: { id: true } },
      tasks: {
        orderBy: [{ order: "asc" }, { number: "asc" }],
        include: {
          attempts: {
            orderBy: { no: "asc" },
            select: {
              no: true,
              status: true,
              grade: true,
              late: true,
              selfGraded: true,
              outsideApp: true,
              changes: { where: { undoneAt: null }, select: { id: true }, take: 1 },
            },
          },
        },
      },
    },
  });

  const rows: (MyTaskRow & { due: number; finished: number })[] = [];
  const withoutPackage: MyTasksView["withoutPackage"] = [];
  for (const { project, package: pkg, tasks, ...me } of memberships) {
    const tag = projectTag(project.name, project.shortCode);
    if (needsPackage(me, project, pkg !== null)) withoutPackage.push({ projectId: project.id, projectTag: tag });
    for (const t of tasks) {
      const counting = countingAttempt(t.attempts);
      const latest = t.attempts.at(-1);
      const due = effectiveDue(t, project);
      rows.push({
        id: t.id,
        projectId: project.id,
        projectTag: tag,
        projectColor: project.color,
        title: t.title,
        kind: t.kind,
        points: t.points,
        status: t.status,
        grade: t.grade,
        overdue: isOverdue(t, project, now),
        late: latest?.late ?? false,
        dueAt: due.toISOString(),
        earnedPoints: earnedPoints(t),
        finishedAt: t.finishedAt?.toISOString() ?? null,
        selfGraded: counting?.selfGraded ?? false,
        outsideApp: counting?.outsideApp ?? false,
        overridden: (counting?.changes.length ?? 0) > 0,
        due: due.getTime(),
        finished: t.finishedAt?.getTime() ?? 0,
      });
    }
  }

  const strip = ({ due: _due, finished: _finished, ...row }: (typeof rows)[number]): MyTaskRow => row;
  return {
    open: rows
      .filter((r) => OPEN_STATUSES.has(r.status))
      .sort((a, b) => a.due - b.due)
      .map(strip),
    done: rows
      .filter((r) => r.status === "DONE")
      .sort((a, b) => b.finished - a.finished)
      .map(strip),
    withoutPackage,
  };
}
