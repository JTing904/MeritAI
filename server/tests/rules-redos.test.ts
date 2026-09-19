import { describe, expect, it } from "vitest";
import { extractBriefText } from "../src/lib/plan/extract";
import { cleanTitle, parseBriefWithRules } from "../src/lib/plan/rules";

// Hostile briefs (security audit 2026-09-19): before the rewrite, the label-tail pattern backtracked
// exponentially on repeated label words and cubically on long runs of spaces, so one typed brief could
// hold the server for minutes. Every input here is ~100 KB and must parse in well under a second.
const BUDGET_MS = 300;
const SIZE = 100_000;
const fill = (s: string) => s.repeat(Math.ceil(SIZE / s.length)).slice(0, SIZE);
const lines = (line: string) => fill(`${line}\n`);
const spaces = (n: number) => " ".repeat(n);

const HOSTILE: Record<string, string> = {
  "repeated label words (exponential)": lines(`Report ${"worth ".repeat(40)}x`),
  "repeated label words, double spaces": lines(`Report ${"worth  ".repeat(40)}x`),
  "repeated label words with colons": lines(`Report ${"weightage: ".repeat(40)}x`),
  "repeated Chinese label words": lines(`报告${"占 ".repeat(40)}x`),
  "a long gap before a weight (cubic)": lines(`Task${spaces(1990)}(20%)`),
  "a long gap before a bare weight": lines(`Task${spaces(1990)}20%`),
  "a long gap, no weight": lines(`Task${spaces(1990)}x`),
  "one 100 KB line": `Task${spaces(SIZE)}(20%)`,
  "one 100 KB line of label words": `Report ${"worth ".repeat(SIZE / 6)}x`,
  "a long gap after a word marker": lines(`Part 1${spaces(1990)}x`),
  "a long gap after Total": lines(`Total${spaces(1990)}|`),
  "a long gap after Due": lines(`Due${spaces(1990)}x`),
  "a long gap inside a range": lines(`1${spaces(990)}%${spaces(990)}x`),
  "mixed spaces and tabs": lines(`Task${" \t".repeat(995)}x 20%`),
  "a run of colons": lines(`a${":".repeat(1990)}b`),
  "a run of dashes": lines(`Task ${"-".repeat(1990)}b 20%`),
  "repeated 本作业": lines("本作业".repeat(600)),
  "many weights on a line": lines("1% ".repeat(600)),
  "many word markers": lines("Part 1 20%"),
  "very many short lines": lines("a"),
  "deep nesting": Array.from({ length: 400 }, (_, i) => `${spaces(i)}- item ${i}`).join("\n"),
};

describe("brief parser on hostile input", () => {
  // The first parse compiles every pattern; keep that out of the measurements.
  parseBriefWithRules("1. Report (40%)\n2. Poster (60%)");

  for (const [name, text] of Object.entries(HOSTILE)) {
    it(`parses ${name} within ${BUDGET_MS} ms`, () => {
      for (const typed of [false, true]) {
        const t0 = performance.now();
        parseBriefWithRules(text, { typed });
        expect(performance.now() - t0, `typed=${typed}`).toBeLessThan(BUDGET_MS);
      }
    });
  }

  it("reads plain text with a 100 KB gap inside a line quickly", async () => {
    const bytes = new TextEncoder().encode(`Report${spaces(SIZE)}x\nPoster 20%\n`);
    const t0 = performance.now();
    const r = await extractBriefText(bytes, "brief.txt", "text/plain");
    expect(performance.now() - t0).toBeLessThan(BUDGET_MS);
    expect(r.ok).toBe(true);
  });
});

describe("label words at the end of a title", () => {
  it.each([
    ["Proposal is worth", "Proposal"],
    ["Report weightage:", "Report"],
    ["Report - weightage = ", "Report"],
    ["Final report will be worth", "Final report"],
    ["Report mark allocation", "Report"],
    ["Poster carries", "Poster"],
    ["Report worth worth : worth", "Report"],
    ["报告占比", "报告"],
    ["期末报告 占总分的", "期末报告"],
  ])("%j → %j", (input, title) => {
    expect(cleanTitle(input)).toBe(title);
  });

  it("keeps a word that only ends like a label", () => {
    expect(cleanTitle("Lightweight app")).toBe("Lightweight app");
    expect(cleanTitle("Networth")).toBe("Networth");
  });
});
