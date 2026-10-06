// 让 AI 重新拆 (M6 follow-up, docs/plan/m6-resplit-spec.md; REQUIREMENTS §13 「项目开始后让 AI 重新拆」). The
// leader of a running project has the AI split the brief again: the saved one, or a new file or text. A
// RESPLIT job reads it with the tasks that stay listed in the prompt and keeps its (brief-checked) answer on
// the job. The proposal is computed again from that answer and the project as it is on every read, so a task
// that started meanwhile simply shows as kept. Nothing changes until the leader applies it: then the unstarted
// tasks are deleted, the new ones created in the packages (shared/planning.ts placeResplit), every task is
// rescaled to exactly 1000, and the group hears TASKS_RESPLIT. A result nobody applies stays until the next
// re-split replaces it (or the leader discards it).
import { apportionAtLeastOne, packageCount, placeResplit } from "../../../shared/planning";
import type {
  AiResplitBrief,
  AiResplitKeptQuestion,
  AiResplitNewTask,
  AiResplitProposal,
  AiResplitQuestion,
  AiResplitState,
  AiResplitTaskRef,
  ChoiceLevel,
  ProjectView,
} from "../../../shared/types";
import type { AiJob, Package, Prisma, Project, Task, TaskKind } from "../generated/prisma/client";
import { isRunning } from "../lib/access";
import { readStored } from "../lib/ai/evidence";
import type { BriefContext, BriefOut } from "../lib/ai/prompts";
import type { AiTier } from "../lib/ai/types";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError, notFound } from "../lib/errors";
import { isLocked } from "../lib/package-state";
import { localDate, spreadDueDates } from "../lib/plan/dates";
import { normalizeBrief } from "../lib/plan/rules";
import { getStorage } from "../lib/storage";
import { callModel } from "./ai-call";
import { analyseBrief, BRIEF_FILE_TYPES, planFrom } from "./ai-brief";
import { maybeEnqueueHowto } from "./ai-howto";
import { enqueueJob, keyProblem, keyWorked, kickAiJobs, markDiscarded, markDone, markFailed, newRowId, stillRunning } from "./ai-job-store";
import type { JobHandler, RunOutcome } from "./ai-jobs";
import { keyUsable, leaderUser } from "./ai-key";
import { capBriefText } from "./brief";
import { questionsOf } from "./choices";
import { bumpPackages, notify, recordEvent } from "./notify";
import { MAX_TASKS } from "./schemas";
import { resolveDueAt } from "./tasks";
import { createSeededTasks, seedsFromJson, type Placement, type TaskSeed } from "./task-seeds";
import { assertPointsTotal, lockAsMember, lockProject, TOTAL_POINTS, TX_OPTIONS, type Tx } from "./tx";
import { loadViewFor } from "./views";

type Reader = Db | Tx;

/** The brief a run reads when the leader gave a new one: its text, or a file the rules can't read (kept in storage). */
type GivenBrief = { text: string; fileName: string | null } | { fileKey: string; fileName: string; mime: string };
type Payload = { brief: GivenBrief | null; lines: number | null; keptCount: number };
type Result = { out?: BriefOut; model?: string; tier?: AiTier; discarded?: string; applied?: string; newBrief?: boolean };

/** What the route hands over: the saved brief, the last run's again, a typed / extracted text, or a file for the AI. */
export type ResplitBriefInput =
  | { kind: "saved" }
  | { kind: "again" }
  | { kind: "text"; text: string; fileName: string | null }
  | { kind: "file"; fileName: string; bytes: Uint8Array; mimeType: string };

const payloadOf = (job: Pick<AiJob, "payload">): Payload => {
  const p = (job.payload ?? {}) as Partial<Payload>;
  return { brief: p.brief ?? null, lines: p.lines ?? null, keptCount: p.keptCount ?? 0 };
};
const resultOf = (job: Pick<AiJob, "result">): Result => (job.result ?? {}) as Result;
const fileKeyOf = (brief: GivenBrief | null): string | null => (brief && "fileKey" in brief ? brief.fileKey : null);

// ─── Which tasks stay ────────────────────────────────────────────────────────

type TaskRow = Task & { _count: { attempts: number; evidence: number } };

async function tasksOf(db: Reader, projectId: string): Promise<TaskRow[]> {
  return db.task.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { number: "asc" }],
    include: { _count: { select: { attempts: true, evidence: true } } },
  });
}

/**
 * Started, handed in or finished work stays: past TODO or started (改选's lock), or with an attempt or a piece
 * of evidence. Everything else (unstarted, the leader's own added tasks too) is replaced.
 */
export const staysOnResplit = (t: Pick<TaskRow, "status" | "startedAt" | "_count">): boolean =>
  isLocked(t) || t._count.attempts > 0 || t._count.evidence > 0;

/** Titles compared case- and space-insensitively (the copy marker 「（第 2 份）」 is part of the title). */
const titleKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Letters, digits and CJK only: option labels and prompts compare equal whatever their punctuation. */
const looseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, "");

// ─── The latest run ──────────────────────────────────────────────────────────

async function latestJob(db: Reader, projectId: string): Promise<AiJob | null> {
  return db.aiJob.findFirst({ where: { projectId, kind: "RESPLIT" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/** The run's answer when it is waiting for the leader (DONE, neither applied nor discarded). */
function pendingOut(job: AiJob | null): BriefOut | null {
  if (!job || job.status !== "DONE") return null;
  const r = resultOf(job);
  return r.out && !r.applied && !r.discarded ? r.out : null;
}

/**
 * Ends every run that isn't applied: the running ones are cancelled, an answer waiting for the leader is
 * discarded. Returns the stored brief files no longer needed (delete them after the commit).
 */
async function supersede(tx: Tx, projectId: string, now: Date, why: string, keepFile: string | null = null): Promise<string[]> {
  const jobs = await tx.aiJob.findMany({
    where: { projectId, kind: "RESPLIT" },
    select: { id: true, status: true, payload: true, result: true, error: true },
  });
  const files: string[] = [];
  for (const job of jobs) {
    const r = resultOf(job);
    if (r.applied || r.discarded) continue;
    if (job.status === "QUEUED" || job.status === "RUNNING") {
      await tx.aiJob.updateMany({
        where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", error: "CANCELLED", leaseUntil: null, updatedAt: now },
      });
    } else if (job.status === "DONE") {
      await tx.aiJob.update({ where: { id: job.id }, data: { result: { discarded: why }, updatedAt: now } });
    } else if (job.error === "CANCELLED") continue;
    else await tx.aiJob.update({ where: { id: job.id }, data: { result: { discarded: why }, updatedAt: now } });
    const key = fileKeyOf(payloadOf(job).brief);
    if (key && key !== keepFile) files.push(key);
  }
  return files;
}

async function deleteFiles(keys: string[]): Promise<void> {
  for (const key of keys) await getStorage().delete(key).catch((e) => console.error("resplit: could not delete a brief file", e));
}

// ─── Start / discard ─────────────────────────────────────────────────────────

/**
 * POST …/ai-resplit: starts a run (the leader of a running project with a usable key; 409 NO_AI_KEY,
 * PROJECT_ENDED, NO_BRIEF). Any run that wasn't applied is replaced. A new file the rules can't read is kept
 * in storage for the AI until the run is applied (it becomes the project's brief) or replaced.
 */
export async function startResplit(db: Db, projectId: string, userId: string, brief: ResplitBriefInput, now = clock.now()): Promise<AiResplitState> {
  let fileKey: string | null = null;
  if (brief.kind === "file") {
    fileKey = `${projectId}/brief/${newRowId().slice(1)}.${BRIEF_FILE_TYPES[brief.mimeType] ?? "bin"}`;
    await getStorage().put(fileKey, brief.bytes, { mimeType: brief.mimeType, maxBytes: brief.bytes.byteLength });
  }
  let stale: string[] = [];
  try {
    stale = await db.$transaction(async (tx) => {
      const { project } = await lockAsMember(tx, projectId, userId, { leader: true });
      if (!keyUsable(await leaderUser(tx, projectId), now)) throw new AppError(409, "NO_AI_KEY", "Save an AI key on the Me page first");
      let given: GivenBrief | null = null;
      let lines: number | null = null;
      if (brief.kind === "text") {
        const stored = capBriefText(normalizeBrief(brief.text), project.locale);
        given = { text: stored.text, fileName: brief.fileName };
        lines = stored.text.split("\n").length;
      } else if (brief.kind === "file") {
        given = { fileKey: fileKey!, fileName: brief.fileName, mime: brief.mimeType };
      } else if (brief.kind === "again") {
        // A cancelled or discarded run's file is gone already: the saved brief then.
        const last = await latestJob(tx, projectId);
        if (last && !resultOf(last).discarded && last.error !== "CANCELLED") ({ brief: given, lines } = payloadOf(last));
      }
      if (!given && !project.briefBytes && !project.briefFileKey) throw new AppError(409, "NO_BRIEF", "This project has no brief; upload or type one");
      if (!given && project.briefBytes) {
        const saved = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { briefText: true } });
        lines = saved.briefText ? saved.briefText.split("\n").length : null;
      }
      const files = await supersede(tx, projectId, now, "replaced", fileKeyOf(given));
      const keptCount = (await tasksOf(tx, projectId)).filter(staysOnResplit).length;
      const payload: Payload = { brief: given, lines, keptCount };
      await enqueueJob(tx, { kind: "RESPLIT", projectId, dedupeKey: `resplit:${projectId}:${newRowId()}`, payload: payload as Prisma.InputJsonValue, now });
      return files;
    }, TX_OPTIONS);
  } catch (err) {
    if (fileKey) await getStorage().delete(fileKey).catch(() => {});
    throw err;
  }
  await deleteFiles(stale);
  kickAiJobs(db);
  return loadResplitState(db, projectId, now);
}

/** DELETE …/ai-resplit: 不要了，保持原样 / 不拆了 / 关闭: the result is dropped (or the run cancelled); nothing else changes. */
export async function discardResplit(db: Db, projectId: string, userId: string, now = clock.now()): Promise<AiResplitState> {
  const files = await db.$transaction(async (tx) => {
    await lockAsMember(tx, projectId, userId, { leader: true, allowEnded: true });
    return supersede(tx, projectId, now, "leader");
  }, TX_OPTIONS);
  await deleteFiles(files);
  return loadResplitState(db, projectId, now);
}

// ─── The proposal ────────────────────────────────────────────────────────────

/** A new task in the making: its seed (points on the proposal's scale) and the 选择题 option it belongs to. */
type Candidate = { key: string; seed: TaskSeed; dueAt: Date; optionId: string | null };
type PlanQuestion = ReturnType<typeof planFrom>["questions"][number];
type QuestionRow = Awaited<ReturnType<typeof questionsOf>>[number];

type Built = {
  kept: TaskRow[];
  removed: TaskRow[];
  /** Tasks outside new questions: the plan's own, then the existing questions' picked options'. */
  base: Candidate[];
  newQuestions: { key: string; q: PlanQuestion; options: { o: PlanQuestion["options"][number]; tasks: Candidate[] }[] }[];
  keptQuestions: AiResplitKeptQuestion[];
  /** Existing options whose saved tasks (tasksJson) the AI's answer refreshes. */
  refresh: { optionId: string; seeds: TaskSeed[] }[];
  packages: Pick<Package, "id" | "index" | "ownerId">[];
};

/** Which existing question an AI question is: the same kind with at least half the option labels in common, or the same prompt. */
function matchQuestions(ai: PlanQuestion[], existing: QuestionRow[]): Map<number, QuestionRow> {
  const out = new Map<number, QuestionRow>();
  const taken = new Set<string>();
  ai.forEach((q, i) => {
    let best: { row: QuestionRow; score: number } | null = null;
    for (const row of existing) {
      if (taken.has(row.id) || row.type !== q.type) continue;
      const labels = new Set(row.options.map((o) => looseKey(o.label)));
      const common = q.options.filter((o) => labels.has(looseKey(o.label))).length;
      const enough = common >= Math.max(1, Math.ceil(Math.min(labels.size, q.options.length) / 2));
      const score = enough ? common : looseKey(row.prompt) === looseKey(q.prompt) ? 0.5 : -1;
      if (score > 0 && (!best || score > best.score)) best = { row, score };
    }
    if (best) {
      out.set(i, best.row);
      taken.add(best.row.id);
    }
  });
  return out;
}

/**
 * The answer against the project as it is now: what stays, what goes, and the new tasks with points on the
 * proposal's scale (the new tasks share what the kept ones leave of 1000, so without edits nothing kept moves).
 * Kept titles are dropped from the new tasks. An existing 选择题 keeps its picks: the AI's matching options give
 * their tasks (an option the answer doesn't have, or a question it doesn't mention, makes its saved tasks again).
 */
function build(project: Project, rows: { tasks: TaskRow[]; packages: Built["packages"]; questions: QuestionRow[] }, out: BriefOut, lines: string[], now: Date): Built {
  const kept = rows.tasks.filter(staysOnResplit);
  const removed = rows.tasks.filter((t) => !staysOnResplit(t));
  const keptTitles = new Set(kept.map((t) => titleKey(t.title)));
  const fresh = (s: TaskSeed) => !keptTitles.has(titleKey(s.title));
  const plan = planFrom(out, project, lines, now);
  const matched = matchQuestions(plan.questions, rows.questions);

  // Raw seeds first (planFrom's scale: the AI's plan with its recommended options = 1000).
  type Raw = { key: string; seed: TaskSeed; optionId: string | null };
  const base: Raw[] = plan.base.map((seed, i) => ({ key: `b${i}`, seed, optionId: null })).filter((x) => fresh(x.seed));
  const refresh: Built["refresh"] = [];
  const keptQuestions: AiResplitKeptQuestion[] = [];
  const matchedOf = new Map<string, PlanQuestion>();
  for (const [i, row] of matched) matchedOf.set(row.id, plan.questions[i]!);
  rows.questions.forEach((row, qi) => {
    const ai = matchedOf.get(row.id) ?? null;
    const aiOption = (label: string) => ai?.options.find((o) => looseKey(o.label) === looseKey(label)) ?? null;
    for (const o of row.options) {
      const counterpart = aiOption(o.label);
      if (counterpart) refresh.push({ optionId: o.id, seeds: counterpart.seeds });
      if (!o.picked) continue;
      const seeds = counterpart ? counterpart.seeds : seedsFromJson(o.tasksJson);
      seeds.forEach((seed, j) => fresh(seed) && base.push({ key: `p${qi}.${o.key}.${j}`, seed, optionId: o.id }));
    }
    const picked = row.options.filter((o) => o.picked);
    if (picked.length) keptQuestions.push({ questionId: row.id, prompt: row.prompt, pickedKeys: picked.map((o) => o.key), pickedLabels: picked.map((o) => o.label) });
  });
  const unmatched = plan.questions.filter((_, i) => !matched.has(i));
  const newRaw = unmatched.map((q, qi) => ({
    key: `n${qi}`,
    q,
    options: q.options.map((o) => ({ o, tasks: o.seeds.map((seed, j) => ({ key: `n${qi}.${o.key}.${j}`, seed, optionId: null })).filter((x) => fresh(x.seed)) })),
  }));

  // The scale: the plan's tasks plus the recommended new options share what the kept tasks leave.
  const keptSum = kept.reduce((s, t) => s + t.points, 0);
  const chosen = [...base, ...newRaw.flatMap((n) => n.options.filter((x) => x.o.recommended).flatMap((x) => x.tasks))];
  const room = Math.max(TOTAL_POINTS - keptSum, chosen.length);
  const rawSum = chosen.reduce((s, x) => s + x.seed.points, 0);
  const factor = rawSum > 0 ? room / rawSum : 1;
  const exact = new Map<string, number>();
  apportionAtLeastOne(chosen.map((x) => x.seed.points), room).forEach((p, i) => exact.set(chosen[i]!.key, p));
  const scaled = (x: Raw): TaskSeed => ({ ...x.seed, points: exact.get(x.key) ?? Math.max(1, Math.round(x.seed.points * factor)) });

  // Dates: the model's, else spread evenly from now (the plan's tasks together, each option on its own).
  const dated = (list: Raw[]): Candidate[] => {
    const dues = spreadDueDates(list.length, now, project.deadline, project.timezone);
    return list.map((x, i) => {
      const seed = scaled(x);
      return { key: x.key, seed, dueAt: seed.dueAt ? new Date(seed.dueAt) : dues[i]!, optionId: x.optionId };
    });
  };
  return {
    kept,
    removed,
    base: dated(base),
    newQuestions: newRaw.map((n) => ({ key: n.key, q: n.q, options: n.options.map((x) => ({ o: x.o, tasks: dated(x.tasks) })) })),
    keptQuestions,
    refresh: refresh.map((r) => ({ optionId: r.optionId, seeds: r.seeds.map((seed) => ({ ...seed, points: Math.max(1, Math.round(seed.points * factor)) })) })),
    packages: rows.packages,
  };
}

const placementInput = (b: Built, added: { points: number; feature: string | null }[]) => {
  const indexOf = new Map(b.packages.map((p) => [p.id, p.index]));
  const ref = (t: TaskRow) => ({ points: t.points, packageIndex: t.packageId ? (indexOf.get(t.packageId) ?? null) : null });
  return {
    packages: b.packages.map((p) => ({ index: p.index, ownerMemberId: p.ownerId })),
    kept: b.kept.map(ref),
    removed: b.removed.map(ref),
    added,
  };
};

function toProposal(b: Built, version: number): AiResplitProposal {
  const recommended = b.newQuestions.flatMap((n) => n.options.filter((x) => x.o.recommended).flatMap((x) => x.tasks));
  const placed = placeResplit(placementInput(b, [...b.base, ...recommended].map((c) => ({ points: c.seed.points, feature: c.seed.feature }))));
  const where = new Map([...b.base, ...recommended].map((c, i) => [c.key, placed.added[i]!]));
  const indexOf = new Map(b.packages.map((p) => [p.id, p.index]));
  const ref = (t: TaskRow): AiResplitTaskRef => ({
    taskId: t.id,
    title: t.title,
    kind: t.kind,
    points: t.points,
    packageIndex: t.packageId ? (indexOf.get(t.packageId) ?? null) : null,
    ownerMemberId: t.ownerId,
  });
  const view = (c: Candidate): AiResplitNewTask => ({
    key: c.key,
    title: c.seed.title,
    kind: c.seed.kind,
    points: c.seed.points,
    dueAt: c.dueAt.toISOString(),
    feature: c.seed.feature,
    aiWritten: c.seed.howto.length > 0 || c.seed.checklist.length > 0,
    packageIndex: where.get(c.key)?.packageIndex ?? null,
    ownerMemberId: where.get(c.key)?.ownerMemberId ?? null,
  });
  const newQuestions: AiResplitQuestion[] = b.newQuestions.map((n, order) => ({
    id: n.key,
    type: n.q.type,
    prompt: n.q.prompt,
    quote: n.q.quote,
    pickCount: n.q.pickCount,
    order,
    options: n.options.map(({ o, tasks }) => ({
      key: o.key,
      label: o.label,
      summary: o.summary,
      hours: o.hours,
      material: o.material as ChoiceLevel,
      difficulty: o.difficulty as ChoiceLevel,
      pros: o.pros,
      cons: o.cons,
      recommended: o.recommended,
      picked: false,
      taskCount: tasks.length,
      points: tasks.reduce((s, c) => s + c.seed.points, 0),
      taskIds: [],
      lockedBy: null,
      tasks: tasks.map(view),
    })),
  }));
  return {
    kept: b.kept.map((t, i) => ({ ...ref(t), pointsAfter: placed.keptPoints[i]! })),
    removed: b.removed.map(ref),
    added: b.base.map(view),
    newQuestions,
    keptQuestions: b.keptQuestions,
    packages: b.packages.map((p, i) => ({
      index: p.index,
      packageId: p.id,
      ownerMemberId: p.ownerId,
      pointsBefore: placed.packages[i]!.pointsBefore,
      pointsAfter: placed.packages[i]!.pointsAfter,
    })),
    version,
  };
}

/** The brief lines the answer's line numbers point into: the given text, else the project's saved one. */
async function linesFor(db: Reader, projectId: string, payload: Payload): Promise<string[]> {
  if (payload.brief) return "text" in payload.brief ? payload.brief.text.split("\n") : [];
  const p = await db.project.findUnique({ where: { id: projectId }, select: { briefText: true } });
  return (p?.briefText ?? "").split("\n");
}

async function buildFor(db: Reader, project: Project, job: AiJob, out: BriefOut, now: Date): Promise<Built> {
  const [tasks, packages, questions, lines] = await Promise.all([
    tasksOf(db, project.id),
    db.package.findMany({ where: { projectId: project.id }, orderBy: { index: "asc" }, select: { id: true, index: true, ownerId: true } }),
    questionsOf(db, project.id),
    linesFor(db, project.id, payloadOf(job)),
  ]);
  return build(project, { tasks, packages, questions }, out, lines, now);
}

/** GET …/ai-resplit: the latest run as the leader sees it (AiResplitState). */
export async function loadResplitState(db: Db, projectId: string, now = clock.now()): Promise<AiResplitState> {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const [job, tasks, leader, lastNewBrief] = await Promise.all([
    latestJob(db, projectId),
    tasksOf(db, projectId),
    leaderUser(db, projectId),
    db.aiJob.findFirst({
      where: { projectId, kind: "RESPLIT", result: { path: ["newBrief"], equals: true } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { updatedAt: true },
    }),
  ]);
  const keptCount = tasks.filter(staysOnResplit).length;
  const hasBrief = !!project.briefBytes || !!project.briefFileKey;
  const state: AiResplitState = {
    status: "none",
    provider: leader?.aiProvider ?? null,
    error: null,
    waitingUntil: null,
    brief: null,
    keptCount,
    replaceCount: tasks.length - keptCount,
    savedBrief: hasBrief
      ? { fileName: project.briefFileName, savedAt: (lastNewBrief?.updatedAt ?? project.createdAt).toISOString(), fromResplit: !!lastNewBrief }
      : null,
    proposal: null,
  };
  if (!job) return state;
  const payload = payloadOf(job);
  const brief: AiResplitBrief = {
    source: payload.brief ? "NEW" : "SAVED",
    fileName: payload.brief ? payload.brief.fileName : project.briefFileName,
    lines: payload.lines,
  };
  const r = resultOf(job);
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    const waiting = job.status === "QUEUED" && job.runAfter > now;
    return { ...state, status: "running", brief, keptCount: payload.keptCount, waitingUntil: waiting ? job.runAfter.toISOString() : null };
  }
  if (job.status === "FAILED") {
    if (job.error === "CANCELLED" || r.discarded) return state;
    return { ...state, status: "failed", brief, error: (job.error as AiResplitState["error"]) ?? "ERROR" };
  }
  const out = pendingOut(job);
  if (!out) return state;
  const built = await buildFor(db, project, job, out, now);
  return { ...state, status: "done", brief, proposal: toProposal(built, project.packagesVersion) };
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export type ResplitApplyBody = {
  version: number;
  edits?: Record<string, { title?: string; kind?: TaskKind; points?: number; dueAt?: string }>;
  deleted?: string[];
  added?: { title: string; kind: TaskKind; points: number; dueAt?: string | null }[];
  answers?: Record<string, string[]>;
};

/** A task to create: its seed with final points, the date it gets, and where it goes. */
type Planned = { key: string | null; seed: TaskSeed; dueAt: Date | null; suggestedDue: Date | null; leaderDue: boolean; optionKey: string | null; optionId: string | null; byLeader: boolean };

/**
 * POST …/ai-resplit/apply (「确认，换成新任务」): with the review page's edits, deletions, additions and the new
 * questions' answers. The unstarted tasks are deleted, the new ones created in their packages (owned by the
 * package's owner), everything is rescaled to 1000; a new brief becomes the project's. 409 STALE_PREVIEW when
 * the packages version moved, CHOICES_REQUIRED when a new question isn't answered exactly; 404 without a result.
 */
export async function applyResplit(db: Db, projectId: string, userId: string, input: ResplitApplyBody, now = clock.now()): Promise<ProjectView> {
  const after = await db.$transaction(async (tx) => {
    const { project, member: leader } = await lockAsMember(tx, projectId, userId, { leader: true });
    if (input.version !== project.packagesVersion) throw new AppError(409, "STALE_PREVIEW", "Something changed since the review; look again");
    const job = await latestJob(tx, projectId);
    const out = pendingOut(job);
    if (!job || !out) throw notFound("Re-split result");
    const built = await buildFor(tx, project, job, out, now);

    // Every new question answered with exactly pickCount of its options.
    const open = built.newQuestions.filter((n) => {
      const picks = input.answers?.[n.key] ?? [];
      const keys = new Set(n.q.options.map((o) => o.key));
      return new Set(picks).size !== n.q.pickCount || picks.length !== n.q.pickCount || picks.some((k) => !keys.has(k));
    });
    if (open.length) throw new AppError(409, "CHOICES_REQUIRED", "Answer the new choice questions first", { questionIds: open.map((n) => n.key) });

    // The review's list, in the order the page shows it: the plan's, the picked new options', the leader's own.
    const candidates: (Candidate & { optionKey: string | null })[] = [
      ...built.base.map((c) => ({ ...c, optionKey: null })),
      ...built.newQuestions.flatMap((n) =>
        n.options.filter((x) => input.answers![n.key]!.includes(x.o.key)).flatMap((x) => x.tasks.map((c) => ({ ...c, optionKey: `${n.key}.${x.o.key}` }))),
      ),
    ];
    const known = new Set([...built.base, ...built.newQuestions.flatMap((n) => n.options.flatMap((x) => x.tasks))].map((c) => c.key));
    const unknown = [...Object.keys(input.edits ?? {}), ...(input.deleted ?? [])].filter((k) => !known.has(k));
    if (unknown.length) throw new AppError(400, "VALIDATION", "Unknown task in the edits", { keys: unknown });
    const deleted = new Set(input.deleted ?? []);
    const planned: Planned[] = candidates
      .filter((c) => !deleted.has(c.key))
      .map((c) => {
        const edit = input.edits?.[c.key] ?? {};
        const due = edit.dueAt ? resolveDueAt(edit.dueAt, project) : null;
        return {
          key: c.key,
          seed: { ...c.seed, title: edit.title ?? c.seed.title, kind: edit.kind ?? c.seed.kind, points: edit.points ?? c.seed.points, dueAt: null },
          dueAt: due ?? c.dueAt,
          suggestedDue: c.dueAt,
          leaderDue: !!due,
          optionKey: c.optionKey,
          optionId: c.optionId,
          byLeader: false,
        };
      });
    for (const a of input.added ?? []) {
      const due = a.dueAt ? resolveDueAt(a.dueAt, project) : null;
      planned.push({
        key: null,
        seed: { title: a.title, kind: a.kind, points: a.points, estimateHours: null, dueAt: null, milestone: null, feature: null, briefFrom: null, briefTo: null, excerpt: null, howto: [], checklist: [], prereqTitle: null },
        dueAt: due,
        // As 加任务: no suggestion of the system's own.
        suggestedDue: null,
        leaderDue: !!due,
        optionKey: null,
        optionId: null,
        byLeader: true,
      });
    }
    if (built.kept.length + planned.length === 0) throw new AppError(409, "PLAN_EMPTY", "Keep at least one task");
    if (built.kept.length + planned.length > MAX_TASKS) throw new AppError(400, "VALIDATION", `A project can have at most ${MAX_TASKS} tasks`);
    // The proposal's tasks stay in the packages the review showed them in (deleting or adding on the review
    // page doesn't move the others, 2026-10-02); the leader's own and other options' tasks are placed fresh.
    const recommended = built.newQuestions.flatMap((n) => n.options.filter((x) => x.o.recommended).flatMap((x) => x.tasks));
    const shown = [...built.base, ...recommended];
    const shownPlaced = placeResplit(placementInput(built, shown.map((c) => ({ points: c.seed.points, feature: c.seed.feature }))));
    const pinOf = new Map(shown.map((c, i) => [c.key, shownPlaced.added[i]!.packageIndex]));
    // Kept points move only when the leader changed some points (2026-10-02).
    const keepKept = !Object.values(input.edits ?? {}).some((e) => e.points !== undefined);
    const placed = placeResplit({
      ...placementInput(built, planned.map((p) => ({ points: p.seed.points, feature: p.seed.feature, packageIndex: p.key ? (pinOf.get(p.key) ?? null) : null }))),
      keepKept,
    });

    // The unstarted tasks go; the kept ones take their rescaled points (one updateMany per value).
    if (built.removed.length) await tx.task.deleteMany({ where: { id: { in: built.removed.map((t) => t.id) } } });
    const byPoints = new Map<number, string[]>();
    built.kept.forEach((t, i) => {
      const next = placed.keptPoints[i]!;
      if (next !== t.points) byPoints.set(next, [...(byPoints.get(next) ?? []), t.id]);
    });
    for (const [points, ids] of byPoints) await tx.task.updateMany({ where: { id: { in: ids } }, data: { points } });

    // New 选择题 first (their tasks point at the options), the matched ones' saved tasks refreshed.
    const optionIdOf = new Map<string, string>();
    const lastOrder = await tx.choiceQuestion.aggregate({ where: { projectId }, _max: { order: true } });
    for (const [i, n] of built.newQuestions.entries()) {
      const picks = input.answers![n.key]!;
      const created = await tx.choiceQuestion.create({
        data: {
          projectId,
          prompt: n.q.prompt,
          quote: n.q.quote,
          type: n.q.type,
          pickCount: n.q.pickCount,
          order: (lastOrder._max.order ?? -1) + 1 + i,
          options: {
            create: n.options.map(({ o, tasks }) => ({
              key: o.key,
              label: o.label,
              summary: o.summary,
              hours: o.hours,
              material: o.material,
              difficulty: o.difficulty,
              pros: o.pros,
              cons: o.cons,
              recommended: o.recommended,
              picked: picks.includes(o.key),
              order: o.order,
              tasksJson: tasks.map((c) => c.seed) as Prisma.InputJsonValue,
            })),
          },
        },
        include: { options: { select: { id: true, key: true } } },
      });
      for (const o of created.options) optionIdOf.set(`${n.key}.${o.key}`, o.id);
    }
    for (const r of built.refresh) await tx.choiceOption.update({ where: { id: r.optionId }, data: { tasksJson: r.seeds as Prisma.InputJsonValue } });

    const agg = await tx.task.aggregate({ where: { projectId }, _max: { number: true, order: true } });
    const packageIdAt = new Map(built.packages.map((p) => [p.index, p.id]));
    const placement: Placement[] = placed.added.map((a) => ({ packageId: a.packageIndex === null ? null : (packageIdAt.get(a.packageIndex) ?? null), ownerId: a.ownerMemberId }));
    const ids = await createSeededTasks(
      tx,
      project,
      planned.map((p, i) => ({ ...p.seed, points: placed.added[i]!.points })),
      {
        startNumber: (agg._max.number ?? 0) + 1,
        startOrder: (agg._max.order ?? -1) + 1,
        dueFallback: planned.map((p) => p.dueAt),
        choiceOptionIds: planned.map((p) => p.optionId ?? (p.optionKey ? (optionIdOf.get(p.optionKey) ?? null) : null)),
        placement,
      },
    );
    // A date the leader typed is theirs (a later deadline change gives it back); the AI's stays the suggestion.
    for (const [i, p] of planned.entries()) {
      if (p.leaderDue) await tx.task.update({ where: { id: ids[i]! }, data: { leaderDueAt: p.dueAt, suggestedDueAt: p.suggestedDue } });
    }

    // A new brief becomes the project's; the kept tasks' line ranges pointed into the old one.
    const payload = payloadOf(job);
    let oldFile: string | null = null;
    if (payload.brief) {
      const text = "text" in payload.brief ? payload.brief.text : null;
      oldFile = project.briefFileKey;
      await tx.project.update({
        where: { id: projectId },
        data: {
          briefText: text,
          briefBytes: text ? Buffer.byteLength(text, "utf8") : null,
          briefFileName: payload.brief.fileName,
          briefFileKey: "fileKey" in payload.brief ? payload.brief.fileKey : null,
          briefFileMime: "fileKey" in payload.brief ? payload.brief.mime : null,
        },
      });
      if (built.kept.length) await tx.task.updateMany({ where: { id: { in: built.kept.map((t) => t.id) } }, data: { briefFrom: null, briefTo: null } });
    }
    await tx.aiJob.update({ where: { id: job.id }, data: { result: { ...resultOf(job), applied: now.toISOString(), newBrief: !!payload.brief } as Prisma.InputJsonValue, updatedAt: now } });

    // Everyone else hears it; 跟我有关 when their own package changed.
    const counts = { kept: built.kept.length, removed: built.removed.length, added: planned.length };
    const members = await tx.member.findMany({ where: { projectId, leftAt: null, removed: false }, select: { id: true, userId: true } });
    const leaderName = (await tx.user.findUniqueOrThrow({ where: { id: leader.userId }, select: { name: true } })).name;
    for (const m of members) {
      if (m.id === leader.id) continue;
      const pkg = built.packages.find((p) => p.ownerId === m.id);
      let mine = null;
      if (pkg) {
        const removed = built.removed.filter((t) => t.packageId === pkg.id).length;
        const added = placed.added.filter((a) => a.packageIndex === pkg.index).length;
        const points = placed.packages.find((p) => p.index === pkg.index)!.pointsAfter;
        if (removed > 0 || added > 0) mine = { packageIndex: pkg.index, removed, added, points };
      }
      await notify(tx, {
        userIds: [m.userId],
        projectId,
        type: "TASKS_RESPLIT",
        audience: "GROUP",
        mine: mine !== null,
        payload: { leader: { memberId: leader.id, name: leaderName }, ...counts, mine },
        now,
      });
    }
    await recordEvent(tx, { projectId, actorId: leader.id, type: "TASKS_RESPLIT", payload: counts, now });
    await bumpPackages(tx, projectId);
    await assertPointsTotal(tx, projectId);

    // The leader's own new tasks get their 怎么做 from the AI, as 加任务 does.
    let howto = false;
    for (const [i, p] of planned.entries()) if (p.byLeader && (await maybeEnqueueHowto(tx, projectId, ids[i]!, now))) howto = true;
    return { howto, oldFile: oldFile !== fileKeyOf(payload.brief) ? oldFile : null };
  }, TX_OPTIONS);
  if (after.oldFile) await deleteFiles([after.oldFile]);
  if (after.howto) kickAiJobs(db);
  return loadViewFor(db, projectId, userId, now);
}

// ─── The job ─────────────────────────────────────────────────────────────────

export const resplitHandler: JobHandler = {
  async run(db, job, now): Promise<RunOutcome> {
    const project = await db.project.findUnique({
      where: { id: job.projectId },
      select: { id: true, status: true, deletedAt: true, locale: true, deadline: true, timezone: true, teamSize: true, leaderManages: true, name: true, briefText: true, briefFileKey: true, briefFileMime: true, briefFileName: true },
    });
    if (!project || project.deletedAt || !isRunning(project)) {
      await markDiscarded(db, job.id, "not running", now);
      return { kind: "done" };
    }
    const leader = await leaderUser(db, project.id);
    if (!keyUsable(leader, now)) return { kind: "fail", reason: leader?.aiProvider ? "INVALID" : "NO_KEY", retry: false };

    const given = payloadOf(job).brief;
    let text: string | null;
    let file: { bytes: Uint8Array; mimeType: string; name: string } | null = null;
    if (given) {
      text = "text" in given ? given.text : null;
      const bytes = "fileKey" in given ? await readStored(given.fileKey).catch(() => null) : null;
      if (bytes && "fileKey" in given) file = { bytes, mimeType: given.mime, name: given.fileName };
    } else {
      text = project.briefText;
      const bytes = project.briefFileKey ? await readStored(project.briefFileKey).catch(() => null) : null;
      if (bytes) file = { bytes, mimeType: project.briefFileMime ?? "application/pdf", name: project.briefFileName ?? "brief" };
    }
    if (!text && !file) return { kind: "fail", reason: "ERROR", retry: false, detail: "no brief" };

    const keep = (await tasksOf(db, project.id)).filter(staysOnResplit).map((t) => ({ title: t.title, points: t.points }));
    const ctx: BriefContext = {
      locale: project.locale,
      today: localDate(now, project.timezone),
      deadline: localDate(project.deadline, project.timezone),
      timezone: project.timezone,
      teamSize: project.teamSize,
      packageCount: packageCount(project.teamSize, project.leaderManages),
      projectName: project.name,
    };
    const res = await analyseBrief((req) => callModel(db, leader, req, now), { ctx, text, file, keep });
    if (res.kind === "wait" || res.kind === "fail") return res;
    if (res.notes.length) console.info(`ai: resplit ${project.id} checks: ${res.notes.join("; ")}`);

    await db.$transaction(async (tx) => {
      const locked = await lockProject(tx, project.id);
      if (!isRunning(locked) || locked.deletedAt || !(await stillRunning(tx, job))) {
        await markDiscarded(tx, job.id, "replaced", now);
        return;
      }
      await markDone(tx, job.id, { out: res.data, model: res.model, tier: res.tier } as Prisma.InputJsonValue, now);
      if (leader) {
        await keyWorked(tx, leader.id, now);
        await notify(tx, { userIds: [leader.id], projectId: project.id, type: "AI_RESPLIT_READY", audience: "ONLY_LEADER", payload: {}, now });
      }
    }, TX_OPTIONS);
    return { kind: "done" };
  },

  async fail(db, job, reason, now, detail) {
    const leader = await leaderUser(db, job.projectId);
    await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: job.projectId }, select: { id: true } });
      if (project) await lockProject(tx, project.id);
      // Cancelled meanwhile (a new run, 不拆了): nothing to tell.
      const row = await tx.aiJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (row?.status !== "QUEUED" && row?.status !== "RUNNING") return;
      await markFailed(tx, job.id, reason, now, detail);
      if (leader && (reason === "QUOTA" || reason === "INVALID")) await keyProblem(tx, leader, reason, now, false);
      // Nothing changed; the leader sees why (and 再试一次) on the re-split screen.
      if (leader && project) {
        await notify(tx, {
          userIds: [leader.id],
          projectId: project.id,
          type: "AI_RESPLIT_FAILED",
          audience: "ONLY_LEADER",
          payload: { reason, provider: leader.aiProvider ?? null },
          now,
        });
      }
    }, TX_OPTIONS);
  },
};
