// 让 AI 重新拆, the review page's arithmetic: the proposal with the leader's answers, edits, deletions and
// additions, placed and rescaled the same way the server applies it (shared/planning.ts placeResplit, in the
// same task order), so what the page shows is what 「确认，换成新任务」 makes.
import { placeResplit } from '@shared/planning';
import type { AiResplitApplyInput, AiResplitEdit, AiResplitNewTask, AiResplitProposal, TaskKind } from '@shared/types';

/** A task the leader added on the review page (`id` only lives on this device). */
export type LocalTask = { id: string; title: string; kind: TaskKind; points: number; dueAt: string | null };

export type ReviewDraft = {
  /** New question id → option keys (starts with the recommended ones). */
  answers: Record<string, string[]>;
  edits: Record<string, AiResplitEdit>;
  deleted: string[];
  added: LocalTask[];
};

/** One new task as the review shows it: `points` after the rescale, where it goes. */
export type ReviewTask = {
  /** The proposal's key, or the local id of a task the leader added. */
  key: string;
  byLeader: boolean;
  title: string;
  kind: TaskKind;
  /** Tenths after the rescale. */
  points: number;
  /** The weight it goes in with (what the edit sheet starts from). */
  weight: number;
  dueAt: string | null;
  aiWritten: boolean;
  packageIndex: number | null;
  ownerMemberId: string | null;
};

export type ReviewPlan = {
  /** The kept tasks' tenths after the rescale (proposal.kept order). */
  keptPoints: number[];
  tasks: ReviewTask[];
  packages: { index: number; ownerMemberId: string | null; pointsBefore: number; pointsAfter: number }[];
};

export function startDraft(p: AiResplitProposal): ReviewDraft {
  const answers = Object.fromEntries(p.newQuestions.map((q) => [q.id, q.options.filter((o) => o.recommended).map((o) => o.key).slice(0, q.pickCount)]));
  return { answers, edits: {}, deleted: [], added: [] };
}

/** The new tasks in the server's order: the plan's, the picked new options', then the leader's own. */
export function reviewPlan(p: AiResplitProposal, d: ReviewDraft): ReviewPlan {
  const gone = new Set(d.deleted);
  const fromAi = (t: AiResplitNewTask) => {
    const e = d.edits[t.key] ?? {};
    return { key: t.key, byLeader: false, title: e.title ?? t.title, kind: e.kind ?? t.kind, weight: e.points ?? t.points, dueAt: e.dueAt ?? t.dueAt, aiWritten: t.aiWritten, feature: t.feature, pin: t.packageIndex };
  };
  const list = [
    ...p.added.filter((t) => !gone.has(t.key)).map(fromAi),
    ...p.newQuestions.flatMap((q) =>
      q.options.filter((o) => (d.answers[q.id] ?? []).includes(o.key)).flatMap((o) => o.tasks.filter((t) => !gone.has(t.key)).map(fromAi)),
    ),
    ...d.added.map((t) => ({ key: t.id, byLeader: true, title: t.title, kind: t.kind, weight: t.points, dueAt: t.dueAt, aiWritten: false, feature: null, pin: null })),
  ];
  const placed = placeResplit({
    packages: p.packages.map((x) => ({ index: x.index, ownerMemberId: x.ownerMemberId })),
    kept: p.kept.map((t) => ({ points: t.points, packageIndex: t.packageIndex })),
    removed: p.removed.map((t) => ({ points: t.points, packageIndex: t.packageIndex })),
    // The proposal's tasks stay in the package it put them in; the leader's own (and other options') are placed fresh.
    added: list.map((t) => ({ points: t.weight, feature: t.feature, packageIndex: t.pin })),
    // As the server applies it: kept points move only when the leader changed some points.
    keepKept: !Object.values(d.edits).some((e) => e.points !== undefined),
  });
  return {
    keptPoints: placed.keptPoints,
    tasks: list.map(({ feature: _feature, pin: _pin, ...t }, i) => ({ ...t, ...placed.added[i]! })),
    packages: p.packages.map((x, i) => ({ ownerMemberId: x.ownerMemberId, ...placed.packages[i]! })),
  };
}

/** Every new question answered with exactly its pickCount. */
export const answered = (p: AiResplitProposal, d: ReviewDraft) => p.newQuestions.every((q) => (d.answers[q.id] ?? []).length === q.pickCount);

/** The body of POST …/ai-resplit/apply. */
export function applyBody(p: AiResplitProposal, d: ReviewDraft): AiResplitApplyInput {
  return {
    version: p.version,
    edits: d.edits,
    deleted: d.deleted,
    added: d.added.map(({ id: _id, ...t }) => t),
    answers: d.answers,
  };
}

/** After the proposal was worked out again (STALE_PREVIEW): keep the edits whose tasks are still there. */
export function carryDraft(p: AiResplitProposal, d: ReviewDraft): ReviewDraft {
  const keys = new Set([...p.added, ...p.newQuestions.flatMap((q) => q.options.flatMap((o) => o.tasks))].map((t) => t.key));
  const fresh = startDraft(p);
  const answers = { ...fresh.answers };
  for (const q of p.newQuestions) {
    const old = d.answers[q.id];
    if (old && old.every((k) => q.options.some((o) => o.key === k))) answers[q.id] = old;
  }
  return {
    answers,
    edits: Object.fromEntries(Object.entries(d.edits).filter(([k]) => keys.has(k))),
    deleted: d.deleted.filter((k) => keys.has(k)),
    added: d.added,
  };
}
