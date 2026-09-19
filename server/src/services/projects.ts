import { apportion, balancePackages, packageCount } from "../../../shared/planning";
import type { AdjustedTask } from "../../../shared/types";
import type { Project, User } from "../generated/prisma/client";
import { pickHighlighter, pickProjectColor } from "../lib/colors";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { allocateInviteCode } from "../lib/invite-code";
import { FINISHED_STATUSES } from "../lib/package-state";
import { spreadDueDates, toInstant } from "../lib/plan/dates";
import { recordEvent } from "./notify";
import type { ProjectBasicsBody, ProjectPatchBody } from "./schemas";
import { lockAsMember, lockDraft, lockProject, memberUnderLock, TX_OPTIONS, type Tx } from "./tx";

const deadlineInPast = () => new AppError(400, "DEADLINE_IN_PAST", "The deadline must be in the future");

/** Creates a draft (wizard step 1 done): the creator becomes its leader; the wizard continues at step 2. */
export async function createDraft(db: Db, user: User, input: ProjectBasicsBody, now = new Date()): Promise<string> {
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
 */
export async function updateProject(
  db: Db,
  projectId: string,
  userId: string,
  input: ProjectPatchBody,
  now = new Date(),
): Promise<{ adjustedTasks?: AdjustedTask[] }> {
  return db.$transaction(async (tx) => {
    const project = await lockProject(tx, projectId);
    // The route's leader check ran before the lock; a transfer may have committed since.
    await memberUnderLock(tx, project, userId, { leader: true });
    if (project.status === "AWAITING_CONFIRM" || project.status === "ENDED") {
      throw new AppError(409, "PROJECT_ENDED", "The project has ended");
    }
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
async function rescheduleTasks(tx: Tx, project: Project, deadline: Date, timezone: string, now: Date): Promise<AdjustedTask[]> {
  const tasks = await tx.task.findMany({
    where: { projectId: project.id, status: { notIn: [...FINISHED_STATUSES] } },
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
}

/**
 * 「分成 N 个任务包」: rescales the draft's points to exactly 1000, balances the tasks into equal
 * packages (feature groups kept together), renumbers tasks #1…#n in plan order, creates the invite
 * code and makes the project ACTIVE. The row lock makes a double tap confirm only once.
 */
export async function confirmPlan(db: Db, projectId: string, now = new Date()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    if (project.deadline <= now) throw deadlineInPast();
    const tasks = await tx.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { number: "asc" }] });
    if (tasks.length === 0) throw new AppError(409, "PLAN_EMPTY", "Add at least one task first");

    const points = apportion(tasks.map((t) => t.points));
    const count = packageCount(project.teamSize, project.leaderManages);
    const balanced = balancePackages(
      tasks.map((t, i) => ({ id: t.id, points: points[i]!, group: t.featureId })),
      count,
    );

    await tx.package.deleteMany({ where: { projectId } });
    const packageOf = new Map<string, string>();
    for (const [i, pkg] of balanced.packages.entries()) {
      const created = await tx.package.create({ data: { projectId, index: i + 1 }, select: { id: true } });
      for (const taskId of pkg.taskIds) packageOf.set(taskId, created.id);
    }

    // Move numbers out of the way first: (projectId, number) is unique while we renumber.
    await tx.task.updateMany({ where: { projectId }, data: { number: { increment: 1_000_000 } } });
    for (const [i, task] of tasks.entries()) {
      await tx.task.update({
        where: { id: task.id },
        data: { points: points[i]!, packageId: packageOf.get(task.id) ?? null, number: i + 1, order: i },
      });
    }

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
  }, TX_OPTIONS);
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
