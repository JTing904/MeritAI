import type { Href } from 'expo-router';
import type { BriefResult } from '@shared/types';
import { wizardHref } from './nav';

/**
 * Where the wizard goes after POST …/brief (or …/brief/rules): the AI's reading (M6), the plan with the
 * rules' info line, or 「读不了 / 拆不了」. Null for the other failures (too large, wrong type, empty), which
 * the caller shows in place.
 */
export function briefHref(id: string, res: BriefResult, from?: { name: string; size: number | null; mimeType: string | null } | null): Href | null {
  if (res.ok) {
    if (res.source === 'AI') return wizardHref.reading(id);
    return wizardHref.plan(id, { method: res.method, found: res.found });
  }
  if (res.reason === 'UNREADABLE' || res.reason === 'NO_STRUCTURE') {
    return wizardHref.cantRead(id, {
      reason: res.reason,
      file: res.fileName ?? from?.name,
      size: res.sizeBytes ?? from?.size,
      mime: from?.mimeType,
    });
  }
  return null;
}
