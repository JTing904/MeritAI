import * as SecureStore from 'expo-secure-store';

// Android: the session token lives in the Android Keystore via expo-secure-store.
const KEY = 'meritai.session';

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Keystore unavailable: the user will simply need to sign in again next launch.
  }
}
