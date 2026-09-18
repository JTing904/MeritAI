import "dotenv/config";
import { createApp } from "../src/app";
import { createDb, type Db } from "../src/lib/db";

export const testDb: Db = createDb(process.env.TEST_DATABASE_URL!);
export const testApp = createApp({ db: () => testDb, webOrigins: ["http://localhost:8081"] });

/** Empties every table (except Prisma's migration log) so each test starts clean. */
export async function resetDb(db: Db = testDb) {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

type Init = { method?: string; body?: unknown; token?: string; headers?: Record<string, string> };

/** Calls the app and returns the status plus the parsed envelope. */
export async function call<T = unknown>(path: string, { method = "GET", body, token, headers = {} }: Init = {}) {
  const res = await testApp.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; data: T; error: { code: string; message: string } | null };
  return { status: res.status, ...json };
}
