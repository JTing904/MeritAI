// Step 2 of the wizard: turn a brief (typed or extracted from a file) into draft tasks with the free rules.
import { apportion } from "../../../shared/planning";
import type { BriefFailure, BriefResult } from "../../../shared/types";
import type { Db } from "../lib/db";
import { spreadDueDates } from "../lib/plan/dates";
import { MAX_BRIEF_BYTES } from "../lib/plan/extract";
import { parseBriefWithRules } from "../lib/plan/rules";
import { lockDraft, TX_OPTIONS } from "./tx";
import { loadDraftView } from "./views";

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
  now = new Date(),
): Promise<BriefResult> {
  if (!brief.text.trim()) return briefFailure("EMPTY", brief.fileName, brief.sizeBytes);
  const parsed = parseBriefWithRules(brief.text, { typed: brief.typed ?? false });
  if (!parsed.ok) return briefFailure(parsed.reason, brief.fileName, brief.sizeBytes);

  await db.$transaction(async (tx) => {
    const project = await lockDraft(tx, projectId);
    const points = apportion(parsed.tasks.map((t) => t.weight));
    const dues = spreadDueDates(parsed.tasks.length, now, project.deadline, project.timezone);
    await tx.task.deleteMany({ where: { projectId } });
    await tx.feature.deleteMany({ where: { projectId } });
    await tx.milestone.deleteMany({ where: { projectId } });
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
      })),
    });
    await tx.project.update({
      where: { id: projectId },
      data: {
        planSource: "RULES",
        briefText: brief.text,
        briefFileName: brief.fileName,
        draftStep: Math.max(project.draftStep, 5),
      },
    });
  }, TX_OPTIONS);

  return { ok: true, source: "RULES", method: parsed.method, found: parsed.tasks.length, draft: await loadDraftView(db, projectId) };
}
