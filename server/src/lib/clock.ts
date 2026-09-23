// The server clock (M5). Routes take "now" from here instead of new Date(), so the development time
// machine (POST /api/dev/time-machine) moves every rule that depends on time: due dates, overdue flags,
// the reminders tick, swap expiry, the lifecycle, and the ETag tokens computed from them. Services still
// take `now` as their last parameter (tests pass it explicitly); their default is clock.now() as well.
//
// Left on real time on purpose: sessions (lib/auth.ts), idempotency keys (lib/idempotency.ts), rate
// limits (lib/rate-limit.ts) and signed file links (lib/storage.ts signs them, services/evidence.ts
// checks them). Jumping the clock a week ahead must not sign everyone out, replay or forget stored
// answers, open or close rate windows, or expire every file link at once.
import { devLoginEnabled } from "./dev-gate";

/** The offset stays within this much of real time. */
export const MAX_OFFSET_MS = 400 * 24 * 60 * 60 * 1000;

let offsetMs = 0;

export const clock = {
  /** Real time plus the time machine's offset (always 0 outside development). */
  now(): Date {
    return new Date(Date.now() + offsetMs);
  },
  offsetMs(): number {
    return offsetMs;
  },
  /**
   * Sets the offset. Only behind the dev gate (lib/dev-gate.ts): anywhere else it throws, so no code
   * path can shift a production clock.
   */
  setOffset(ms: number): void {
    if (!devLoginEnabled()) throw new Error("The time machine only runs in development");
    if (!Number.isFinite(ms) || Math.abs(ms) > MAX_OFFSET_MS) throw new RangeError("Offset out of range");
    offsetMs = Math.trunc(ms);
  },
};
