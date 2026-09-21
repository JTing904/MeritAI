import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';

// Is the device online? From @react-native-community/netinfo (Android: the system's own "this network has
// internet" check, no extra requests; web: navigator.onLine and its online/offline events). An APK built
// before netinfo was added has no native module: then the device always counts as online.

type NetInfoModule = {
  addEventListener: (listener: (state: NetInfoState) => void) => NetInfoSubscription;
  fetch: () => Promise<NetInfoState>;
  refresh: () => Promise<NetInfoState>;
};

function loadNetInfo(): NetInfoModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo') as { default?: NetInfoModule };
    return mod.default ?? null;
  } catch {
    return null; // native module missing (old build)
  }
}

type NetState = {
  /** False only when the device is known to have no connection. */
  online: boolean;
  /** The first answer has arrived (before it, `online` is the optimistic default). */
  known: boolean;
};

/** No answer from netinfo this soon at startup: count as online. */
const FIRST_ANSWER_MS = 1500;

let state: NetState = { online: true, known: false };
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
let started = false;
let netInfo: NetInfoModule | null = null;

function publish(online: boolean) {
  const wasOffline = state.known && !state.online;
  if (state.known && state.online === online) return;
  state = { online, known: true };
  listeners.forEach((l) => l());
  if (online && wasOffline) reconnectListeners.forEach((l) => l());
}

function fromNetInfo(s: NetInfoState): boolean {
  if (s.isConnected === false) return false;
  // Native: the system says this network can't reach the internet. (null: not checked yet.)
  if (Platform.OS !== 'web' && s.isInternetReachable === false) return false;
  return true;
}

function webOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Starts listening (idempotent; called on import by the root layout). */
export function startNetworkWatch() {
  if (started) return;
  started = true;
  if (Platform.OS === 'web') {
    // navigator.onLine is synchronous: the very first frame already knows. (netinfo isn't used on the web:
    // its reachability check would HEAD the page's origin every minute, a hosting request each time.)
    publish(webOnline());
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => publish(true));
      window.addEventListener('offline', () => publish(false));
    }
    return;
  }
  netInfo = loadNetInfo();
  if (!netInfo) {
    publish(true);
    return;
  }
  // The start waits for the first answer (to block an offline start); never for long.
  setTimeout(() => {
    if (!state.known) publish(true);
  }, FIRST_ANSWER_MS);
  netInfo.addEventListener((s) => publish(fromNetInfo(s)));
  netInfo.fetch().then(
    (s) => publish(fromNetInfo(s)),
    () => publish(true),
  );
}

/** Ask again now (再试一次 on the no-network screen). */
export async function recheckNetwork(): Promise<boolean> {
  if (Platform.OS === 'web') {
    publish(webOnline());
    return state.online;
  }
  if (!netInfo) return true;
  try {
    publish(fromNetInfo(await netInfo.refresh()));
  } catch {
    // keep the last answer
  }
  return state.online;
}

/** Synchronous: false only when the device is known to be offline. */
export const isOnline = () => state.online;

export const getNetworkState = () => state;

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Called when the device goes from offline back to online (screens revalidate). */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => void reconnectListeners.delete(listener);
}

/** `{ online, known }`, re-rendering when it changes. */
export function useNetwork(): NetState {
  return useSyncExternalStore(subscribeNetwork, getNetworkState, getNetworkState);
}

export const useOnline = () => useNetwork().online;

// Listen from the first import, so isOnline() is right before any screen mounts.
startNetworkWatch();
