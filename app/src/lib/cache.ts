import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useSyncExternalStore } from 'react';
import { QueryCache, type CacheStorage } from './cacheCore';
import { isPersistable, writeEffect } from './cacheKeys';

// The app's one data cache (hardening B1). See cacheCore.ts for the rules; keys and write effects are in
// cacheKeys.ts. Screens read it with useCached(key) and fill it through session.cached(path).

const storage: CacheStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
  multiGet: (keys) => AsyncStorage.multiGet(keys),
  multiSet: (pairs) => AsyncStorage.multiSet(pairs),
  multiRemove: (keys) => AsyncStorage.multiRemove(keys),
};

export const queryCache = new QueryCache(storage, isPersistable);

/** After a successful write (session.request does this for every non-GET): update and invalidate. */
export function applyWrite(path: string, result: unknown) {
  const effect = writeEffect(path, result);
  for (const match of effect.stale) queryCache.markStale(match);
  for (const match of effect.drop) queryCache.drop(match);
  for (const { key, data } of effect.set) queryCache.set(key, data);
}

/** The cached data for `key` (null: none, or no key), re-rendering whenever it changes. */
export function useCached<T>(key: string | null): T | null {
  const get = useCallback(() => (key ? (queryCache.peek<T>(key) ?? null) : null), [key]);
  const subscribe = useCallback((listener: () => void) => queryCache.subscribe(listener), []);
  return useSyncExternalStore(subscribe, get, get);
}

/** Whether the cache has data for `key` (for the current user). Not reactive; see useCached. */
export const hasCached = (key: string) => queryCache.has(key);
