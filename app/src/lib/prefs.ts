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
