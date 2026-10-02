// Step 2 of the wizard: turn a brief (typed or extracted from a file) into draft tasks with the free rules.
import type { Locale } from "../../../shared/constants";
import { apportion } from "../../../shared/planning";
import type { BriefFailure, BriefResult } from "../../../shared/types";
import type { Db } from "../lib/db";
import { spreadDueDates } from "../lib/plan/dates";
import { MAX_BRIEF_BYTES } from "../lib/plan/extract";
import { normalizeBrief, parseBriefWithRules } from "../lib/plan/rules";
import { lockDraft, TX_OPTIONS } from "./tx";
import { loadDraftView } from "./views";
import { clock } from "../lib/clock";

/**
 * Most of a brief kept in Project.briefText (A12): about 100 pages of text. A longer one is still parsed
 * whole (every task is found), but only its first lines up to this size are stored, followed by a note.
 * Refusing it instead would leave the leader stuck on a legitimate file, and only the 作业要求 page reads it.
 */
export const MAX_BRIEF_TEXT_BYTES = 200 * 1024;
/** Longest quoted excerpt kept on one task (its brief item's lines). */
export const MAX_EXCERPT_CHARS = 4000;

const CUT_NOTE: Record<Locale, string> = {
  zh: "（原文太长，这里只保存了前面的部分。完整内容请看原来的文件。）",
  en: "(The brief is too long, so only its first part is kept here. See the original file for the rest.)",
};

const utf8Bytes = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * The normalized brief as stored: whole lines up to MAX_BRIEF_TEXT_BYTES, then a blank line and a note
 * when it was cut. `keptLines`: how many of the text's lines survive (all of them when it wasn't cut).
 */
export function capBriefText(text: string, locale: Locale): { text: string; keptLines: number; cut: boolean } {
  const lines = text.split("\n");
  if (utf8Bytes(text) <= MAX_BRIEF_TEXT_BYTES) return { text, keptLines: lines.length, cut: false };
  const note = CUT_NOTE[locale];
  const budget = MAX_BRIEF_TEXT_BYTES - utf8Bytes(note) - 2;
  let used = 0;
  let kept = 0;
  while (kept < lines.length && used + utf8Bytes(lines[kept]!) + 1 <= budget) used += utf8Bytes(lines[kept++]!) + 1;
  return { text: [...lines.slice(0, kept), "", note].join("\n"), keptLines: kept, cut: true };
}

function excerptText(lines: string[]): string {
  const text = lines.join("\n");
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS - 1)}…` : text;
}

export function briefFailure(reason: BriefFailure, fileName: string | null, sizeBytes: number | null): BriefResult {
  return { ok: false, reason, fileName, sizeBytes, maxBytes: MAX_BRIEF_BYTES };
}

/**
 * Parses the brief and, when the rules find scored or listed items, replaces all of the draft's tasks
 * (and any features/milestones) with them. Points are the found weights scaled to 1000; due dates are
 * spread evenly from now to the project deadline. Nothing changes when the rules can't split it.
 * `typed`: the leader typed it (「打字描述」), so plain lines count as one task each.
 */
export async function applyBrief(
  db: Db,
  projectId: string,
  brief: { text: string; fileName: string | null; sizeBytes: number | null; typed?: boolean },
  now = clock.now(),
): Promise<BriefResult> {
  if (!brief.text.trim()) return briefFailure("EMPTY", brief.fileName, brief.sizeBytes);
  const parsed = parseBriefWithRules(brief.text, { typed: brief.typed ?? false });
  if (!parsed.ok) return briefFailure(parsed.reason, brief.fileName, brief.sizeBytes);

  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    // Normalized, so the tasks' briefFrom / briefTo index its lines; cut when very long.
    const stored = capBriefText(normalizeBrief(brief.text), project.locale);
    // A range past the cut can't be shown on the 作业要求 page (the task still quotes its own lines).
    const shown = (to: number) => to <= stored.keptLines;
    const points = apportion(parsed.tasks.map((t) => t.weight));
    const dues = spreadDueDates(parsed.tasks.length, now, project.deadline, project.timezone);
    await tx.task.deleteMany({ where: { projectId } });
    await tx.feature.deleteMany({ where: { projectId } });
    await tx.milestone.deleteMany({ where: { projectId } });
    // M6: the rules replace whatever the AI found (its 选择题 too) and stop it reading.
    await tx.choiceQuestion.deleteMany({ where: { projectId } });
    await tx.aiJob.updateMany({
      where: { projectId, kind: "BRIEF", status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: "CANCELLED", leaseUntil: null },
    });
    await tx.task.createMany({
      data: parsed.tasks.map((t, i) => ({
        projectId,
        number: i + 1,
        order: i,
        title: t.title,
        kind: t.kind,
        points: points[i]!,
        dueAt: dues[i]!,
        suggestedDueAt: dues[i]!,
        // 作业要求（原文）: the item's lines, and where they are in briefText.
        briefExcerpt: t.excerpt ? excerptText(t.excerpt.lines) : null,
        briefFrom: t.excerpt && shown(t.excerpt.to) ? t.excerpt.from : null,
        briefTo: t.excerpt && shown(t.excerpt.to) ? t.excerpt.to : null,
      })),
    });
    await tx.project.update({
      where: { id: projectId },
      data: {
        planSource: "RULES",
        briefText: stored.text,
        briefBytes: utf8Bytes(stored.text),
        briefFileName: brief.fileName,
        draftStep: Math.max(project.draftStep, 5),
        // The rules read text: a photo kept for the AI (M6) is no longer the brief (its file goes with the project).
        briefFileKey: null,
        briefFileMime: null,
      },
    });
  }, TX_OPTIONS);

  return { ok: true, source: "RULES", method: parsed.method, found: parsed.tasks.length, draft: await loadDraftView(db, projectId) };
}
