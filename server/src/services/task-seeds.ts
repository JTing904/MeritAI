// Tasks the AI proposes (M6 spec §4): turned into rows for a draft plan, for the picked options of a 选择题,
// and again when the leader 改选 after the plan is confirmed. A seed is also what ChoiceOption.tasksJson
// keeps, so re-choosing regenerates the same tasks.
import type { Locale } from "../../../shared/constants";
import type { Project, TaskKind } from "../generated/prisma/client";
import type { BriefTaskOut } from "../lib/ai/prompts";
import { clampNumber, clampText, cleanList, MAX_AI_TITLE } from "../lib/ai/sanitize";
import { DATE_ONLY, endOfLocalDay } from "../lib/plan/dates";
import { MAX_EXCERPT_CHARS } from "./brief";
import { newRowId } from "./ai-job-store";
import type { Tx } from "./tx";

/** One task to create. Points in tenths; dueAt ISO (null: the caller spreads a date). */
export type TaskSeed = {
  title: string;
  kind: TaskKind;
  points: number;
  estimateHours: number | null;
  dueAt: string | null;
  milestone: string | null;
  feature: string | null;
  /** [briefFrom, briefTo) in Project.briefText lines, or null. */
  briefFrom: number | null;
  briefTo: number | null;
  excerpt: string | null;
  howto: string[];
  checklist: string[];
  prereqTitle: string | null;
  description?: string | null;
};

const MAX_HOWTO = 8;
const MAX_CHECKLIST = 6;
const MAX_STEP_CHARS = 200;

/** The weight the model gave, made safe (0.1–1000). */
export const weightOf = (t: Pick<BriefTaskOut, "points">): number => clampNumber(t.points, 0.1, 1000, 1);

/** A due date from the model: a real "YYYY-MM-DD" after now and not after the deadline, else null. */
function dueFrom(value: string | null, project: Pick<Project, "deadline" | "timezone">, now: Date): string | null {
  if (!value || !DATE_ONLY.test(value.trim())) return null;
  const at = endOfLocalDay(value.trim(), project.timezone);
  if (Number.isNaN(at.getTime()) || at <= now) return null;
  return (at > project.deadline ? project.deadline : at).toISOString();
}

/** Where in the brief a task comes from: the model's line numbers (1-based, inclusive), else a quoted line. */
function excerptFrom(t: BriefTaskOut, lines: string[]): Pick<TaskSeed, "briefFrom" | "briefTo" | "excerpt"> {
  const from = Number.isInteger(t.briefFrom) ? t.briefFrom! : null;
  const to = Number.isInteger(t.briefTo) ? t.briefTo! : from;
  if (from !== null && to !== null && from >= 1 && to >= from && to <= lines.length && to - from <= 200) {
    const text = lines.slice(from - 1, to).join("\n").trim();
    if (text) return { briefFrom: from - 1, briefTo: to, excerpt: text.slice(0, MAX_EXCERPT_CHARS) };
  }
  const quote = clampText(t.quote, 500);
  if (quote) {
    const probe = quote.slice(0, 40);
    const at = lines.findIndex((l) => l.includes(probe));
    if (at >= 0) return { briefFrom: at, briefTo: at + 1, excerpt: lines[at]!.trim().slice(0, MAX_EXCERPT_CHARS) };
    return { briefFrom: null, briefTo: null, excerpt: quote };
  }
  return { briefFrom: null, briefTo: null, excerpt: null };
}

/** A model task as a seed (points given by the caller, already in tenths). Null when it has no title. */
export function seedFromAi(
  t: BriefTaskOut,
  points: number,
  ctx: { project: Pick<Project, "deadline" | "timezone">; lines: string[]; now: Date },
): TaskSeed | null {
  const title = clampText(t.title, MAX_AI_TITLE).replace(/\s*\n\s*/g, " ");
  if (!title) return null;
  const hours = clampNumber(t.estimateHours, 0, 500, 0);
  return {
    title,
    kind: t.kind,
    points: Math.max(1, Math.round(points)),
    estimateHours: hours > 0 ? Math.round(hours * 2) / 2 : null,
    dueAt: dueFrom(t.suggestedDue, ctx.project, ctx.now),
    milestone: clampText(t.milestone, 60) || null,
    feature: clampText(t.feature, 40) || null,
    ...excerptFrom(t, ctx.lines),
    howto: cleanList(t.howto, MAX_HOWTO, MAX_STEP_CHARS),
    checklist: cleanList(t.checklist, MAX_CHECKLIST, MAX_STEP_CHARS),
    prereqTitle: clampText(t.prereqTitle, MAX_AI_TITLE) || null,
  };
}

/** A seed read back from ChoiceOption.tasksJson (anything malformed is dropped). */
export function seedsFromJson(value: unknown): TaskSeed[] {
  if (!Array.isArray(value)) return [];
  const kinds = new Set(["CODE", "DOC", "RESEARCH", "DESIGN", "MEETING"]);
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const s = v as Record<string, unknown>;
    const title = clampText(s.title, MAX_AI_TITLE);
    if (!title || !kinds.has(String(s.kind))) return [];
    const int = (x: unknown) => (typeof x === "number" && Number.isInteger(x) ? x : null);
    return [
      {
        title,
        kind: s.kind as TaskKind,
        points: Math.max(1, Math.round(clampNumber(s.points, 1, 1000, 10))),
        estimateHours: typeof s.estimateHours === "number" ? s.estimateHours : null,
        dueAt: typeof s.dueAt === "string" ? s.dueAt : null,
        milestone: typeof s.milestone === "string" ? s.milestone : null,
        feature: typeof s.feature === "string" ? s.feature : null,
        briefFrom: int(s.briefFrom),
        briefTo: int(s.briefTo),
        excerpt: typeof s.excerpt === "string" ? s.excerpt : null,
        howto: cleanList(s.howto, MAX_HOWTO, MAX_STEP_CHARS),
        checklist: cleanList(s.checklist, MAX_CHECKLIST, MAX_STEP_CHARS),
        prereqTitle: typeof s.prereqTitle === "string" ? s.prereqTitle : null,
      },
    ];
  });
}

/** Feature ids by name (created in order when missing). */
export async function ensureFeatures(tx: Tx, projectId: string, names: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.filter((n): n is string => !!n))];
  const existing = await tx.feature.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  const byName = new Map(existing.map((f) => [f.name, f.id]));
  let order = existing.length;
  for (const name of wanted) {
    if (byName.has(name)) continue;
    const f = await tx.feature.create({ data: { projectId, name, order: order++ } });
    byName.set(name, f.id);
  }
  return byName;
}

/** Milestone ids by name: new ones get the next "M<n>" label and the latest due of their tasks (or the deadline). */
export async function ensureMilestones(
  tx: Tx,
  project: Pick<Project, "id" | "deadline">,
  seeds: Pick<TaskSeed, "milestone" | "dueAt">[],
): Promise<Map<string, string>> {
  const existing = await tx.milestone.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } });
  const byName = new Map(existing.map((m) => [m.name, m.id]));
  let order = existing.length;
  const names = [...new Set(seeds.map((s) => s.milestone).filter((n): n is string => !!n))].filter((n) => !byName.has(n));
  const dueOf = (name: string) => {
    const dues = seeds.filter((s) => s.milestone === name && s.dueAt).map((s) => new Date(s.dueAt!).getTime());
    return dues.length ? new Date(Math.max(...dues)) : project.deadline;
  };
  // M1, M2… follow the dates, whatever order the model listed them in.
  names.sort((a, b) => dueOf(a).getTime() - dueOf(b).getTime());
  for (const name of names) {
    const dueAt = dueOf(name);
    const m = await tx.milestone.create({ data: { projectId: project.id, label: `M${order + 1}`, name, dueAt, order: order++ } });
    byName.set(name, m.id);
  }
  return byName;
}

export type Placement = { packageId: string | null; ownerId: string | null };

/**
 * Creates the seeds as tasks (numbers from `startNumber`, orders from `orders[i]` or `startOrder + i`), with
 * their 怎么做 and checklist (both marked 「✨ AI 写的」), features and milestones by name, and the option they
 * came from. `dueFallback[i]`: the date for a seed without one. Returns the new ids in seed order.
 */
export async function createSeededTasks(
  tx: Tx,
  project: Pick<Project, "id" | "deadline">,
  seeds: TaskSeed[],
  opts: {
    startNumber: number;
    startOrder: number;
    orders?: number[];
    dueFallback: (Date | null)[];
    choiceOptionIds?: (string | null)[];
    placement?: (Placement | null)[];
  },
): Promise<string[]> {
  if (seeds.length === 0) return [];
  const features = await ensureFeatures(tx, project.id, seeds.map((s) => s.feature));
  const milestones = await ensureMilestones(tx, project, seeds);
  const ids = seeds.map(() => newRowId());
  await tx.task.createMany({
    data: seeds.map((s, i) => {
      const due = s.dueAt ? new Date(s.dueAt) : (opts.dueFallback[i] ?? null);
      const dueAt = due && due > project.deadline ? project.deadline : due;
      return {
        id: ids[i]!,
        projectId: project.id,
        number: opts.startNumber + i,
        order: opts.orders?.[i] ?? opts.startOrder + i,
        title: s.title,
        kind: s.kind,
        points: s.points,
        description: s.description ?? null,
        estimateHours: s.estimateHours,
        dueAt,
        suggestedDueAt: dueAt,
        featureId: s.feature ? (features.get(s.feature) ?? null) : null,
        milestoneId: s.milestone ? (milestones.get(s.milestone) ?? null) : null,
        briefExcerpt: s.excerpt,
        briefFrom: s.briefFrom,
        briefTo: s.briefTo,
        howto: s.howto,
        howtoByAi: s.howto.length > 0,
        checklistByAi: s.checklist.length > 0,
        choiceOptionId: opts.choiceOptionIds?.[i] ?? null,
        packageId: opts.placement?.[i]?.packageId ?? null,
        ownerId: opts.placement?.[i]?.ownerId ?? null,
      };
    }),
  });
  const items = seeds.flatMap((s, i) => s.checklist.map((text, order) => ({ taskId: ids[i]!, text, order })));
  if (items.length) await tx.checklistItem.createMany({ data: items });
  await linkPrereqs(
    tx,
    project.id,
    seeds.map((s, i) => ({ id: ids[i]!, prereqTitle: s.prereqTitle })),
  );
  return ids;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * 前置任务 by title (never trusting ids from the model): each new task waits for the project's task with
 * that title (not itself, never making a cycle). The waiting task is then due no earlier than its
 * prerequisite (前置任务排在前面).
 */
export async function linkPrereqs(tx: Tx, projectId: string, created: { id: string; prereqTitle: string | null }[]): Promise<void> {
  const wanted = created.filter((c) => c.prereqTitle);
  if (wanted.length === 0) return;
  const tasks = await tx.task.findMany({ where: { projectId }, select: { id: true, title: true, prereqTaskId: true, dueAt: true }, orderBy: [{ order: "asc" }, { number: "asc" }] });
  const byTitle = new Map<string, string>();
  for (const t of tasks) if (!byTitle.has(norm(t.title))) byTitle.set(norm(t.title), t.id);
  const prereqOf = new Map(tasks.map((t) => [t.id, t.prereqTaskId]));
  const dueOf = new Map(tasks.map((t) => [t.id, t.dueAt]));
  for (const c of wanted) {
    const target = byTitle.get(norm(c.prereqTitle!));
    if (!target || target === c.id) continue;
    // Walking up from the target must not reach this task.
    let at: string | null | undefined = target;
    let cycle = false;
    for (let steps = 0; at && steps < 500; steps++) {
      if (at === c.id) {
        cycle = true;
        break;
      }
      at = prereqOf.get(at);
    }
    if (cycle) continue;
    prereqOf.set(c.id, target);
    const own = dueOf.get(c.id) ?? null;
    const before = dueOf.get(target) ?? null;
    const later = own && before && before > own ? before : null;
    await tx.task.update({ where: { id: c.id }, data: { prereqTaskId: target, ...(later ? { dueAt: later, suggestedDueAt: later } : {}) } });
    if (later) dueOf.set(c.id, later);
  }
}

/** 「一起定好接口和数据格式」: the meeting the AI puts first when code modules depend on each other. */
export function meetingSeed(meeting: { title: string; why: string }, points: number, locale: Locale): TaskSeed {
  const title = clampText(meeting.title, MAX_AI_TITLE) || (locale === "zh" ? "一起定好接口和数据格式" : "Agree on the interfaces and data formats");
  const why = clampText(meeting.why, MAX_STEP_CHARS);
  return {
    title,
    kind: "MEETING",
    points: Math.max(1, Math.round(points)),
    estimateHours: 1,
    dueAt: null,
    milestone: null,
    feature: null,
    briefFrom: null,
    briefTo: null,
    excerpt: null,
    howto: cleanList(
      [why, locale === "zh" ? "定好之后先用假数据各做各的，接口好了再接起来" : "Then everyone builds against fake data until the real parts are ready"],
      MAX_HOWTO,
      MAX_STEP_CHARS,
    ),
    checklist: locale === "zh" ? ["写下每个接口的输入和输出", "全组都同意这份格式"] : ["Each interface's input and output is written down", "The whole group agreed on the format"],
    prereqTitle: null,
  };
}
