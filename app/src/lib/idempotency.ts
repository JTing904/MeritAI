import { useMemo, useRef } from 'react';
import { newIdempotencyKey } from './api';

export type IdempotencyKeys = {
  /**
   * The Idempotency-Key for a create with this payload (any string that describes it): the same key while
   * the same payload is sent again (再试一次, a second tap after a timeout), a new one once it changes.
   */
  keyFor: (payload: string) => string;
  /** The create went through: the next one is a new action with a new key. */
  done: () => void;
};

/** Idempotency keys for one create button (evidence link, add task, create draft, invites). */
export function useIdempotencyKey(): IdempotencyKeys {
  const current = useRef<{ payload: string; key: string } | null>(null);
  return useMemo(
    () => ({
      keyFor(payload) {
        if (!current.current || current.current.payload !== payload) current.current = { payload, key: newIdempotencyKey() };
        return current.current.key;
      },
      done() {
        current.current = null;
      },
    }),
    [],
  );
}
