// A22: whatever wipes a database (the test suite, db:reset) only ever runs against this machine.
// `npx tsx scripts/local-db-guard.ts` (npm run db:reset runs it first) checks the URL prisma would use.
import "dotenv/config";
import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True when the connection string points at this machine (a Unix socket in `?host=/…` counts as local). */
export function isLocalDatabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") return false;
  const socketHost = parsed.searchParams.get("host");
  if (socketHost !== null) return socketHost.startsWith("/");
  return LOCAL_HOSTS.has(parsed.hostname.toLowerCase());
}

/** Throws unless `url` is a local database. `what` names the variable; the URL itself (it holds the password) is never shown. */
export function assertLocalDatabaseUrl(url: string | undefined, what: string): asserts url is string {
  if (!url) throw new Error(`${what} is not set`);
  if (!isLocalDatabaseUrl(url)) {
    throw new Error(`${what} must point at localhost: this wipes the database, so any other host is refused`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // prisma.config.ts connects with DIRECT_URL when it is set, else DATABASE_URL.
  const direct = process.env.DIRECT_URL;
  const [name, url] = direct ? ["DIRECT_URL", direct] : ["DATABASE_URL", process.env.DATABASE_URL];
  try {
    assertLocalDatabaseUrl(url, name);
  } catch (err) {
    console.error(`Refused: ${(err as Error).message}`);
    process.exit(1);
  }
}
