import { apportion, balancePackages, COPY_FEATURE_RE, packageCount } from "../../../shared/planning";
import type { AdjustedTask } from "../../../shared/types";
import { Prisma, type Project, type User } from "../generated/prisma/client";
import { projectEnded } from "../lib/access";
import { pickHighlighter, pickProjectColor } from "../lib/colors";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { allocateInviteCode } from "../lib/invite-code";
import { UNFINISHED_WHERE } from "../lib/package-state";
import { spreadDueDates, toInstant } from "../lib/plan/dates";
import { recordEvent } from "./notify";
import type { ProjectBasicsBody, ProjectPatchBody } from "./schemas";
import { assertPointsTotal, lockAsMember, lockDraft, lockProject, memberUnderLock, TOTAL_POINTS, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";
import { getStorage } from "../lib/storage";

const deadlineInPast = () => new AppError(400, "DEADLINE_IN_PAST", "The deadline must be in the future");

/** Creates a draft (wizard step 1 done): the creator becomes its leader; the wizard continues at step 2. */
export async function createDraft(db: Db, user: User, input: ProjectBasicsBody, now = clock.now()): Promise<string> {
  const deadline = toInstant(input.deadline, input.timezone);
  if (deadline <= now) throw deadlineInPast();
  return db.$transaction(async (tx) => {
    const color = await pickProjectColor(tx, user.id);
    const project = await tx.project.create({
      data: {
        name: input.name,
        shortCode: input.shortCode ?? null,
        courseName: input.courseName ?? null,
        groupLabel: input.groupLabel ?? null,
        deadline,
        timezone: input.timezone,
        teamSize: input.teamSize,
        leaderManages: input.leaderManages,
        repoFullName: input.repoFullName ?? null,
        color,
        locale: user.locale,
        status: "DRAFT",
        draftStep: 2,
        createdById: user.id,
        // Nobody else is in the project yet, so the leader gets the first highlighter.
        members: { create: { userId: user.id, role: "LEADER", color: pickHighlighter([]) } },
      },
      select: { id: true },
    });
    return project.id;
  }, TX_OPTIONS);
}

/**
 * Leader edits of the project basics. Drafts can change everything; an active project keeps its team
 * size and "leader only manages" (changing the number of packages is a re-split, M3). A new deadline
 * moves the task due dates with it (see rescheduleTasks); `adjustedTasks` lists the ones that moved.
 * M5: an AWAITING_CONFIRM project takes edits too, and a new deadline (always after now) puts it back to
 * ACTIVE; the reminders arm again through their keys. An ENDED project → 409 PROJECT_ENDED (reopen it).
 */
export async function updateProject(
  db: Db,
  projectId: string,
  userId: string,
  input: ProjectPatchBody,
  now = clock.now(),
): Promise<{ adjustedTasks?: AdjustedTask[] }> {
  return db.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    // The route's leader check ran before the lock; a transfer may have committed since.
    await memberUnderLock(tx, project, userId, { leader: true });
    if (project.status === "ENDED") throw projectEnded();
    const isDraft = project.status === "DRAFT";
    if (!isDraft) {
      const resizes =
        (input.teamSize !== undefined && input.teamSize !== project.teamSize) ||
        (input.leaderManages !== undefined && input.leaderManages !== project.leaderManages);
      if (resizes) throw new AppError(409, "CONFLICT", "The team size can't change after the plan is confirmed");
    }

    const timezone = input.timezone ?? project.timezone;
    let deadline: Date | undefined;
    if (input.deadline !== undefined) {
      const next = toInstant(input.deadline, timezone);
      if (next.getTime() !== project.deadline.getTime()) {
        if (next <= now) throw deadlineInPast();
        deadline = next;
      }
    }

    await tx.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        shortCode: input.shortCode,
        courseName: input.courseName,
        groupLabel: input.groupLabel,
        deadline,
        timezone: input.timezone,
        teamSize: isDraft ? input.teamSize : undefined,
        leaderManages: isDraft ? input.leaderManages : undefined,
        repoFullName: input.repoFullName,
        draftStep: isDraft ? input.draftStep : undefined,
        // Past the deadline and pushed later: running again.
        ...(deadline && project.status === "AWAITING_CONFIRM" ? { status: "ACTIVE" as const, awaitingSince: null } : {}),
      },
    });
    if (!deadline) return {};
    return { adjustedTasks: await rescheduleTasks(tx, project, deadline, timezone, now) };
  }, TX_OPTIONS);
}

/**
 * The project deadline moved (earlier or later). Due dates the system scheduled (no date from the
 * leader, and dueAt still equals suggestedDueAt) are spread evenly again up to the new deadline, the
 * same way a brief spreads them, from now (or from when the project started, if that is later). A date
 * the leader set (leaderDueAt) becomes min(leaderDueAt, new deadline): an earlier deadline pulls it in,
 * a later one gives the leader's date back. A suggestion after the new deadline moves to the deadline.
 * Finished tasks keep the date they were done against. Returns the tasks whose due date changed.
 */
export async function rescheduleTasks(tx: Tx, project: Project, deadline: Date, timezone: string, now: Date): Promise<AdjustedTask[]> {
  const tasks = await tx.task.findMany({
    where: { projectId: project.id, AND: [UNFINISHED_WHERE] },
    orderBy: [{ order: "asc" }, { number: "asc" }],
  });
  const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const scheduled = tasks.filter((t) => t.leaderDueAt === null && t.dueAt !== null && same(t.dueAt, t.suggestedDueAt));
  const since = project.activatedAt ?? project.createdAt;
  const start = since > now ? since : now;
  const spread = spreadDueDates(scheduled.length, start, deadline, timezone);
  const planned = new Map(scheduled.map((t, i) => [t.id, spread[i]!]));

  const latest = (d: Date | null) => (d !== null && d > deadline ? deadline : d);
  const adjusted: AdjustedTask[] = [];
  for (const t of tasks) {
    const dueAt = planned.get(t.id) ?? (t.leaderDueAt !== null ? latest(t.leaderDueAt) : latest(t.dueAt));
    const suggestedDueAt = planned.get(t.id) ?? latest(t.suggestedDueAt);
    if (same(dueAt, t.dueAt) && same(suggestedDueAt, t.suggestedDueAt)) continue;
    await tx.task.update({ where: { id: t.id }, data: { dueAt, suggestedDueAt } });
    if (!same(dueAt, t.dueAt)) adjusted.push({ id: t.id, title: t.title, dueAt: dueAt!.toISOString() });
  }
  return adjusted;
}

export async function deleteDraft(db: Db, projectId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockDraft(tx, projectId);
    await tx.project.delete({ where: { id: projectId } });
  }, TX_OPTIONS);
  // M6: a brief photo kept for the AI lives in the project's storage folder.
  try {
    await getStorage().deletePrefix(projectId);
  } catch (e) {
    console.error("draft: could not delete its files", e);
  }
}

/**
 * 「分成 N 个任务包」: rescales the draft's points to exactly 1000, balances the tasks into equal
 * packages (feature groups kept together), renumbers tasks #1…#n in plan order, creates the invite
 * code and makes the project ACTIVE. The row lock makes a double tap confirm only once.
 */
export async function confirmPlan(db: Db, projectId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    if (project.deadline <= now) throw deadlineInPast();
    const tasks = await tx.task.findMany({
      where: { projectId },
      orderBy: [{ order: "asc" }, { number: "asc" }],
      select: { id: true, points: true, featureId: true, feature: { select: { name: true } } },
    });
    if (tasks.length === 0) throw new AppError(409, "PLAN_EMPTY", "Add at least one task first");
    // M6: every 选择题 answered with exactly its pickCount first (PUT …/choices made their tasks).
    const questions = await tx.choiceQuestion.findMany({ where: { projectId }, include: { options: { where: { picked: true }, select: { id: true } } } });
    const open = questions.filter((q) => q.options.length !== q.pickCount).map((q) => q.id);
    if (open.length > 0) throw new AppError(409, "CHOICES_REQUIRED", "Answer the choice questions first", { questionIds: open });

    const points = apportion(
      tasks.map((t) => t.points),
      TOTAL_POINTS,
    );
    const count = packageCount(project.teamSize, project.leaderManages);
    const balanced = balancePackages(
      tasks.map((t, i) => ({ id: t.id, points: points[i]!, group: t.featureId })),
      count,
    );

    // Task package n holds the copies numbered n (「组员 2」's 「…（第 2 份）」 go in 任务包 2), 2026-10-02.
    balanced.packages = orderByCopies(balanced.packages, new Map(tasks.map((t) => [t.id, t.feature?.name ?? null])));

    await tx.package.deleteMany({ where: { projectId } });
    const created = await tx.package.createManyAndReturn({
      data: balanced.packages.map((_, i) => ({ projectId, index: i + 1 })),
      select: { id: true, index: true },
    });
    const packageIdAt = new Map(created.map((p) => [p.index, p.id]));
    const packageOf = new Map<string, string>();
    for (const [i, pkg] of balanced.packages.entries()) {
      for (const taskId of pkg.taskIds) packageOf.set(taskId, packageIdAt.get(i + 1)!);
    }

    // Move numbers out of the way first: (projectId, number) is unique, and Postgres checks it row by row.
    await tx.task.updateMany({ where: { projectId }, data: { number: { increment: 1_000_000 } } });
    // One UPDATE for every task (A14): a 200-task plan was 200 round trips inside the lock.
    const rows = tasks.map(
      (task, i) =>
        Prisma.sql`(${task.id}::text, ${points[i]!}::int, ${packageOf.get(task.id) ?? null}::text, ${i + 1}::int, ${i}::int)`,
    );
    await tx.$executeRaw`
      UPDATE "Task" AS t
      SET "points" = v.points, "packageId" = v.package_id, "number" = v.number, "order" = v.ord, "updatedAt" = ${now}
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, points, package_id, number, ord)
      WHERE t."id" = v.id AND t."projectId" = ${projectId}`;

    await tx.project.update({
      where: { id: projectId },
      data: {
        status: "ACTIVE",
        activatedAt: now,
        draftStep: 6,
        inviteCode: await allocateInviteCode(tx, project.shortCode),
      },
    });
    const leader = await tx.member.findFirst({ where: { projectId, role: "LEADER" }, select: { id: true } });
    await recordEvent(tx, {
      projectId,
      actorId: leader?.id ?? null,
      type: "PLAN_CONFIRMED",
      payload: { packageCount: balanced.packages.length },
      now,
    });
    await assertPointsTotal(tx, projectId);
  }, TX_OPTIONS);
}

/**
 * The packages reordered so that package n holds the per-member copies numbered n, when every package
 * holds the copies of exactly one number (1…count, each once); otherwise the order is kept.
 */
export function orderByCopies<P extends { taskIds: string[] }>(packages: P[], featureOf: Map<string, string | null>): P[] {
  const numbers = packages.map((p) => {
    const found = new Set(p.taskIds.map((id) => featureOf.get(id)?.match(COPY_FEATURE_RE)?.[1]).filter((n): n is string => !!n).map(Number));
    return found.size === 1 ? [...found][0]! : null;
  });
  const ok = numbers.every((n) => n !== null && n >= 1 && n <= packages.length) && new Set(numbers).size === packages.length;
  if (!ok) return packages;
  return packages.map((p, i) => ({ p, n: numbers[i]! })).sort((a, b) => a.n - b.n).map((x) => x.p);
}

/** 「重新生成」: the old code is retired so joining with it says "expired" instead of "not found". */
export async function resetInviteCode(db: Db, projectId: string, userId: string): Promise<string> {
  return db.$transaction(async (tx) => {
    const { project } = await lockAsMember(tx, projectId, userId, { leader: true });
    const code = await allocateInviteCode(tx, project.shortCode);
    await tx.project.update({ where: { id: projectId }, data: { inviteCode: code } });
    if (project.inviteCode) await tx.retiredInviteCode.create({ data: { code: project.inviteCode, projectId } });
    return code;
  }, TX_OPTIONS);
}
