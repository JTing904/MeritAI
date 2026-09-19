import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-device preferences (theme, language). Storage can fail (private browsing, quota);
// the app must still work, so every access is guarded.

export async function readPref(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writePref(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // Not fatal: the preference just won't survive a restart.
  }
}

export const PREF = {
  theme: 'meritai.theme',
  locale: 'meritai.locale',
} as const;

/** Per-device settings that stay when someone signs out; every other `meritai.*` key belongs to the user. */
const DEVICE_KEYS = new Set<string>(Object.values(PREF));

/** Sign-out: removes everything this app stored for the user (profile cache, typed-brief drafts, …). */
export async function clearUserPrefs(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith('meritai.') && !DEVICE_KEYS.has(k));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}
