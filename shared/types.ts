// Response and request shapes shared by the server and the app.
import type { Highlighter, Locale } from './constants';

/** The signed-in user, as returned by GET /api/me. */
export type MeData = {
  id: string;
  name: string;
  email: string | null;
  githubUsername: string | null;
  /** Colour for the profile avatar outside projects. */
  color: Highlighter;
  /** Language for push notifications; the app keeps it in sync with the device choice. */
  locale: Locale;
  pushEnabled: boolean;
  weeklyEnabled: boolean;
};

export type MeUpdate = Partial<Pick<MeData, 'locale' | 'pushEnabled' | 'weeklyEnabled'>>;

/** Developer one-tap login: the seeded test people (only when dev login is enabled). */
export type DevPerson = { id: string; name: string; email: string | null; color: Highlighter };

export type LoginResult = { token: string; user: MeData };
