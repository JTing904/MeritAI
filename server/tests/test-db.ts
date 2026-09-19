import "dotenv/config";

const NAME = /^[A-Za-z0-9_]{1,63}$/;

const databaseName = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));

/**
 * The database the tests use (and wipe): TEST_DATABASE_URL, or, when TEST_DB is set, the database of
 * that name on the same server, so two suites can run at once without truncating each other's tables.
 * Never log the result: it holds the password.
 */
export function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const name = testDatabaseOverride();
  if (!name) return base;
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/** TEST_DB, checked: a plain identifier that isn't the development database. Undefined when unset. */
export function testDatabaseOverride(): string | undefined {
  const name = process.env.TEST_DB?.trim();
  if (!name) return undefined;
  if (!NAME.test(name)) throw new Error("TEST_DB must be 1-63 letters, digits or underscores");
  const dev = process.env.DATABASE_URL;
  if (dev && databaseName(dev) === name) throw new Error("TEST_DB must not be the development database (tests wipe it)");
  return name;
}
