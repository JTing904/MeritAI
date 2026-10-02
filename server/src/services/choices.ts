// 选择题 (M6 spec §4): the draft's answers (wizard step 4) and 改选 after the plan is confirmed.
import { apportion } from "../../../shared/planning";
import type { ChoiceQuestionView, PersonRef, RechoosePreview } from "../../../shared/types";
import type { ChoiceOption, ChoiceQuestion, Task } from "../generated/prisma/client";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { isLocked, lightestPackage } from "../lib/package-state";
import { spreadDueDates } from "../lib/plan/dates";
import { bumpPackages, notify, recordEvent } from "./notify";
import { createSeededTasks, seedsFromJson, type Placement } from "./task-seeds";
import { assertPointsTotal, lockAsMember, lockDraft, TOTAL_POINTS, TX_OPTIONS, type Tx } from "./tx";

type Reader = Db | Tx;
type QuestionRow = ChoiceQuestion & { options: ChoiceOption[] };
type TaskLite = Pick<Task, "id" | "choiceOptionId" | "status" | "startedAt" | "startedById" | "ownerId">;

export async function questionsOf(db: Reader, projectId: string): Promise<QuestionRow[]> {
  return db.choiceQuestion.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    include: { options: { orderBy: { order: "asc" } } },
  });
}

/**
 * The questions as the app shows them. `tasks`: the project's tasks (for taskIds and 🔒); `nameOf`: member
 * names; `running`: an active project (only then does a started task lock its option).
 */
export function toChoiceViews(
  questions: QuestionRow[],
  tasks: TaskLite[],
  nameOf: (memberId: string) => string | undefined,
  running: boolean,
): ChoiceQuestionView[] {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    quote: q.quote,
    pickCount: q.pickCount,
    order: q.order,
    options: q.options.map((o) => {
      const seeds = seedsFromJson(o.tasksJson);
      const own = tasks.filter((t) => t.choiceOptionId === o.id);
      const started = running ? own.find((t) => isLocked(t)) : undefined;
      const who = started ? (started.startedById ?? started.ownerId) : null;
      const lockedBy: PersonRef | null = started ? { memberId: who ?? "", name: (who && nameOf(who)) || "" } : null;
      return {
        key: o.key,
        label: o.label,
        summary: o.summary,
        hours: o.hours,
        material: o.material,
        difficulty: o.difficulty,
        pros: o.pros,
        cons: o.cons,
        recommended: o.recommended,
        picked: o.picked,
        taskCount: seeds.length,
        points: seeds.reduce((s, t) => s + t.points, 0),
        taskIds: own.map((t) => t.id),
        lockedBy,
      };
    }),
  }));
}

/** Exactly pickCount distinct keys of this question (400 CHOICE_COUNT otherwise). */
function checkPicks(q: QuestionRow, picks: unknown): string[] {
  const list = Array.isArray(picks) ? picks.filter((k): k is string => typeof k === "string") : [];
  const keys = new Set(q.options.map((o) => o.key));
  const distinct = [...new Set(list)];
  if (distinct.length !== q.pickCount || distinct.length !== list.length || distinct.some((k) => !keys.has(k))) {
    throw new AppError(400, "CHOICE_COUNT", `Pick exactly ${q.pickCount}`, { questionId: q.id, pickCount: q.pickCount });
  }
  return distinct;
}

/**
 * 「确认，拆任务」 (draft): every question's picks (CHOICE_COUNT unless exactly pickCount each). The options
 * picked before lose their tasks; the new picks' tasks are added after the plan's own (numbers and order
 * continue), with their 怎么做 and checklists.
 */
export async function setDraftChoices(db: Db, projectId: string, answers: Record<string, string[]>, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    const questions = await questionsOf(tx, projectId);
    const picked = new Map(questions.map((q) => [q.id, new Set(checkPicks(q, answers[q.id]))]));
    const optionIds = questions.flatMap((q) => q.options.map((o) => o.id));
    if (optionIds.length === 0) return;
    await tx.task.deleteMany({ where: { projectId, choiceOptionId: { in: optionIds } } });
    for (const q of questions) {
      const keys = picked.get(q.id)!;
      await tx.choiceOption.updateMany({ where: { questionId: q.id }, data: { picked: false } });
      await tx.choiceOption.updateMany({ where: { questionId: q.id, key: { in: [...keys] } }, data: { picked: true } });
    }
    const chosen = questions.flatMap((q) => q.options.filter((o) => picked.get(q.id)!.has(o.key)));
    const seeds = chosen.flatMap((o) => seedsFromJson(o.tasksJson).map((s) => ({ s, optionId: o.id })));
    const agg = await tx.task.aggregate({ where: { projectId }, _max: { number: true, order: true } });
    const dues = spreadDueDates(seeds.length, now, project.deadline, project.timezone);
    await createSeededTasks(
      tx,
      project,
      seeds.map((x) => x.s),
      {
        startNumber: (agg._max.number ?? 0) + 1,
        startOrder: (agg._max.order ?? -1) + 1,
        dueFallback: dues,
        choiceOptionIds: seeds.map((x) => x.optionId),
      },
    );
    await tx.project.update({ where: { id: projectId }, data: { draftStep: Math.max(project.draftStep, 5) } });
  }, TX_OPTIONS);
}

// ─── 改选 after confirming ────────────────────────────────────────────────────

type Plan = {
  question: QuestionRow;
  from: string[];
  to: string[];
  removed: Task[];
  seeds: { seed: ReturnType<typeof seedsFromJson>[number]; optionId: string; placement: Placement; packageIndex: number | null; order: number | null; dueAt: Date | null }[];
  /** New points of the tasks that stay (by id) and of the seeds (in order). */
  keptPoints: Map<string, number>;
  seedPoints: number[];
  version: number;
};

async function planRechoose(tx: Tx, projectId: string, questionId: string, picks: string[], version: number): Promise<Plan> {
  const question = (await questionsOf(tx, projectId)).find((q) => q.id === questionId);
  if (!question) throw notFound("Question");
  const to = checkPicks(question, picks);
  const from = question.options.filter((o) => o.picked).map((o) => o.key);
  const dropped = question.options.filter((o) => o.picked && !to.includes(o.key));
  const added = question.options.filter((o) => !o.picked && to.includes(o.key));

  const tasks = await tx.task.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { number: "asc" }] });
  const droppedIds = new Set(dropped.map((o) => o.id));
  const removed = tasks.filter((t) => t.choiceOptionId !== null && droppedIds.has(t.choiceOptionId));
  const locked = dropped.filter((o) => removed.some((t) => t.choiceOptionId === o.id && isLocked(t))).map((o) => o.key);
  if (locked.length > 0) throw new AppError(409, "CHOICE_LOCKED", "Someone already started a task of this option", { optionKeys: locked });

  const packages = await tx.package.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  const kept = tasks.filter((t) => !removed.includes(t));
  const fallback = lightestPackage(packages, kept);
  const seeds = added.flatMap((o) => seedsFromJson(o.tasksJson).map((seed) => ({ seed, optionId: o.id })));
  const planned = seeds.map((x, i) => {
    // The i-th new task takes the place of the i-th dropped one (its package and that package's owner).
    const instead = removed.length ? removed[i % removed.length]! : null;
    const pkg = packages.find((p) => p.id === instead?.packageId) ?? fallback;
    return {
      ...x,
      placement: { packageId: pkg?.id ?? null, ownerId: pkg?.ownerId ?? null },
      packageIndex: pkg?.index ?? null,
      order: i < removed.length ? removed[i]!.order : null,
      dueAt: instead?.dueAt ?? null,
    };
  });
  // Everything is rescaled in proportion so the total stays exactly 1000 (as adding tasks does).
  const scaled = apportion([...kept.map((t) => t.points), ...planned.map((x) => x.seed.points)], TOTAL_POINTS);
  return {
    question,
    from,
    to,
    removed,
    seeds: planned,
    keptPoints: new Map(kept.map((t, i) => [t.id, scaled[i]!])),
    seedPoints: scaled.slice(kept.length),
    version,
  };
}

function toPreview(plan: Plan, packageIndexOf: (id: string | null) => number | null): RechoosePreview {
  const unchanged = plan.from.length === plan.to.length && plan.from.every((k) => plan.to.includes(k));
  return {
    questionId: plan.question.id,
    prompt: plan.question.prompt,
    pickCount: plan.question.pickCount,
    from: plan.from,
    to: plan.to,
    removeTasks: plan.removed.map((t) => ({ taskId: t.id, title: t.title, points: t.points, packageIndex: packageIndexOf(t.packageId), ownerMemberId: t.ownerId })),
    addTasks: plan.seeds.map((x, i) => ({ title: x.seed.title, points: plan.seedPoints[i]!, packageIndex: x.packageIndex, ownerMemberId: x.placement.ownerId })),
    unchanged,
    version: plan.version,
  };
}

/** POST …/choices/:questionId/preview (leader, running project): what 改选 would do; writes nothing. */
export async function previewRechoose(db: Db, projectId: string, questionId: string, userId: string, picks: string[]): Promise<RechoosePreview> {
  return db.$transaction(async (tx) => {
    const { project } = await lockAsMember(tx, projectId, userId, { leader: true });
    const plan = await planRechoose(tx, projectId, questionId, picks, project.packagesVersion);
    const packages = await tx.package.findMany({ where: { projectId }, select: { id: true, index: true } });
    return toPreview(plan, (id) => packages.find((p) => p.id === id)?.index ?? null);
  }, TX_OPTIONS);
}

/**
 * POST …/choices/:questionId (leader, running project): 改选. The dropped options' tasks (none started) are
 * deleted, the new options' tasks go where they were, every task is rescaled to keep 1000, and the group
 * hears CHOICE_CHANGED. `version` (from the preview) must still be the packages version (STALE_PREVIEW).
 */
export async function applyRechoose(
  db: Db,
  projectId: string,
  questionId: string,
  userId: string,
  input: { picks: string[]; version?: number },
  now = clock.now(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    if (input.version !== undefined && input.version !== project.packagesVersion) {
      throw new AppError(409, "STALE_PREVIEW", "Something changed since the preview; look again");
    }
    const plan = await planRechoose(tx, projectId, questionId, input.picks, project.packagesVersion);
    const unchanged = plan.from.length === plan.to.length && plan.from.every((k) => plan.to.includes(k));
    if (unchanged) return;

    if (plan.removed.length) await tx.task.deleteMany({ where: { id: { in: plan.removed.map((t) => t.id) } } });
    const byPoints = new Map<number, string[]>();
    const current = await tx.task.findMany({ where: { projectId }, select: { id: true, points: true } });
    for (const t of current) {
      const next = plan.keptPoints.get(t.id);
      if (next === undefined || next === t.points) continue;
      byPoints.set(next, [...(byPoints.get(next) ?? []), t.id]);
    }
    for (const [points, ids] of byPoints) await tx.task.updateMany({ where: { id: { in: ids } }, data: { points } });

    const agg = await tx.task.aggregate({ where: { projectId }, _max: { number: true, order: true } });
    const maxOrder = agg._max.order ?? -1;
    await createSeededTasks(
      tx,
      project,
      plan.seeds.map((x, i) => ({ ...x.seed, points: plan.seedPoints[i]! })),
      {
        startNumber: (agg._max.number ?? 0) + 1,
        startOrder: maxOrder + 1,
        orders: plan.seeds.map((x, i) => x.order ?? maxOrder + 1 + i),
        dueFallback: plan.seeds.map((x) => x.dueAt),
        choiceOptionIds: plan.seeds.map((x) => x.optionId),
        placement: plan.seeds.map((x) => x.placement),
      },
    );
    await tx.choiceOption.updateMany({ where: { questionId }, data: { picked: false } });
    await tx.choiceOption.updateMany({ where: { questionId, key: { in: plan.to } }, data: { picked: true } });

    const labels = (keys: string[]) => plan.question.options.filter((o) => keys.includes(o.key)).map((o) => o.label);
    const fromLabels = labels(plan.from.filter((k) => !plan.to.includes(k)));
    const toLabels = labels(plan.to.filter((k) => !plan.from.includes(k)));
    const members = await tx.member.findMany({ where: { projectId, leftAt: null, removed: false }, select: { id: true, userId: true } });
    const touchedOwners = new Set([...plan.removed.map((t) => t.ownerId), ...plan.seeds.map((x) => x.placement.ownerId)].filter((id): id is string => !!id));
    const mineUsers = new Set(members.filter((m) => touchedOwners.has(m.id)).map((m) => m.userId));
    await notify(tx, {
      userIds: members.filter((m) => m.id !== leader.id).map((m) => m.userId),
      projectId,
      type: "CHOICE_CHANGED",
      audience: "GROUP",
      mine: (uid) => mineUsers.has(uid),
      payload: {
        questionId,
        prompt: plan.question.prompt,
        from: fromLabels,
        to: toLabels,
        removedTitles: plan.removed.map((t) => t.title),
        addedTitles: plan.seeds.map((x) => x.seed.title),
      },
      now,
    });
    await recordEvent(tx, {
      projectId,
      actorId: leader.id,
      type: "CHOICE_CHANGED",
      payload: { questionId, prompt: plan.question.prompt, from: fromLabels, to: toLabels },
      now,
    });
    await bumpPackages(tx, projectId);
    await assertPointsTotal(tx, projectId);
  }, TX_OPTIONS);
}

