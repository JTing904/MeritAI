// Project lifecycle helpers (M5) and the app's clock.
import type { ProjectStatus } from '@shared/types';

/** ACTIVE and AWAITING_CONFIRM (the deadline passed, the leader hasn't ended it): everything still works. */
export const isLive = (status: ProjectStatus) => status === 'ACTIVE' || status === 'AWAITING_CONFIRM';

/** ENDED: read-only, except the leader grading a PENDING attempt, leaving, reopening and deleting. */
export const isEnded = (status: ProjectStatus) => status === 'ENDED';

// Development only: the server's time machine moves its clock; the app counts 「还有 N 天」 with the same
// offset so the lifecycle lines agree with the server. Always 0 in release builds.
let offsetMs = 0;

/** Now, as the server sees it (real time plus the time machine's offset in development builds). */
export const appNow = () => new Date(Date.now() + offsetMs);

/** Set by the time machine (developer tools on the 我 page) after each GET / POST. */
export function setClockOffset(ms: number) {
  offsetMs = __DEV__ ? ms : 0;
}
