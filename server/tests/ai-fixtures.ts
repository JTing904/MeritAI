// Shared setup for the M6 (AI) tests. Every key goes to the mock provider (vitest.config.ts AI_MOCK=1), and
// jobs only run when a test drains them (AI_JOB_KICK=off).
import type { AiProviderName } from "../../shared/constants";
import type { MeData } from "../../shared/types";
import { mockAi } from "../src/lib/ai/mock";
import { drainAiJobs } from "../src/services/ai-jobs";
import { call, testDb } from "./helpers";

/** A key-shaped string the mock accepts (anything without "invalid", "bad" or "down"). */
export const GOOD_KEY = "AIzaSyTestKey000000000000000000000abcd";

export async function setKey(token: string, provider: AiProviderName = "GEMINI", key = GOOD_KEY) {
  const res = await call<MeData>("/api/me/ai-key", { method: "PUT", token, body: { provider, key, adult: true } });
  if (res.status !== 200) throw new Error(`setKey failed: ${res.status} ${JSON.stringify(res.error)}`);
  return res.data;
}

/** Runs every due job (at `now`, default the real time). */
export const drain = (now: Date = new Date()) => drainAiJobs(testDb, now);

export const jobsOf = (projectId: string) => testDb.aiJob.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** A CSV evidence file whose text holds `body` (the mock grades by #excellent / #half / #fail in it). */
export const csvFile = (body: string, name = "work.csv") => new File([Buffer.from(`note\n${body}\n`, "utf8")], name);

export function resetMock() {
  mockAi.reset();
  delete process.env.AI_MOCK_FAIL;
}

export { mockAi };
