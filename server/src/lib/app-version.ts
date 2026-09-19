// A17: the app sends its build's version (shared/constants.ts APP_VERSION) as X-App-Version on every
// request; builds older than MIN_APP_VERSION get 426 UPDATE_REQUIRED and show the 「请更新 App」 screen.

export type Version = readonly [number, number, number];

const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.+-]*)?$/;

/** "1.4.2" (a leading v and a -prerelease / +build suffix are ignored) → [1, 4, 2]; null when it isn't one. */
export function parseVersion(value: string | null | undefined): Version | null {
  const m = value?.trim().match(SEMVER);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** MIN_APP_VERSION (default 0.0.0: nothing is refused). A value that isn't a version is logged and ignored. */
export function minAppVersion(raw = process.env.MIN_APP_VERSION): Version {
  if (!raw?.trim()) return [0, 0, 0];
  const parsed = parseVersion(raw);
  if (!parsed) console.error(`MIN_APP_VERSION is not a version (x.y.z): ${JSON.stringify(raw)}; ignoring it`);
  return parsed ?? [0, 0, 0];
}

/**
 * True when a request from this app version must update first. A missing or unreadable header counts as
 * 0.0.0 (builds from before the header existed), so it is refused only once a minimum is set.
 */
export function isTooOld(header: string | null | undefined, min: Version): boolean {
  if (min[0] === 0 && min[1] === 0 && min[2] === 0) return false;
  return compareVersions(parseVersion(header) ?? [0, 0, 0], min) < 0;
}
