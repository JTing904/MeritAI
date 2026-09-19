import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";
import { testDatabaseOverride, testDatabaseUrl } from "./test-db";

// Bring the separate test database up to the latest migrations before any test runs.
// With TEST_DB set, that database is created first (on the TEST_DATABASE_URL server) if it is missing.
export default async function setup() {
  const url = testDatabaseUrl();
  const name = testDatabaseOverride();
  if (name) await ensureDatabase(process.env.TEST_DATABASE_URL!, name);
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: "" },
  });
}

async function ensureDatabase(serverUrl: string, name: string) {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount) return;
    try {
      // `name` is checked to be a plain identifier (test-db.ts); CREATE DATABASE takes no parameters.
      await client.query(`CREATE DATABASE "${name}"`);
    } catch (err) {
      // 42P04: another run created it a moment ago.
      if ((err as { code?: string }).code !== "42P04") throw err;
    }
  } finally {
    await client.end();
  }
}
