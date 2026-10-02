// The one test that talks to a real AI service (M6 spec §9): skipped unless AI_LIVE=1 and GEMINI_TEST_API_KEY
// is set (server/.env). Exactly one light call and one tiny good call, because the free good-model quota is
// only about 20 calls a day. The key is never printed: failures show a redacted message only.
//   AI_LIVE=1 TEST_DB=meritai_test_m6 npx vitest run tests/ai-live.test.ts
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { providerFor } from "../src/lib/ai";
import { newNonce } from "../src/lib/ai/fence";
import { gradeForScore, gradeParts, gradeSystem, GradeOutSchema } from "../src/lib/ai/prompts";
import { redact } from "../src/lib/ai/redact";
import { AiError } from "../src/lib/ai/types";
import { goodChain, lightModel } from "../src/lib/ai/usage";

const key = process.env.GEMINI_TEST_API_KEY?.trim();
const live = process.env.AI_LIVE === "1" && !!key;

/**
 * Runs a call and turns any error into a message without the key. A TRANSIENT answer (Google's 503 "high
 * demand") is tried again after 20 s, at most twice, as the job worker would (it doesn't use up the quota).
 */
async function safely<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AiError && err.kind === "TRANSIENT" && attempt < 3) {
        console.error(`transient (${redact(err.message, [key], 80)}); trying again in 20 s`);
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }
      const msg = err instanceof AiError ? `${err.kind}: ${err.message}` : String((err as Error)?.message ?? err);
      throw new Error(redact(msg, [key]));
    }
  }
}

// The good call goes to the LAST model of the chain (gemini-3.5-flash), so the smarter models keep their quota.
describe.skipIf(!live)("Gemini, live (one light call, one call on the last good model)", () => {
  const gemini = providerFor("GEMINI", { real: true });

  it("light: a tiny structured answer", async () => {
    const out = await safely(() =>
      gemini.generate(key!, {
        tier: "light",
        model: lightModel("GEMINI"),
        purpose: "check",
        system: "Answer only with the requested JSON.",
        parts: [{ text: "Return the task title 'Market research' and 2 short checklist items for it." }],
        schema: z.object({ title: z.string(), checklist: z.array(z.string()) }),
        maxOutputTokens: 400,
      }),
    );
    console.error(`light model answered as: ${out.model}`);
    expect(out.data.title.toLowerCase()).toContain("market");
    expect(out.data.checklist.length).toBeGreaterThan(0);
  }, 120_000);

  it("good (last in the chain): grades a tiny piece of work through the real grading prompt", async () => {
    const nonce = newNonce();
    const out = await safely(() =>
      gemini.generate(key!, {
        tier: "good",
        model: goodChain("GEMINI").at(-1)!,
        purpose: "grade",
        system: gradeSystem("en", nonce),
        parts: gradeParts(
          { title: "Write one sentence about the sea", kind: "DOC", points: 50, description: null, briefExcerpt: "Write one sentence about the sea.", howto: [], checklist: ["One sentence", "About the sea"] },
          [{ kind: "text", name: "answer.txt", text: "The sea is wide, blue and full of life." }],
          "en",
          nonce,
        ),
        schema: GradeOutSchema,
        maxOutputTokens: 1024,
      }),
    );
    console.error(`good model answered as: ${out.model}; band ${gradeForScore(out.data.score)}`);
    expect(out.data.score).toBeGreaterThanOrEqual(0);
    expect(out.data.score).toBeLessThanOrEqual(100);
    expect(typeof out.data.summary).toBe("string");
  }, 180_000);
});
