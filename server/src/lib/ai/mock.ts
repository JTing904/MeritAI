// The mock provider (AI_MOCK=1; tests and development only, refused in production — lib/ai/index.ts).
// Deterministic answers without any network:
// - brief: one task per substantial line of the fenced brief; a PICK_N question (5 cases, pick 2) when the
//   brief says 「任选」 / "choose"; a METHOD question (Waterfall / Agile / RAD) when it says "Waterfall" /
//   「做法」; meetingFirst when two or more code tasks come out.
// - brief-fix: every string back unchanged.
// - howto: two steps and two checklist items.
// - grade: by a marker word inside the fenced evidence only: #excellent, #half, #fail (default: PASS).
// Failures: AI_MOCK_FAIL=QUOTA|INVALID|TRANSIENT for every call, or mockAi.failNext(...) from a test.
import type { AiProviderName } from "../../../../shared/constants";
import { guessKind } from "../plan/rules";
import { unfence } from "./fence";
import { goodChain, lightModel } from "./usage";
import type { BriefFixOut, BriefOut, BriefTaskOut, GradeOut, HowtoOut } from "./prompts";
import { AiError, type AiErrorKind, type AiProvider, type AiTier, type GenerateInput, type GenerateResult } from "./types";

type Planned = { kind: AiErrorKind; tier?: AiTier; purpose?: string; model?: string };
export type MockCall = { provider: AiProviderName; purpose: string; tier: AiTier; model: string; text: string };

const planned: Planned[] = [];
const calls: MockCall[] = [];

/** Test hooks. */
export const mockAi = {
  /** The next matching call(s) throw this AiError kind. */
  failNext(kind: AiErrorKind, opts: { times?: number; tier?: AiTier; purpose?: string; model?: string } = {}) {
    for (let i = 0; i < (opts.times ?? 1); i++) planned.push({ kind, tier: opts.tier, purpose: opts.purpose, model: opts.model });
  },
  calls(): readonly MockCall[] {
    return calls;
  },
  reset() {
    planned.length = 0;
    calls.length = 0;
  },
};

function plannedFailure(tier: AiTier, purpose: string, model: string): AiErrorKind | null {
  const forced = process.env.AI_MOCK_FAIL?.trim().toUpperCase();
  if (forced === "QUOTA" || forced === "INVALID" || forced === "TRANSIENT") return forced;
  const i = planned.findIndex((p) => (!p.tier || p.tier === tier) && (!p.purpose || p.purpose === purpose) && (!p.model || p.model === model));
  if (i < 0) return null;
  return planned.splice(i, 1)[0]!.kind;
}

/** Every fenced block in the request, whatever its nonce. */
function blocks(text: string): { label: string; content: string }[] {
  const nonce = /<<<[A-Z0-9 _-]+ ([A-Za-z0-9_-]+)>>>/.exec(text)?.[1];
  return nonce ? unfence(text, nonce) : [];
}

const task = (title: string, over: Partial<BriefTaskOut> = {}): BriefTaskOut => ({
  title,
  kind: guessKind(title),
  points: 10,
  estimateHours: 5,
  suggestedDue: null,
  milestone: null,
  feature: null,
  part: null,
  briefFrom: null,
  briefTo: null,
  quote: null,
  howto: [`先读作业要求里「${title.slice(0, 20)}」这一项`, "做完后对照清单检查一遍"],
  checklist: [`完成「${title.slice(0, 20)}」`, "按要求的格式提交"],
  prereqTitle: null,
  ...over,
});

function mockBrief(text: string): BriefOut {
  const brief = blocks(text).find((b) => b.label === "BRIEF")?.content ?? "";
  const lines = brief.split("\n").map((l) => {
    const m = /^(\d+)\| ?(.*)$/.exec(l);
    return m ? { no: Number(m[1]), text: m[2]!.trim() } : { no: 0, text: l.trim() };
  });
  const tasks: BriefTaskOut[] = [];
  for (const l of lines) {
    const title = l.text.replace(/^([-*•·]|\d+[.)、]|[（(]?[a-z一二三四五六七八九十][)）.、])\s*/i, "").trim();
    if (title.length < 2 || /[:：]$/.test(title)) continue;
    if (/任选|choose|waterfall|做法/i.test(title)) continue;
    tasks.push(task(title.slice(0, 150), { briefFrom: l.no || null, briefTo: l.no || null }));
    if (tasks.length >= 12) break;
  }
  if (tasks.length === 0) tasks.push(task("读图片里的作业要求并完成", { quote: "（来自文件）" }));

  const questions: BriefOut["questions"] = [];
  if (/任选|choose/i.test(brief)) {
    const cases = ["Carousell", "闲鱼", "Facebook Marketplace", "Mudah.my", "Shopee 二手区"];
    questions.push({
      prompt: "5 个案例任选 2 个",
      quote: lines.find((l) => /任选|choose/i.test(l.text))?.text ?? null,
      type: "PICK_N",
      pickCount: 2,
      options: cases.map((name, i) => ({
        label: name,
        summary: `${name} 的功能和流程对比`,
        hours: 8 + i,
        material: i < 2 ? "HIGH" : "MID",
        difficulty: i < 2 ? "LOW" : "MID",
        pros: [],
        cons: [],
        recommended: i < 2,
        tasks: [task(`${name} 案例分析`, { kind: "RESEARCH", points: 5 }), task(`${name} 流程截图`, { kind: "DESIGN", points: 4 })],
      })),
    });
  }
  if (/waterfall|做法/i.test(brief)) {
    const methods = [
      { label: "Waterfall 瀑布式", pros: ["步骤清楚，好分工"], cons: ["到最后才有能用的版本"], hours: 150 },
      { label: "Agile（Scrum）", pros: ["早发现、早改"], cons: ["每周要开短会"], hours: 140 },
      { label: "RAD 快速原型", pros: ["很快就有东西能展示"], cons: ["要反复找人试用"], hours: 165 },
    ];
    questions.push({
      prompt: "选一种开发流程",
      quote: lines.find((l) => /waterfall|做法/i.test(l.text))?.text ?? null,
      type: "METHOD",
      pickCount: 1,
      options: methods.map((m, i) => ({
        label: m.label,
        summary: `${m.label} 的做法`,
        hours: m.hours,
        material: "MID",
        difficulty: "MID",
        pros: m.pros,
        cons: m.cons,
        recommended: i === 1,
        tasks: [task(`${m.label} 计划书`, { kind: "DOC", points: 6 }), task(`${m.label} 过程记录`, { kind: "DOC", points: 4 })],
      })),
    });
  }
  // Code modules are features of their own; each one after the first waits for the first (「登录模块完成后…」).
  const code = tasks.filter((t) => t.kind === "CODE");
  code.forEach((t, i) => {
    t.feature = t.title.slice(0, 40);
    if (i > 0) t.prereqTitle = code[0]!.title;
  });
  return { tasks, questions, meetingFirst: code.length >= 2 ? { title: "一起定好接口和数据格式", why: "模块互相依赖，先定接口，再用假数据各做各的。" } : null };
}

function mockGrade(text: string): GradeOut {
  // Only the evidence counts: instructions anywhere else (or outside a fence) change nothing.
  const evidence = blocks(text)
    .filter((b) => b.label.startsWith("EVIDENCE"))
    .map((b) => b.content)
    .join("\n")
    .toLowerCase();
  if (evidence.includes("#fail")) {
    return { score: 20, reasons: ["少了作业要求的主要内容", "没有对照清单完成"], suggestions: ["按清单把缺的部分补上再交"], summary: "这份还不够，照理由改好再交。" };
  }
  if (evidence.includes("#half")) {
    return { score: 50, reasons: ["只访问了 3 个人，要求至少 5 个", "没有图表"], suggestions: ["再访 2 个人", "做至少 2 张图"], summary: "做到一半，改好重交可以拿满。" };
  }
  if (evidence.includes("#excellent")) return { score: 92, reasons: [], suggestions: [], summary: "做得很好，清单都做到了。" };
  return { score: 75, reasons: [], suggestions: ["结论可以再写清楚一点"], summary: "合格，清单基本都做到了。" };
}

/** brief-fix: every string comes back unchanged (as a model keeping a product name would answer). */
function mockFix(text: string): BriefFixOut {
  const raw = blocks(text).find((b) => b.label === "STRINGS")?.content ?? "[]";
  try {
    const items = JSON.parse(raw) as { id: string; text: string }[];
    return { items: items.map((i) => ({ id: i.id, text: i.text })) };
  } catch {
    return { items: [] };
  }
}

const mockHowto = (): HowtoOut => ({ howto: ["先看作业要求里这一项", "分步骤做完", "对照清单检查"], checklist: ["内容完整", "按要求格式提交"] });

export function mockProvider(name: AiProviderName): AiProvider {
  return {
    name,
    model(tier: AiTier) {
      return tier === "good" ? goodChain(name)[0]! : lightModel(name);
    },
    async checkKey(key: string) {
      if (/invalid|bad/i.test(key)) throw new AiError("INVALID", "mock: key refused", 400);
      if (/down/i.test(key)) throw new AiError("TRANSIENT", "mock: unreachable");
    },
    async generate<T>(_key: string, input: GenerateInput<T>): Promise<GenerateResult<T>> {
      const text = input.parts.map((p) => ("text" in p ? p.text : `[file ${p.name} ${p.mimeType}]`)).join("\n");
      // The mock answers as the model it was asked for (the real ids, so the chain can be tested).
      const model = input.model;
      calls.push({ provider: name, purpose: input.purpose, tier: input.tier, model, text });
      const failure = plannedFailure(input.tier, input.purpose, model);
      if (failure) throw new AiError(failure, `mock: simulated ${failure}`, failure === "QUOTA" ? 429 : failure === "INVALID" ? 400 : 503);
      const answer =
        input.purpose === "brief" ? mockBrief(text) : input.purpose === "brief-fix" ? mockFix(text) : input.purpose === "grade" ? mockGrade(text) : mockHowto();
      return { data: input.schema.parse(answer), model };
    },
  };
}
