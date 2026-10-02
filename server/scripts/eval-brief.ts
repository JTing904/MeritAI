// Evaluates the AI brief analysis (M6 spec §4) on real briefs: the real prompt, a real Gemini model and the
// real post-processing (services/ai-brief.ts analyseBrief → lib/ai/brief-check.ts), then a readable report
// and a check against an expected-facts file per brief. Not part of the test suite (it spends quota).
//
//   cd server
//   npx tsx scripts/eval-brief.ts --model light                    # the training briefs, light model
//   npx tsx scripts/eval-brief.ts --model good --only Assignment   # one brief, the good chain
//   npx tsx scripts/eval-brief.ts --set fixtures --only en-taylors,zh-mkt   # tests/fixtures/briefs (a comma list)
//   npx tsx scripts/eval-brief.ts --replay <run.json>              # the recorded answers again, no calls
//
// Briefs: BRIEF_EVAL_DIR (default ../../training-data/briefs, outside the repo: those briefs are never
// committed) and/or tests/fixtures/briefs. Expected facts: "<brief file>.expected.json" next to a brief.
// The key is GEMINI_TEST_API_KEY from server/.env and is never printed. Each call is counted in
// <out>/calls.json per model and day; --max-good (default 6, all good models together) and --max-light
// (default 40) stop the run before a call over budget.
// Reports go to BRIEF_EVAL_OUT (default the OS temp dir /meritai-eval): eval-<model>-<time>.md and .json.
import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import type { Locale } from "../../shared/constants";
import { apportion, packageCount } from "../../shared/planning";
import { gemini } from "../src/lib/ai/gemini";
import { recommendedOptions, referenceTasks, wrongLanguage } from "../src/lib/ai/brief-check";
import type { BriefOut, BriefTaskOut } from "../src/lib/ai/prompts";
import { redact } from "../src/lib/ai/redact";
import { AiError } from "../src/lib/ai/types";
import { goodChain, lightModel } from "../src/lib/ai/usage";
import { localDate } from "../src/lib/plan/dates";
import { extractBriefText } from "../src/lib/plan/extract";
import { normalizeBrief } from "../src/lib/plan/rules";
import { analyseBrief, type BriefCaller } from "../src/services/ai-brief";
import type { CallOutcome, CallRequest } from "../src/services/ai-call";
import { capBriefText } from "../src/services/brief";

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = (name: string, fallback: string | null = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback;
};
const mode = arg("model", "light") as "light" | "good";
if (mode !== "light" && mode !== "good") throw new Error("--model light|good");
const set = arg("set", "training") as "training" | "fixtures" | "all";
const only = arg("only");
const replay = arg("replay");
const maxGood = Number(arg("max-good", "6"));
const maxLight = Number(arg("max-light", "40"));
const localeArg = arg("locale") as Locale | null;
const teamArg = arg("team");
/** --chain m1,m2: only these good models, in this order (to spare the others' quota). */
const chainArg = arg("chain");

const SERVER = resolve(import.meta.dirname, "..");
const TRAINING = resolve(process.env.BRIEF_EVAL_DIR ?? join(SERVER, "../../training-data/briefs"));
const FIXTURES = join(SERVER, "tests/fixtures/briefs");
const OUT = resolve(process.env.BRIEF_EVAL_OUT ?? join(tmpdir(), "meritai-eval"));
mkdirSync(OUT, { recursive: true });

const key = process.env.GEMINI_TEST_API_KEY?.trim();
if (!key && !replay) throw new Error("GEMINI_TEST_API_KEY is not set in server/.env");

// ─── Budget ──────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const COUNTS = join(OUT, "calls.json");
const counts: Record<string, Record<string, number>> = existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, "utf8")) : {};
const day = (counts[today] ??= {});
const light = lightModel("GEMINI");
const goodUsed = () => Object.entries(day).filter(([m]) => m !== light).reduce((s, [, n]) => s + n, 0);
function spend(model: string): boolean {
  if (model === light ? (day[model] ?? 0) >= maxLight : goodUsed() >= maxGood) return false;
  day[model] = (day[model] ?? 0) + 1;
  writeFileSync(COUNTS, JSON.stringify(counts, null, 2));
  return true;
}

// ─── Calls (live or replayed) ────────────────────────────────────────────────

type Recorded = { purpose: string; model: string; ok: boolean; data: unknown; error?: string };
let recorded: Recorded[] = [];
const replayed: Record<string, Recorded[]> = replay ? JSON.parse(readFileSync(replay, "utf8")).calls : {};

function makeCaller(briefName: string): BriefCaller {
  const queue = [...(replayed[briefName] ?? [])];
  return async <T>(req: CallRequest<T>): Promise<CallOutcome<T>> => {
    if (replay) {
      // The answer that came (a busy model's 503 before it is skipped, as the chain skipped it).
      const ok = queue.findIndex((c) => c.purpose === req.purpose && c.ok);
      const i = ok >= 0 ? ok : queue.findIndex((c) => c.purpose === req.purpose);
      if (i < 0) return { kind: "fail", reason: "ERROR", retry: false, detail: "nothing recorded" };
      const c = queue.splice(i, 1)[0]!;
      recorded.push(c);
      if (!c.ok) return { kind: "fail", reason: "ERROR", retry: false, detail: c.error ?? "recorded failure" };
      return { kind: "ok", data: req.schema.parse(c.data), model: c.model, provider: "GEMINI", tier: c.model === light ? "light" : "good" };
    }
    // The brief itself goes to the chosen model(s); the language repair is always the light model (as in the app).
    const chain = chainArg ? chainArg.split(",").map((m) => m.trim()).filter(Boolean) : goodChain("GEMINI");
    const models = req.purpose === "brief" && mode === "good" ? chain : [light];
    let last = "no model had budget left";
    for (const model of models) {
      if (!spend(model)) {
        last = `budget for ${model} used up (--max-good ${maxGood} / --max-light ${maxLight})`;
        continue;
      }
      const started = Date.now();
      try {
        const res = await gemini.generate(key!, {
          tier: model === light ? "light" : "good",
          model,
          system: req.system,
          parts: req.parts,
          schema: req.schema,
          maxOutputTokens: req.maxOutputTokens,
          purpose: req.purpose,
        });
        console.log(`  ${req.purpose} → ${res.model} ok (${((Date.now() - started) / 1000).toFixed(0)} s)`);
        recorded.push({ purpose: req.purpose, model: res.model, ok: true, data: res.data });
        return { kind: "ok", data: res.data, model: res.model, provider: "GEMINI", tier: model === light ? "light" : "good" };
      } catch (err) {
        const msg = err instanceof AiError ? `${err.kind}: ${err.message}` : String((err as Error)?.message ?? err);
        last = redact(msg, [key], 200);
        console.log(`  ${req.purpose} → ${model} failed: ${last}`);
        recorded.push({ purpose: req.purpose, model, ok: false, data: null, error: last });
        if (err instanceof AiError && err.kind === "INVALID") break;
      }
    }
    return { kind: "fail", reason: "ERROR", retry: false, detail: last };
  };
}

// ─── Briefs ──────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

type Expected = {
  brief?: string;
  project?: { locale?: Locale; teamSize?: number; leaderManages?: boolean };
  facts: Fact[];
};
type Fact = { id: string; desc: string; check: string; [k: string]: unknown };

function briefFiles(): string[] {
  const list: string[] = [];
  const add = (dir: string) => {
    if (!existsSync(dir)) return console.warn(`no folder ${dir}`);
    for (const f of readdirSync(dir).sort()) {
      if (!MIME[extname(f).toLowerCase()]) continue;
      // The report template the group follows is not a brief.
      if (/template/i.test(f) || f === "blank.txt") continue;
      list.push(join(dir, f));
    }
  };
  if (set !== "fixtures") add(TRAINING);
  if (set !== "training") add(FIXTURES);
  const wanted = (only ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return list.filter((f) => wanted.length === 0 || wanted.some((w) => basename(f).toLowerCase().includes(w)));
}

// ─── Report helpers ──────────────────────────────────────────────────────────

const weightOf = (t: { points: number }) => Math.min(1000, Math.max(0.1, Number.isFinite(t.points) ? t.points : 1));

/** Tenths per task as the draft will show them (the reference plan adds up to 1000). */
function tenths(out: BriefOut): Map<BriefTaskOut, number> {
  const ref = referenceTasks(out);
  const exact = apportion(ref.map(weightOf));
  const total = ref.reduce((s, t) => s + weightOf(t), 0) || 1;
  const map = new Map<BriefTaskOut, number>();
  ref.forEach((t, i) => map.set(t, exact[i]!));
  for (const q of out.questions) for (const o of q.options) for (const t of o.tasks) if (!map.has(t)) map.set(t, Math.round((weightOf(t) * 1000) / total));
  return map;
}

const pts = (n: number | undefined) => ((n ?? 0) / 10).toFixed(1);
const cell = (s: string | null | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");

function taskRows(tasks: BriefTaskOut[], points: Map<BriefTaskOut, number>): string[] {
  return [
    "| # | title | kind | part | feature | pts | h | prereq |",
    "|---|---|---|---|---|---|---|---|",
    ...tasks.map((t, i) => `| ${i + 1} | ${cell(t.title)} | ${t.kind} | ${cell(t.part)} | ${cell(t.feature)} | ${pts(points.get(t))} | ${t.estimateHours} | ${cell(t.prereqTitle)} |`),
  ];
}

// ─── Expected facts ──────────────────────────────────────────────────────────

const re = (s: unknown) => new RegExp(String(s), "i");
/** field "title": the title only; "done": title and checklist; default: everything the task says. */
const textOf = (t: BriefTaskOut, field: unknown) =>
  field === "title" ? t.title : field === "done" ? [t.title, ...t.checklist].join(" \n ") : [t.title, t.part ?? "", ...t.howto, ...t.checklist].join(" \n ");

function checkFact(f: Fact, out: BriefOut, ctx: { packageCount: number; teamSize: number; locale: Locale }): { pass: boolean; detail: string } {
  const all = [...out.tasks, ...out.questions.flatMap((q) => q.options.flatMap((o) => o.tasks))];
  switch (f.check) {
    case "question": {
      const q = out.questions.find((x) => !f.type || x.type === f.type) ?? out.questions[0];
      if (!q) return { pass: false, detail: "no question" };
      const want = (f.options as string[]) ?? [];
      const missing = want.filter((p) => !q.options.some((o) => re(p).test(`${o.label} ${o.summary}`)));
      const pickOk = f.pickCount === undefined || (q.type === "METHOD" ? 1 : q.pickCount) === f.pickCount;
      const countOk = f.optionCount === undefined || q.options.length === f.optionCount;
      const typeOk = !f.type || q.type === f.type;
      return {
        pass: typeOk && pickOk && countOk && missing.length === 0,
        detail: `${q.type} pick ${q.pickCount}, ${q.options.length} options (${q.options.map((o) => o.label).join(" / ")})${missing.length ? `; missing ${missing.join(", ")}` : ""}`,
      };
    }
    case "partShare": {
      const points = tenths(out);
      const ref = referenceTasks(out);
      const groups = f.parts as { match: string; share: number }[];
      const sums = groups.map(() => 0);
      for (const t of ref) {
        const i = groups.findIndex((g) => re(g.match).test(t.part ?? ""));
        const j = i >= 0 ? i : groups.findIndex((g) => re(g.match).test(t.title));
        if (j >= 0) sums[j]! += points.get(t) ?? 0;
      }
      const tol = Number(f.tolerance ?? 0.05);
      const shares = sums.map((s) => s / 1000);
      const pass = groups.every((g, i) => Math.abs(shares[i]! - g.share) <= tol);
      return { pass, detail: groups.map((g, i) => `${g.match.split("|")[0]} ${(shares[i]! * 100).toFixed(0)}% (want ${(g.share * 100).toFixed(0)}%)`).join(", ") };
    }
    case "tasks": {
      const scope = f.scope === "base" ? out.tasks : all;
      const want = f.all as string[];
      const missing = want.filter((p) => !scope.some((t) => re(p).test(textOf(t, f.field))));
      return { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : `all ${want.length} found` };
    }
    case "perOption": {
      const q = out.questions[0];
      if (!q) return { pass: false, detail: "no question" };
      const count = f.count === "packageCount" ? ctx.packageCount : Number(f.count);
      const per = q.options.map((o) => o.tasks.filter((t) => re(f.match).test(t.title)).length);
      return { pass: per.every((n) => n === count), detail: `want ${count} per option, got ${per.join(", ")}` };
    }
    case "count": {
      // Exactly `count` (a number or "packageCount") tasks whose text (`field`: see textOf) matches `match` and
      // whose title doesn't match `not`; with distinctFeatures, each has its own feature.
      const scope = f.scope === "base" ? out.tasks : all;
      const want = f.count === "packageCount" ? ctx.packageCount : Number(f.count);
      const hits = scope.filter((t) => re(f.match).test(textOf(t, f.field)) && !(f.not && re(f.not).test(t.title)));
      const features = new Set(hits.map((t) => t.feature ?? ""));
      const featuresOk = !f.distinctFeatures || (features.size === hits.length && !features.has(""));
      return { pass: hits.length === want && featuresOk, detail: `want ${want}, got ${hits.length}${hits.length ? `: ${hits.map((t) => `${t.title}${f.distinctFeatures ? ` [${t.feature ?? "—"}]` : ""}`).join(" / ")}` : ""}` };
    }
    case "titlesWithout": {
      // Tasks whose title matches `match` never name anything matching `forbid` in their title.
      const hits = all.filter((t) => re(f.match).test(t.title));
      const bad = hits.filter((t) => re(f.forbid).test(t.title));
      return { pass: hits.length > 0 && bad.length === 0, detail: bad.length ? `${bad.length} name a method: ${bad.slice(0, 4).map((t) => t.title).join(" / ")}` : `${hits.length} titles, none names a method (e.g. ${hits[0]?.title ?? "—"})` };
    }
    case "noQuestion":
      return { pass: out.questions.length === 0, detail: out.questions.length ? `${out.questions.length} question(s): ${out.questions.map((q) => q.prompt).join(" / ")}` : "none" };
    case "noMeetingFirst":
      return { pass: out.meetingFirst === null, detail: out.meetingFirst ? `meetingFirst: ${out.meetingFirst.title}` : "none" };
    case "language": {
      const bad = [...all.map((t) => t.title), ...out.questions.flatMap((q) => [q.prompt, ...q.options.map((o) => o.label)])].filter((s) => wrongLanguage(s, ctx.locale));
      return { pass: bad.length === 0, detail: bad.length ? `${bad.length} wrong: ${bad.slice(0, 5).join(" / ")}` : "all titles and labels in the project language" };
    }
    case "minTasks": {
      const n = referenceTasks(out).length;
      const want = f.perPackage ? Number(f.perPackage) * ctx.packageCount : Number(f.min);
      return { pass: n >= want, detail: `${n} tasks in the reference plan (want ≥ ${want})` };
    }
    case "context": {
      const sizes = (f.teamSizes as number[]) ?? [];
      return { pass: sizes.includes(ctx.teamSize), detail: `evaluated with a team of ${ctx.teamSize} (brief allows ${sizes.join("–")})` };
    }
    default:
      return { pass: false, detail: `unknown check ${f.check}` };
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const report: string[] = [`# Brief analysis eval — ${replay ? `replay of ${basename(replay)}` : `model ${mode}`} — ${new Date().toISOString()}`, ""];
const raw: { calls: Record<string, Recorded[]>; results: Record<string, unknown> } = { calls: {}, results: {} };
const summary: string[] = [];

for (const file of briefFiles()) {
  const name = basename(file);
  const expectedPath = `${file}.expected.json`.replace(/\.(pdf|docx|txt|md)\.expected\.json$/i, ".expected.json");
  const expected: Expected | null = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : null;
  const locale: Locale = localeArg ?? expected?.project?.locale ?? (name.startsWith("zh-") ? "zh" : "en");
  const teamSize = teamArg ? Number(teamArg) : (expected?.project?.teamSize ?? 3);
  const leaderManages = expected?.project?.leaderManages ?? false;
  const pc = packageCount(teamSize, leaderManages);
  console.log(`${name} (${locale}, team ${teamSize})`);

  const bytes = new Uint8Array(readFileSync(file));
  const mimeType = MIME[extname(file).toLowerCase()]!;
  const extracted = await extractBriefText(bytes, name, mimeType);
  const text = extracted.ok ? capBriefText(normalizeBrief(extracted.text), locale).text : null;
  const briefFile = !extracted.ok && (mimeType === "application/pdf" || mimeType.startsWith("image/")) ? { bytes, mimeType, name } : null;
  if (!text && !briefFile) {
    console.log("  skipped (no text)");
    continue;
  }
  const now = new Date();
  const zone = "Asia/Kuala_Lumpur";
  const ctx = {
    locale,
    today: localDate(now, zone),
    deadline: localDate(new Date(now.getTime() + 56 * 86_400_000), zone),
    timezone: zone,
    teamSize,
    packageCount: pc,
    projectName: name.replace(/\.[^.]+$/, ""),
  };
  recorded = [];
  const started = Date.now();
  const res = await analyseBrief(makeCaller(name), { ctx, text, file: briefFile });
  raw.calls[name] = recorded;
  report.push(`## ${name}`, "", `locale ${locale} · team ${teamSize} · ${pc} packages · ${text ? `${text.split("\n").length} lines of text` : "sent as a file"} · ${((Date.now() - started) / 1000).toFixed(0)} s · calls: ${recorded.map((c) => `${c.purpose}→${c.model}${c.ok ? "" : " ✗"}`).join(", ")}`, "");
  if (res.kind !== "ok") {
    report.push(`**Failed**: ${res.kind === "fail" ? res.detail : "wait"}`, "");
    summary.push(`${name}: failed`);
    continue;
  }
  const out = res.data;
  raw.results[name] = out;
  const points = tenths(out);
  report.push("Checks:", ...res.notes.map((n) => `- ${n}`), "");
  const ref = referenceTasks(out);
  const hours = ref.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  report.push(`Reference plan: ${ref.length} tasks, ${hours.toFixed(0)} h, ${[...new Set(ref.map((t) => t.part ?? "—"))].map((p) => `${p} ${pts(ref.filter((t) => (t.part ?? "—") === p).reduce((s, t) => s + (points.get(t) ?? 0), 0))}`).join(" · ")}`, "");
  report.push(`meetingFirst: ${out.meetingFirst ? `${out.meetingFirst.title} — ${out.meetingFirst.why}` : "none"}`, "");
  report.push("### Top-level tasks", "", ...taskRows(out.tasks, points), "");
  for (const [qi, q] of out.questions.entries()) {
    const rec = recommendedOptions(q);
    report.push(`### Question ${qi + 1}: ${q.prompt} (${q.type}, pick ${q.pickCount})`, "");
    for (const [oi, o] of q.options.entries()) {
      report.push(`**${String.fromCharCode(65 + oi)}. ${o.label}**${rec.has(oi) ? " ★ recommended" : ""} — ${o.hours} h, material ${o.material}, difficulty ${o.difficulty}. ${o.summary}`, "");
      if (o.pros.length || o.cons.length) report.push(`pros: ${o.pros.join("; ")} · cons: ${o.cons.join("; ")}`, "");
      report.push(...taskRows(o.tasks, points), "");
    }
  }
  const first = ref[0];
  if (first) report.push(`Sample howto / checklist (${first.title}): ${first.howto.join(" → ")} ‖ ${first.checklist.join(" · ")}`, "");
  if (expected) {
    const results = expected.facts.map((f) => ({ f, ...checkFact(f, out, { packageCount: pc, teamSize, locale }) }));
    const passed = results.filter((r) => r.pass).length;
    report.push(`### Expected facts: ${passed}/${results.length} pass`, "", "| fact | result | detail |", "|---|---|---|", ...results.map((r) => `| ${cell(r.f.desc)} | ${r.pass ? "PASS" : "FAIL"} | ${cell(r.detail)} |`), "");
    summary.push(`${name}: ${passed}/${results.length} facts (${res.model})`);
  } else summary.push(`${name}: ${ref.length} tasks, ${out.questions.length} questions (${res.model}), no expected facts`);
}

report.splice(2, 0, "Summary:", ...summary.map((s) => `- ${s}`), `- calls today: ${JSON.stringify(day)}`, "");
const base = join(OUT, `eval-${replay ? "replay" : mode}-${stamp}`);
writeFileSync(`${base}.md`, report.join("\n"), "utf8");
writeFileSync(`${base}.json`, JSON.stringify(raw, null, 2), "utf8");
console.log(summary.join("\n"));
console.log(`report: ${base}.md`);
