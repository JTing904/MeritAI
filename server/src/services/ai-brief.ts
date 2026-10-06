// The AI reads the brief (M6 spec §4, wizard step 3). With a usable leader key, POST …/brief saves the brief
// and enqueues a BRIEF job instead of running the free rules; the draft's `analysis` shows its progress. The
// job's answer replaces the draft's tasks, features, milestones and 选择题 in one transaction under the lock.
import type { BriefAnalysis, BriefAnalysisStep, BriefResult } from "../../../shared/types";
import { apportion, packageCount } from "../../../shared/planning";
import type { AiJob, Project } from "../generated/prisma/client";
import { applyRepairs, checkBrief, gradedParts, languageRepairs, recommendedOptions, referenceTasks, tooFewTasks } from "../lib/ai/brief-check";
import { newNonce } from "../lib/ai/fence";
import { briefFixParts, briefFixSystem, BriefFixOutSchema, briefParts, briefSystem, BriefOutSchema, type BriefContext, type BriefOut } from "../lib/ai/prompts";
import type { AiTier } from "../lib/ai/types";
import { clampNumber, clampText, cleanList } from "../lib/ai/sanitize";
import { readStored } from "../lib/ai/evidence";
import { clock } from "../lib/clock";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { localDate, spreadDueDates } from "../lib/plan/dates";
import { normalizeBrief } from "../lib/plan/rules";
import { getStorage } from "../lib/storage";
import { callModel, type CallOutcome, type CallRequest } from "./ai-call";
import { enqueueJob, keyProblem, keyWorked, kickAiJobs, markDiscarded, markDone, markFailed, newRowId, stillRunning } from "./ai-job-store";
import type { JobHandler, RunOutcome } from "./ai-jobs";
import { keyUsable, leaderUser } from "./ai-key";
import { applyBrief, briefFailure, capBriefText } from "./brief";
import { createSeededTasks, meetingSeed, seedFromAi, weightOf, type TaskSeed } from "./task-seeds";
import { lockDraft, lockProject, TX_OPTIONS, type Tx } from "./tx";
import { loadDraftView } from "./views";

/** At most this many tasks, questions, options per question and tasks per option are kept from an answer. */
const MAX_TASKS = 60;
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 8;
// Room for one individual task per member (up to 8) plus the option's shared work (data, comparison).
const MAX_OPTION_TASKS = 12;

/** Types the AI can take as a file when the rules can't read the brief (a photo, a scanned PDF). */
export const BRIEF_FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** Whether the draft's leader can have the AI read a brief now. */
export async function aiCanReadBrief(db: Db, projectId: string, now = clock.now()): Promise<boolean> {
  return keyUsable(await leaderUser(db, projectId), now);
}

/** Ends the draft's BRIEF jobs that haven't finished (a new brief, the rules, or a manual plan replaces them). */
export async function cancelBriefJobs(tx: Tx, projectId: string, now: Date): Promise<void> {
  await tx.aiJob.updateMany({
    where: { projectId, kind: "BRIEF", status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: "CANCELLED", leaseUntil: null, updatedAt: now },
  });
}

/**
 * Saves the brief (typed or extracted text, or a file the rules can't read) for the AI and enqueues the
 * job. The draft's tasks stay until the answer replaces them. Answers like POST …/brief does.
 */
export async function startBriefAnalysis(
  db: Db,
  projectId: string,
  brief: { text: string | null; fileName: string | null; file: { bytes: Uint8Array; mimeType: string } | null },
  now = clock.now(),
): Promise<BriefResult> {
  let fileKey: string | null = null;
  if (brief.file) {
    fileKey = `${projectId}/brief/${newRowId().slice(1)}.${BRIEF_FILE_TYPES[brief.file.mimeType] ?? "bin"}`;
    await getStorage().put(fileKey, brief.file.bytes, { mimeType: brief.file.mimeType, maxBytes: brief.file.bytes.byteLength });
  }
  let oldKey: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const project = await lockDraft(tx, projectId);
      oldKey = project.briefFileKey;
      const stored = brief.text ? capBriefText(normalizeBrief(brief.text), project.locale) : null;
      await cancelBriefJobs(tx, projectId, now);
      await tx.project.update({
        where: { id: projectId },
        data: {
          briefText: stored?.text ?? null,
          briefBytes: stored ? Buffer.byteLength(stored.text, "utf8") : null,
          briefFileName: brief.fileName,
          briefFileKey: fileKey,
          briefFileMime: brief.file?.mimeType ?? null,
          draftStep: Math.max(project.draftStep, 3),
        },
      });
      await enqueueJob(tx, {
        kind: "BRIEF",
        projectId,
        dedupeKey: `brief:${projectId}:${newRowId()}`,
        payload: { lines: stored ? stored.text.split("\n").length : null },
        now,
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (fileKey) await getStorage().delete(fileKey).catch(() => {});
    throw err;
  }
  if (oldKey && oldKey !== fileKey) await getStorage().delete(oldKey).catch((e) => console.error("brief: could not delete an old file", e));
  kickAiJobs(db);
  return { ok: true, source: "AI", method: "AI", found: 0, draft: await loadDraftView(db, projectId, now) };
}

/** 再试一次: a new BRIEF job for the saved brief (409 NO_AI_KEY without a usable key, NO_BRIEF without a brief). */
export async function retryBriefAnalysis(db: Db, projectId: string, now = clock.now()): Promise<void> {
  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    if (!keyUsable(await leaderUser(tx, projectId), now)) throw new AppError(409, "NO_AI_KEY", "Save an AI key on the Me page first");
    if (!project.briefBytes && !project.briefFileKey) throw new AppError(409, "NO_BRIEF", "Upload or type the brief first");
    const running = await tx.aiJob.count({ where: { projectId, kind: "BRIEF", status: { in: ["QUEUED", "RUNNING"] } } });
    if (running > 0) return;
    await enqueueJob(tx, { kind: "BRIEF", projectId, dedupeKey: `brief:${projectId}:${newRowId()}`, payload: { lines: null }, now });
  }, TX_OPTIONS);
  kickAiJobs(db);
}

/** 不等了，改用免费规则 / 改用免费规则拆: stops the AI and runs the free rules on the saved brief. */
export async function briefWithRules(db: Db, projectId: string, now = clock.now()): Promise<BriefResult> {
  const project = await db.$transaction(async (tx) => {
    const p = await lockDraft(tx, projectId);
    await cancelBriefJobs(tx, projectId, now);
    return tx.project.findUniqueOrThrow({ where: { id: p.id }, select: { briefText: true, briefFileName: true, briefFileKey: true } });
  }, TX_OPTIONS);
  if (!project.briefText) return briefFailure(project.briefFileKey ? "UNREADABLE" : "EMPTY", project.briefFileName, null);
  return applyBrief(db, projectId, { text: project.briefText, fileName: project.briefFileName, sizeBytes: null, typed: project.briefFileName === null }, now);
}

// ─── The draft's analysis (DraftView.analysis) ───────────────────────────────

type JobResult = { taskCount?: number; questionCount?: number; totalHours?: number; discarded?: string };

export function toAnalysis(job: Pick<AiJob, "status" | "error" | "result" | "payload" | "runAfter" | "tries"> | null, provider: BriefAnalysis["provider"], now: Date): BriefAnalysis | null {
  if (!job) return null;
  const result = (job.result ?? {}) as JobResult;
  const lines = (job.payload as { lines?: number | null } | null)?.lines ?? null;
  if (job.status === "DONE" && result.discarded) return null;
  const step = (key: BriefAnalysisStep["key"], state: BriefAnalysisStep["state"]): BriefAnalysisStep => ({ key, state });
  const base = { provider, error: null, waitingUntil: null, taskCount: null, questionCount: null, totalHours: null, lines };
  if (job.status === "DONE") {
    return {
      ...base,
      status: "done",
      steps: [step("READ", "done"), step("TASKS", "done"), step("CHOICES", "done"), step("ESTIMATE", "done")],
      taskCount: result.taskCount ?? null,
      questionCount: result.questionCount ?? null,
      totalHours: result.totalHours ?? null,
    };
  }
  if (job.status === "FAILED") {
    return { ...base, status: "failed", steps: [step("READ", "done"), step("TASKS", "waiting"), step("CHOICES", "waiting"), step("ESTIMATE", "waiting")], error: (job.error as BriefAnalysis["error"]) ?? "ERROR" };
  }
  const waiting = job.status === "QUEUED" && job.runAfter > now;
  return {
    ...base,
    status: "running",
    steps: [step("READ", "done"), step("TASKS", "running"), step("CHOICES", "waiting"), step("ESTIMATE", "waiting")],
    waitingUntil: waiting ? job.runAfter.toISOString() : null,
  };
}

// ─── The analysis (model calls + brief-check) ────────────────────────────────

/** Makes one model call (the job: callModel with the leader's key; scripts/eval-brief.ts: a chosen model). */
export type BriefCaller = <T>(req: CallRequest<T>) => Promise<CallOutcome<T>>;

export type BriefInput = {
  ctx: BriefContext;
  text: string | null;
  file: { bytes: Uint8Array; mimeType: string; name: string } | null;
  /** 让 AI 重新拆: the tasks that stay (started, handed in or finished), listed for the model (prompts.ts). */
  keep?: { title: string; points: number }[];
};

export type AnalyseOutcome =
  | { kind: "ok"; data: BriefOut; model: string; tier: AiTier; notes: string[] }
  | Exclude<CallOutcome<BriefOut>, { kind: "ok" }>;

/**
 * Reads the brief: the model's split (the good chain, then the light model), once more with a stronger
 * instruction when it came back far too coarse, one light call translating strings in the wrong
 * language, then the deterministic checks (lib/ai/brief-check.ts). Only the first call can fail the job:
 * the retry and the repair just keep what they started with when they don't work out.
 */
export async function analyseBrief(call: BriefCaller, input: BriefInput): Promise<AnalyseOutcome> {
  const { ctx } = input;
  const nonce = newNonce();
  const graded = gradedParts(input.text);
  const request = (retry: { have: number; want: number } | null): CallRequest<BriefOut> => ({
    purpose: "brief",
    // The split is the step everything else builds on and runs once per project: the good chain,
    // falling back to the light model when its quota is gone (owner decision 2026-09-23).
    tier: "good",
    lightFallback: true,
    system: briefSystem(ctx, nonce),
    parts: briefParts({ text: input.text, file: input.file }, ctx.locale, nonce, { gradedParts: graded, retry, keep: input.keep }),
    schema: BriefOutSchema,
    maxOutputTokens: 32_000,
  });
  const first = await call(request(null));
  if (first.kind !== "ok") return first;
  const notes: string[] = [`answered by ${first.model}`];
  let best = first;
  const few = tooFewTasks(first.data, ctx.packageCount, input.keep?.length ?? 0);
  if (few) {
    const again = await call(request(few));
    const more = again.kind === "ok" ? referenceTasks(again.data).length : 0;
    if (again.kind === "ok" && more > few.have) {
      best = again;
      notes.push(`too few tasks (${few.have} < ${few.want}): asked again, ${again.model} gave ${more}`);
    } else notes.push(`too few tasks (${few.have} < ${few.want}): asking again didn't help (${again.kind === "ok" ? `${more} tasks` : again.kind})`);
  }
  let data = best.data;
  const wrong = languageRepairs(data, ctx.locale);
  if (wrong.length) {
    const fixNonce = newNonce();
    const fix = await call({
      purpose: "brief-fix",
      tier: "light",
      system: briefFixSystem(ctx.locale, fixNonce),
      parts: briefFixParts(wrong, ctx.locale, fixNonce),
      schema: BriefFixOutSchema,
      maxOutputTokens: 32_000,
    });
    if (fix.kind === "ok") {
      const repaired = applyRepairs(data, ctx.locale, fix.data.items);
      data = repaired.out;
      notes.push(`language: ${wrong.length} string(s) in the wrong language, ${repaired.applied} translated`);
    } else notes.push(`language: ${wrong.length} string(s) in the wrong language, the repair call didn't answer (${fix.kind})`);
  }
  const checked = checkBrief(data, { locale: ctx.locale, packageCount: ctx.packageCount, briefText: input.text, parts: graded, keptTitles: input.keep?.map((k) => k.title) });
  return { kind: "ok", data: checked.out, model: best.model, tier: best.tier, notes: [...notes, ...checked.notes] };
}

// ─── The job ─────────────────────────────────────────────────────────────────

/** The answer as draft rows: base tasks (and the meeting first), questions with their options' seeds. */
export function planFrom(out: BriefOut, project: Project, lines: string[], now: Date) {
  const ctx = { project, lines, now };
  const baseRaw = out.tasks.slice(0, MAX_TASKS);
  const questions = out.questions
    .slice(0, MAX_QUESTIONS)
    .map((q) => {
      const options = q.options.slice(0, MAX_OPTIONS);
      const pickCount = q.type === "METHOD" ? 1 : Math.round(clampNumber(q.pickCount, 1, Math.max(1, options.length - 1), 1));
      // Exactly pickCount recommended: the model's own in order, then the least work.
      return { q, options, pickCount, rec: recommendedOptions({ ...q, options }) };
    })
    .filter((x) => x.options.length >= 2 && clampText(x.q.prompt, 200));

  // One scale for everything: the base tasks plus the recommended options' tasks make exactly 1000 tenths
  // (largest remainder); the other options' tasks use the same factor.
  const weight = (tasks: { points: number }[]) => tasks.reduce((s, t) => s + weightOf(t), 0);
  const meetingWeight = out.meetingFirst ? Math.max(0.1, Math.min(...baseRaw.map(weightOf), 5)) : 0;
  const recTasks = questions.flatMap((x) => x.options.flatMap((o, i) => (x.rec.has(i) ? o.tasks.slice(0, MAX_OPTION_TASKS) : [])));
  const total = weight(baseRaw) + meetingWeight + weight(recTasks);
  const factor = total > 0 ? 1000 / total : 10;
  const exact = apportion([...(out.meetingFirst ? [meetingWeight] : []), ...baseRaw.map(weightOf), ...recTasks.map(weightOf)]);
  const exactOf = new Map<object, number>();
  [...(out.meetingFirst ? [out.meetingFirst] : []), ...baseRaw, ...recTasks].forEach((t, i) => exactOf.set(t, exact[i]!));

  const base: TaskSeed[] = [];
  if (out.meetingFirst) base.push(meetingSeed(out.meetingFirst, exactOf.get(out.meetingFirst)!, project.locale));
  for (const t of baseRaw) {
    const seed = seedFromAi(t, exactOf.get(t)!, ctx);
    if (seed) base.push(seed);
  }
  // The code tasks that wait for nothing wait for the meeting.
  if (out.meetingFirst) for (const s of base.slice(1)) if (s.kind === "CODE" && !s.prereqTitle) s.prereqTitle = base[0]!.title;

  const qs = questions.map(({ q, options, pickCount, rec }) => ({
    // One line, no trailing colon: it is shown inside 「…」 in titles and notifications.
    prompt: clampText(q.prompt.replace(/\s+/g, " ").trim().replace(/[:：]\s*$/, ""), 200),
    quote: clampText(q.quote, 500) || null,
    type: q.type,
    pickCount,
    options: options.map((o, i) => ({
      key: String.fromCharCode(65 + i),
      label: clampText(o.label, 80) || String.fromCharCode(65 + i),
      summary: clampText(o.summary, 300),
      hours: Math.round(clampNumber(o.hours, 0, 2000, 0) * 2) / 2,
      material: o.material,
      difficulty: o.difficulty,
      pros: cleanList(o.pros, 4, 120),
      cons: cleanList(o.cons, 4, 120),
      recommended: rec.has(i),
      order: i,
      seeds: o.tasks
        .slice(0, MAX_OPTION_TASKS)
        .map((t) => seedFromAi(t, exactOf.get(t) ?? weightOf(t) * factor, ctx))
        .filter((s): s is TaskSeed => s !== null),
    })),
  }));
  const hours = [...base, ...qs.flatMap((q) => q.options.filter((o) => o.recommended).flatMap((o) => o.seeds))].reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  return { base, questions: qs, totalHours: Math.round(hours) };
}

async function applyAnswer(tx: Tx, project: Project, out: BriefOut, lines: string[], now: Date) {
  const plan = planFrom(out, project, lines, now);
  await tx.task.deleteMany({ where: { projectId: project.id } });
  await tx.feature.deleteMany({ where: { projectId: project.id } });
  await tx.milestone.deleteMany({ where: { projectId: project.id } });
  await tx.choiceQuestion.deleteMany({ where: { projectId: project.id } });
  const dues = spreadDueDates(plan.base.length, now, project.deadline, project.timezone);
  await createSeededTasks(tx, project, plan.base, { startNumber: 1, startOrder: 0, dueFallback: dues });
  for (const [order, q] of plan.questions.entries()) {
    await tx.choiceQuestion.create({
      data: {
        projectId: project.id,
        prompt: q.prompt,
        quote: q.quote,
        type: q.type,
        pickCount: q.pickCount,
        order,
        options: {
          create: q.options.map((o) => ({
            key: o.key,
            label: o.label,
            summary: o.summary,
            hours: o.hours,
            material: o.material,
            difficulty: o.difficulty,
            pros: o.pros,
            cons: o.cons,
            recommended: o.recommended,
            order: o.order,
            tasksJson: o.seeds,
          })),
        },
      },
    });
  }
  await tx.project.update({
    where: { id: project.id },
    data: { planSource: "AI", draftStep: Math.max(project.draftStep, plan.questions.length ? 4 : 5) },
  });
  return { taskCount: plan.base.length, questionCount: plan.questions.length, totalHours: plan.totalHours };
}

export const briefHandler: JobHandler = {
  async run(db, job, now): Promise<RunOutcome> {
    const project = await db.project.findUnique({ where: { id: job.projectId }, select: { id: true, status: true, locale: true, deadline: true, timezone: true, teamSize: true, leaderManages: true, name: true, briefText: true, briefFileKey: true, briefFileMime: true, briefFileName: true } });
    if (!project || project.status !== "DRAFT") {
      await markDiscarded(db, job.id, "not a draft", now);
      return { kind: "done" };
    }
    const leader = await leaderUser(db, project.id);
    if (!keyUsable(leader, now)) return { kind: "fail", reason: leader?.aiProvider ? "INVALID" : "NO_KEY", retry: false };
    const file = project.briefFileKey ? await readStored(project.briefFileKey).catch(() => null) : null;
    if (!project.briefText && !file) return { kind: "fail", reason: "ERROR", retry: false, detail: "no brief" };

    const ctx: BriefContext = {
      locale: project.locale,
      today: localDate(now, project.timezone),
      deadline: localDate(project.deadline, project.timezone),
      timezone: project.timezone,
      teamSize: project.teamSize,
      packageCount: packageCount(project.teamSize, project.leaderManages),
      projectName: project.name,
    };
    const res = await analyseBrief((req) => callModel(db, leader, req, now), {
      ctx,
      text: project.briefText,
      file: file ? { bytes: file, mimeType: project.briefFileMime ?? "application/pdf", name: project.briefFileName ?? "brief" } : null,
    });
    if (res.kind === "wait") return res;
    if (res.kind === "fail") return res;
    if (res.notes.length) console.info(`ai: brief ${project.id} checks: ${res.notes.join("; ")}`);

    const lines = (project.briefText ?? "").split("\n");
    await db.$transaction(async (tx) => {
      const locked = await lockProject(tx, project.id);
      if (locked.status !== "DRAFT" || !(await stillRunning(tx, job))) {
        await markDiscarded(tx, job.id, "replaced", now);
        return;
      }
      const counts = await applyAnswer(tx, locked, res.data, lines, now);
      await markDone(tx, job.id, { ...counts, model: res.model, tier: res.tier }, now);
      if (leader) await keyWorked(tx, leader.id, now);
    }, TX_OPTIONS);
    return { kind: "done" };
  },

  async fail(db, job, reason, now, detail) {
    const leader = await leaderUser(db, job.projectId);
    await db.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: job.projectId }, select: { id: true } });
      if (project) await lockProject(tx, project.id);
      await markFailed(tx, job.id, reason, now, detail);
      // The leader sees it on the wizard's failure screen; the key's status is kept up to date too.
      if (leader && (reason === "QUOTA" || reason === "INVALID")) await keyProblem(tx, leader, reason, now, false);
    }, TX_OPTIONS);
  },
};
