import { router, type Href } from 'expo-router';

/** What the brief turned into, for the plan step's info line (only right after reading it). */
export type PlanFound = { method: 'SCORES' | 'LIST' | 'AI'; found: number };

// Wizard routes. The steps replace each other so Back/✕ behave the same however a step was reached
// (fresh, resumed from a home draft card, or reloaded on the web).
export const wizardHref = {
  basics: (id: string) => `/new/${id}/basics` as Href,
  input: (id: string, mode?: 'upload' | 'text' | 'manual') => (mode ? `/new/${id}/input?mode=${mode}` : `/new/${id}/input`) as Href,
  cantRead: (id: string, q: { reason: string; file?: string | null; size?: number | null; mime?: string | null }) => {
    // Built by hand: React Native's URLSearchParams only half exists.
    const query = Object.entries({ reason: q.reason, file: q.file, size: q.size, mime: q.mime })
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `/new/${id}/cant-read?${query}` as Href;
  },
  /** M6 step 3: the AI reads the brief (polls the draft), or says why it couldn't. */
  reading: (id: string) => `/new/${id}/reading` as Href,
  /** M6 step 4: the 选择题, one screen each (`q`: which one, from 0). */
  choices: (id: string, q?: number) => (q ? `/new/${id}/choices?q=${q}` : `/new/${id}/choices`) as Href,
  plan: (id: string, found?: PlanFound) =>
    (found ? `/new/${id}/plan?method=${found.method}&found=${found.found}` : `/new/${id}/plan`) as Href,
  done: (id: string) => `/new/${id}/done` as Href,
};

export const projectHref = (id: string) => `/project/${id}` as Href;

/** 选任务包 for a project. */
export const pickHref = (id: string) => `/project/${id}/pick` as Href;

/**
 * Where 继续编辑 resumes a draft: step 1 → basics, 2 → input, 3 → the AI's reading (it sends on to input
 * when the AI isn't reading anything), 4 → the 选择题, 5+ → plan.
 */
export function draftStepHref(id: string, draftStep: number): Href {
  if (draftStep <= 1) return wizardHref.basics(id);
  if (draftStep === 3) return wizardHref.reading(id);
  if (draftStep === 4) return wizardHref.choices(id);
  if (draftStep <= 4) return wizardHref.input(id);
  return wizardHref.plan(id);
}

export const goStep = (href: Href) => router.replace(href);
