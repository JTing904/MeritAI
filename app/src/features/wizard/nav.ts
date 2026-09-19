import { router, type Href } from 'expo-router';

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
  plan: (id: string, found?: { method: 'SCORES' | 'LIST'; found: number }) =>
    (found ? `/new/${id}/plan?method=${found.method}&found=${found.found}` : `/new/${id}/plan`) as Href,
  done: (id: string) => `/new/${id}/done` as Href,
};

export const projectHref = (id: string) => `/project/${id}` as Href;

/** 选任务包 for a project. */
export const pickHref = (id: string) => `/project/${id}/pick` as Href;

/** Where 继续编辑 resumes a draft: step 1 → basics, 2–4 → input, 5+ → plan. */
export function draftStepHref(id: string, draftStep: number): Href {
  if (draftStep <= 1) return wizardHref.basics(id);
  if (draftStep <= 4) return wizardHref.input(id);
  return wizardHref.plan(id);
}

export const goStep = (href: Href) => router.replace(href);
