import { readPref, writePref } from './prefs';

// Web / PWA: SecureStore does not exist in browsers, so the token uses local storage.
const KEY = 'meritai.session';

export const loadToken = () => readPref(KEY);
export const saveToken = (token: string | null) => writePref(KEY, token);
