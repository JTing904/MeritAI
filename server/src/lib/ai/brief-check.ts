// Deterministic checks on the model's brief analysis (M6 spec §4), run before the answer is saved, so the
// plan's quality doesn't depend on which model answered (the good chain or the light fallback):
// - language: strings not in the project's language are found here and translated by one light call
//   (ai-brief.ts); the answer is only accepted string by string when it is in the right language;
// - tidying: tasks without points get them from their hours; the brief's numbering comes off option labels;
//   report sections chained one after another run in parallel;
// - each member: 「每个组员各做一份」 in the brief → exactly packageCount numbered tasks for it (per option
//   when the work lives inside a 选择题's options); 「个人方案 N」 titles come off when the brief never said so;
//   a method the brief only gave as an example ("e.g., ANN, SVM") comes off those titles;
// - per member: graded components the brief marks "(Individual)" and what each student must do personally
//   (sign the plagiarism form, present their own work, peer evaluation, reflection, contribution) → exactly
//   packageCount copies 「…（第 n 份）」, one per package;
// - coverage: forms, declarations, the demo / Q&A… the brief asks for get a small task when none covers them;
// - meetingFirst: dropped unless two code tasks of different features wait for one another (never when each
//   member builds an independent solution); one about something else (「选出最好的点子」) becomes a task;
// - hours: clamped to 0.5–10 (soft: the task is kept);
// - part weights: the brief's own weights (its numbered summary 「1. Idea Generation 20 marks」, else what the
//   rules parser finds: 「Documentation (40%)」, a marks table);
//   each part's tasks are rescaled to its share when the model named the part of (almost) every task;
// - too few tasks: tells the caller to ask once more with a stronger instruction.
// Everything here is pure (no network, no database): tests/brief-check.test.ts.
import type { Locale } from "../../../../shared/constants";
import { normalizeBrief, parseBriefWithRules } from "../plan/rules";
import type { BriefOut, BriefTaskOut } from "./prompts";
import { clampNumber } from "./sanitize";

export type GradedPart = { name: string; weight: number };
type Question = BriefOut["questions"][number];
type Option = Question["options"][number];

const MAX_TITLE = 120;
const weight = (t: Pick<BriefTaskOut, "points">) => clampNumber(t.points, 0.1, 1000, 1);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Letters and CJK only: "Prototype development (60%)" and "prototype-development" compare equal. */
const key = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");

// ─── Walking the answer ──────────────────────────────────────────────────────

/** The option indexes a question recommends: the model's own (up to pickCount), then the least work. */
export function recommendedOptions(q: Pick<Question, "type" | "pickCount" | "options">): Set<number> {
  const options = q.options;
  const pickCount = q.type === "METHOD" ? 1 : Math.round(clampNumber(q.pickCount, 1, Math.max(1, options.length - 1), 1));
  const rec = options.map((o, i) => ({ o, i })).filter((x) => x.o.recommended).map((x) => x.i).slice(0, pickCount);
  for (const i of [...options.keys()].sort((a, b) => options[a]!.hours - options[b]!.hours)) {
    if (rec.length >= pickCount) break;
    if (!rec.includes(i)) rec.push(i);
  }
  return new Set(rec);
}

/** The plan as it stands before anyone picks: the top-level tasks plus the recommended options' tasks. */
export function referenceTasks(out: BriefOut): BriefTaskOut[] {
  const tasks = [...out.tasks];
  for (const q of out.questions) {
    const rec = recommendedOptions(q);
    q.options.forEach((o, i) => rec.has(i) && tasks.push(...o.tasks));
  }
  return tasks;
}

/** Every task in the answer (top level and every option's). */
export function allTasks(out: BriefOut): BriefTaskOut[] {
  return [...out.tasks, ...out.questions.flatMap((q) => q.options.flatMap((o) => o.tasks))];
}

/** What a task promises: its title, graded part and definition of done (a passing mention in a step doesn't count). */
const taskText = (t: BriefTaskOut) => [t.title, t.part ?? "", ...t.checklist].join(" \n ");

// ─── Language ────────────────────────────────────────────────────────────────

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * Whether a string is in the wrong language for the project: in a zh project, one with no Chinese
 * character at all (「监督式机器学习（Machine Learning）」 is fine); in an en project, one with Chinese in it.
 * Strings without words (numbers, a URL, "A") are never wrong.
 */
export function wrongLanguage(text: string, locale: Locale): boolean {
  const s = text.replace(/https?:\/\/\S+/g, "").trim();
  if (!s) return false;
  if (locale === "zh") return !CJK_RE.test(s) && /[A-Za-z]{3,}/.test(s);
  return CJK_RE.test(s);
}

type Slot = { id: string; text: string; set: (value: string) => void };

/** Every string the leader reads, with a setter. Feature and milestone names count once each. */
function slots(out: BriefOut): Slot[] {
  const list: Slot[] = [];
  const add = (id: string, text: string, set: (v: string) => void) => list.push({ id, text, set });
  const addTask = (prefix: string, t: BriefTaskOut) => {
    add(`${prefix}.title`, t.title, (v) => (t.title = v));
    t.howto.forEach((s, i) => add(`${prefix}.howto.${i}`, s, (v) => (t.howto[i] = v)));
    t.checklist.forEach((s, i) => add(`${prefix}.check.${i}`, s, (v) => (t.checklist[i] = v)));
  };
  out.tasks.forEach((t, i) => addTask(`t${i}`, t));
  out.questions.forEach((q, qi) => {
    add(`q${qi}.prompt`, q.prompt, (v) => (q.prompt = v));
    q.options.forEach((o, oi) => {
      const p = `q${qi}.o${oi}`;
      add(`${p}.label`, o.label, (v) => (o.label = v));
      add(`${p}.summary`, o.summary, (v) => (o.summary = v));
      o.pros.forEach((s, i) => add(`${p}.pro.${i}`, s, (v) => (o.pros[i] = v)));
      o.cons.forEach((s, i) => add(`${p}.con.${i}`, s, (v) => (o.cons[i] = v)));
      o.tasks.forEach((t, ti) => addTask(`${p}.t${ti}`, t));
    });
  });
  if (out.meetingFirst) {
    const m = out.meetingFirst;
    add("meeting.title", m.title, (v) => (m.title = v));
    add("meeting.why", m.why, (v) => (m.why = v));
  }
  const tasks = allTasks(out);
  for (const field of ["feature", "milestone"] as const) {
    const names = [...new Set(tasks.map((t) => t[field]).filter((n): n is string => !!n))];
    names.forEach((name, i) =>
      add(`${field}.${i}`, name, (v) => {
        for (const t of tasks) if (t[field] === name) t[field] = v;
      }),
    );
  }
  return list;
}

/** The strings a repair call should translate ({ id, text }), at most `max`. */
export function languageRepairs(out: BriefOut, locale: Locale, max = 400): { id: string; text: string }[] {
  return slots(out)
    .filter((s) => wrongLanguage(s.text, locale))
    .slice(0, max)
    .map(({ id, text }) => ({ id, text }));
}

/**
 * A copy of the answer with the repair call's translations applied: only ids that were asked for, only
 * answers now in the right language and of a sane length. Prerequisites follow renamed titles.
 */
export function applyRepairs(out: BriefOut, locale: Locale, answers: { id: string; text: string }[]): { out: BriefOut; applied: number } {
  const copy = structuredClone(out);
  const byId = new Map(slots(copy).map((s) => [s.id, s]));
  const renamed = new Map<string, string>();
  let applied = 0;
  for (const a of answers) {
    const slot = byId.get(a.id);
    const text = typeof a.text === "string" ? a.text.replace(/\s+/g, " ").trim() : "";
    if (!slot || !text || !wrongLanguage(slot.text, locale) || wrongLanguage(text, locale)) continue;
    if (text.length > slot.text.length * 4 + 60) continue;
    if (a.id.endsWith(".title")) renamed.set(norm(slot.text), text);
    slot.set(text);
    byId.delete(a.id);
    applied++;
  }
  if (renamed.size) for (const t of allTasks(copy)) if (t.prereqTitle && renamed.has(norm(t.prereqTitle))) t.prereqTitle = renamed.get(norm(t.prereqTitle))!;
  return { out: copy, applied };
}

// ─── Part weights ────────────────────────────────────────────────────────────

/**
 * The brief's graded parts with their weights, when the free rules parser finds a mark sheet in it
 * (「Documentation (40%)」「Prototype development (60%)」, 「书面报告（40 分）」, a marks table): 2–12 parts.
 */
export function gradedParts(briefText: string | null): GradedPart[] | null {
  if (!briefText?.trim()) return null;
  const summary = assessmentSummary(briefText);
  if (summary) return summary;
  const r = parseBriefWithRules(normalizeBrief(briefText));
  if (!r.ok || r.method !== "SCORES") return null;
  const merged = new Map<string, GradedPart>();
  for (const t of r.tasks) {
    const k = key(t.title);
    if (!k || !(t.weight > 0)) continue;
    const had = merged.get(k);
    if (had) had.weight += t.weight;
    else merged.set(k, { name: t.title, weight: t.weight });
  }
  const parts = [...merged.values()];
  return parts.length >= 2 && parts.length <= 12 ? parts : null;
}

/** 「1. Idea Generation  20 marks (Individual)」「2. Prototype development (60%)」「3、书面报告（40 分）」. */
const SUMMARY_LINE_RE = /^\s*(?:\d{1,2}|[一二三四五六七八九十])\s*[.)、]\s*([A-Za-z一-鿿][^\d%()（）:：]{1,60}?)\s*[:：\-–]?\s*[(（]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|marks?\b|分)/i;

/**
 * The brief's own summary of its graded parts: numbered lines with a weight each, a few lines apart at
 * most, adding up to 100 (「Assessment: 1. Idea Generation 20 marks … 2. … 3. …」). Read before the rules
 * parser, which can take a rubric table's cells for parts when the brief has one. 2–8 parts, else null.
 */
export function assessmentSummary(briefText: string): GradedPart[] | null {
  const lines = briefText.split("\n");
  let run: GradedPart[] = [];
  let gap = 0;
  const done = (parts: GradedPart[]) => parts.length >= 2 && parts.length <= 8 && Math.abs(parts.reduce((s, p) => s + p.weight, 0) - 100) < 0.5;
  for (const line of lines) {
    const m = line.match(SUMMARY_LINE_RE);
    if (m) {
      const name = m[1]!.replace(/[\s:：\-–]+$/, "").trim();
      if (name.length >= 2) {
        run.push({ name, weight: Number(m[2]) });
        gap = 0;
        if (done(run)) return run;
        continue;
      }
    }
    if (line.trim() && ++gap > 3) {
      run = [];
      gap = 0;
    }
  }
  return null;
}

/** The graded part a task names (exact name, or one name containing the other), else -1. */
export function partIndex(part: string | null | undefined, parts: GradedPart[]): number {
  const k = key(part);
  if (k.length < 3) return -1;
  let best = -1;
  for (const [i, p] of parts.entries()) {
    const pk = key(p.name);
    if (pk.length < 3) continue;
    if (pk === k) return i;
    if ((k.includes(pk) || pk.includes(k)) && (best < 0 || pk.length > key(parts[best]!.name).length)) best = i;
  }
  return best;
}

/** Tasks not tied to a part may carry at most this share of the plan for the rescale to go ahead. */
const MAX_UNMAPPED_SHARE = 0.3;

/**
 * Rescales points (in place) so each graded part's tasks carry the part's share of the plan, when the
 * mapping is reliable: every part has a task, and tasks without a part carry ≤ 30 %. Measured on the
 * reference plan (top level + recommended options); the same factor applies to every option's tasks
 * of that part. Returns what it did, for the notes.
 */
export function rescaleToParts(out: BriefOut, parts: GradedPart[] | null): string {
  if (!parts) return "parts: none in the brief";
  const ref = referenceTasks(out);
  const current = parts.map(() => 0);
  let unmapped = 0;
  for (const t of ref) {
    const i = partIndex(t.part, parts);
    if (i < 0) unmapped += weight(t);
    else current[i]! += weight(t);
  }
  const total = current.reduce((a, b) => a + b, 0) + unmapped;
  const missing = parts.filter((_, i) => current[i] === 0).map((p) => p.name);
  if (missing.length) return `parts: no task for ${missing.join(", ")}; points kept`;
  if (total <= 0 || unmapped / total > MAX_UNMAPPED_SHARE) return `parts: ${Math.round((unmapped / total) * 100)}% of the points have no part; points kept`;
  const mapped = total - unmapped;
  const sumW = parts.reduce((s, p) => s + p.weight, 0);
  const factor = parts.map((p, i) => (mapped * (p.weight / sumW)) / current[i]!);
  for (const t of allTasks(out)) {
    const i = partIndex(t.part, parts);
    t.points = weight(t) * (i < 0 ? 1 : factor[i]!);
    // The brief's own name ("Documentation = 40" copied from the list → "Documentation").
    if (i >= 0) t.part = parts[i]!.name;
  }
  // A readable scale: the reference plan adds up to 1000.
  const after = referenceTasks(out).reduce((s, t) => s + weight(t), 0);
  if (after > 0) for (const t of allTasks(out)) t.points = Math.max(0.1, (t.points * 1000) / after);
  return `parts: rescaled to ${parts.map((p) => `${p.name} ${p.weight}`).join(" / ")}`;
}

// ─── Each member does their own ──────────────────────────────────────────────

const EACH_EN_RE =
  /\b(?:each|every)\s+(?:(?:group|team)\s+)?(?:member|student)s?\b[^.;]{0,40}?\b(?:must|is\s+required\s+to|are\s+required\s+to|has\s+to|have\s+to|needs?\s+to|should|shall|will)\s+(?:\w+\s+){0,2}?(?:provide|develop|implement|build|create|design|train|code|program|apply|write\s+(?:a|an|their|his|her|own)\s+(?:program|code|model|solution))\b/gi;
const EACH_ZH_RE =
  /(?:每个|每位|每名|每一位|每一个|每|各)(?:组员|成员|同学|学生|人)[^。；;\n]{0,20}?(?:提供|实现|开发|完成|编写|设计|训练|采用|用)[^。；;\n]{0,30}?(?:方案|方法|算法|模型|程序|代码|系统|功能)/g;
const EACH_ZH_NOT_RE = /讲|演示|上台|汇报|口头|填|签|报告/;

/** What each member builds must be a solution / method of their own (not "one module of the system"). */
const OWN_WORK_RE = /solution|method|algorithm|model|approach|technique|chatbot|recommender|classifier|方案|方法|算法|模型/i;

/** How often the brief says each member must build their own solution / use their own method. */
export function eachMemberMentions(briefText: string | null): number {
  if (!briefText) return 0;
  const flat = briefText.replace(/\s+/g, " ");
  const en = [...flat.matchAll(EACH_EN_RE)].filter((m) => OWN_WORK_RE.test(flat.slice(m.index, m.index + m[0].length + 80))).length;
  const zh = [...flat.matchAll(EACH_ZH_RE)].filter((m) => !EACH_ZH_NOT_RE.test(m[0])).length;
  return en + zh;
}

const INDIVIDUAL_RE =
  /individual|each member|per member|member\s*#?\d|(?:solution|method|approach|model|chatbot|system)\s*#?\d\b|own\s+(?:solution|method|model|chatbot|approach)|个人|组员\s*\d|成员\s*\d|方案\s*\d|第\s*\d+\s*份|每人|各自/i;
const IMPL_RE = /solution|implement|model|method|algorithm|classif|cluster|recommend|chatbot|detector|方案|实现|模型|算法|方法|分类|聚类|推荐|聊天机器人/i;
const NOT_IMPL_RE =
  /pre-?process|clean|dataset|data\s+(?:collection|gathering|preparation)|crawl|scrap|interface|\bUI\b|integrat|compar|report|document|presentation|slides|预处理|清洗|数据集|收集|爬|界面|整合|对比|比较|报告|文档|演示/i;
/** A title's shape without its numbers and 「个人方案 N：」-style prefix: numbered copies share it. */
const shape = (title: string) =>
  norm(title)
    .replace(/^(?:individual\s+(?:solution|work|task)|个人方案|个人任务)\s*#?\d*\s*[:：-]?\s*/i, "")
    .replace(/\d+/g, "#");

function individualGroup(tasks: BriefTaskOut[]): BriefTaskOut[] {
  const work = tasks.filter((t) => t.kind === "CODE" || t.kind === "RESEARCH" || t.kind === "DESIGN");
  const groups = (list: BriefTaskOut[]) => {
    const by = new Map<string, BriefTaskOut[]>();
    for (const t of list) by.set(shape(t.title), [...(by.get(shape(t.title)) ?? []), t]);
    return [...by.values()].sort((a, b) => b.length - a.length);
  };
  // 1. Tasks the model marked as individual (「个人方案 2：…」, "Member 1: …"), grouped by their shape.
  const marked = work.filter((t) => INDIVIDUAL_RE.test(t.title));
  if (marked.length) return groups(marked)[0]!.length >= 2 ? groups(marked)[0]! : marked;
  // 2. Numbered look-alikes ("Solution with method 1", "… 2").
  const numbered = groups(work.filter((t) => /\d/.test(t.title)))[0];
  if (numbered && numbered.length >= 2) return numbered;
  // 3. The implementation work itself: one task, or one per method the model already listed.
  return work.filter((t) => t.kind === "CODE" && IMPL_RE.test(t.title) && !NOT_IMPL_RE.test(t.title));
}

/**
 * 「个人方案 n：…」 / "Individual solution n: …": a title already in that form gets its number changed;
 * any other ("Solution (member 2)", 「个人成员方案（2 名成员）」) gets the prefix, without its own numbering.
 */
function numberedTitle(title: string, n: number, locale: Locale): string {
  if (/^\s*(?:individual\s+solution|个人方案)\s*#?\d+/i.test(title)) return title.replace(/\d+/, String(n));
  const base = title
    .replace(/^(?:individual\s+(?:solution|work|task)|个人方案|个人任务)\s*#?\d*\s*[:：-]?\s*/i, "")
    .replace(/\s*[(（][^()（）]*\d[^()（）]*[)）]/g, "")
    .replace(/\s*[-–:：]?\s*(?:member|student|组员|成员)\s*#?\d+\s*$/i, "")
    .trim();
  const out = locale === "zh" ? `个人方案 ${n}：${base}` : `Individual solution ${n}: ${base}`;
  return out.length > MAX_TITLE ? `${out.slice(0, MAX_TITLE - 1)}…` : out;
}

/**
 * Makes `list` (one scope: the top-level tasks, or one option's) hold exactly `count` tasks of its
 * individual work, numbered, with equal points and one feature each. Returns the individual tasks
 * (for the meeting check), or null when the scope has no implementation work to multiply.
 */
function normaliseIndividual(list: BriefTaskOut[], count: number, locale: Locale): BriefTaskOut[] | null {
  const group = individualGroup(list);
  if (group.length === 0) return null;
  const first = group[0]!;
  // One task (or numbered copies of one): the copies are numbered too. Several different ones (one per
  // method the model listed): those keep their titles and the extra copies get a generic one.
  const sole = new Set(group.map((t) => shape(t.title))).size === 1;
  const copies = new Set<BriefTaskOut>();
  let kept = group;
  if (group.length > count) {
    kept = group.slice(0, count);
    const extra = group.slice(count);
    const extraPoints = extra.reduce((s, t) => s + weight(t), 0);
    for (const t of kept) t.points = weight(t) + extraPoints / count;
    for (const t of extra) list.splice(list.indexOf(t), 1);
    const gone = new Set(extra.map((t) => norm(t.title)));
    for (const t of list) if (t.prereqTitle && gone.has(norm(t.prereqTitle))) t.prereqTitle = first.title;
  } else if (group.length < count) {
    const at = list.indexOf(group[group.length - 1]!) + 1;
    const added: BriefTaskOut[] = [];
    for (let n = group.length + 1; n <= count; n++) added.push(structuredClone(first));
    list.splice(at, 0, ...added);
    added.forEach((t) => copies.add(t));
    kept = [...group, ...added];
  }
  // Numbered titles (each unique), equal points, a feature each so different people can take them.
  const oldTitles = kept.map((t) => norm(t.title));
  const mean = kept.reduce((s, t) => s + weight(t), 0) / kept.length;
  kept.forEach((t, i) => {
    const n = i + 1;
    if (copies.has(t) && !sole) {
      t.title = locale === "zh" ? `个人方案 ${n}：用另一种方法实现并评估` : `Individual solution ${n}: implement and evaluate another method`;
    } else if (sole || INDIVIDUAL_RE.test(t.title)) t.title = numberedTitle(t.title, n, locale);
    t.points = mean;
    t.feature = locale === "zh" ? `个人方案 ${i + 1}` : `Individual solution ${i + 1}`;
  });
  // Something waiting for the first copy under its old name now waits for its new one.
  for (const t of list) if (t.prereqTitle && oldTitles.includes(norm(t.prereqTitle)) && !kept.includes(t)) t.prereqTitle = kept[0]!.title;
  for (const t of kept) if (t.prereqTitle && oldTitles.includes(norm(t.prereqTitle))) t.prereqTitle = null;
  // A second 「个人方案 3：…」 of another shape (the model wrote member 3's twice): merged into copy 3.
  for (const t of [...list]) {
    const m = kept.includes(t) ? null : t.title.match(STRAY_COPY_RE);
    const into = m ? kept[Math.min(Number(m[1]), kept.length) - 1] : undefined;
    if (!into) continue;
    // Its points shared by every copy, so the copies stay equal.
    for (const k of kept) k.points += weight(t) / kept.length;
    into.howto = [...into.howto, ...t.howto].filter((s, i, a) => a.indexOf(s) === i).slice(0, 6);
    list.splice(list.indexOf(t), 1);
    for (const o of list) if (o.prereqTitle && norm(o.prereqTitle) === norm(t.title)) o.prereqTitle = o === into ? null : into.title;
  }
  return kept;
}

const STRAY_COPY_RE = /^\s*(?:individual\s+solution|[个個]人方案)\s*#?(\d+)\s*[:：\-–]/i;

const MARK_PREFIX_RE = /^\s*(?:individual\s+solution|个人方案)\s*#?\d+\s*[:：\-–]\s*/i;
const MARK_FEATURE_RE = /^\s*(?:individual\s+solution|个人方案)\s*#?\d+\s*$/i;

/**
 * The brief never asked each member for their own solution, but the model numbered tasks as if it had
 * (「个人方案 1：登录模块」): the prefix and the numbered feature go. Returns how many titles changed.
 */
function unmarkIndividual(out: BriefOut): number {
  let n = 0;
  const renamed = new Map<string, string>();
  for (const t of allTasks(out)) {
    if (t.feature && MARK_FEATURE_RE.test(t.feature)) t.feature = null;
    const title = t.title.replace(MARK_PREFIX_RE, "").trim();
    if (title && title !== t.title) {
      renamed.set(norm(t.title), title);
      t.title = title;
      n++;
    }
  }
  for (const t of allTasks(out)) if (t.prereqTitle && renamed.has(norm(t.prereqTitle))) t.prereqTitle = renamed.get(norm(t.prereqTitle))!;
  return n;
}

// The brief only gives examples of methods ("a preferred classification method (e.g., ANN, SVM, KNN)"):
// the individual tasks must not pick one for the student.
const EXAMPLE_MARK_RE = /\be\.\s?g\b|\bsuch\s+as\b|\bfor\s+(?:example|instance)\b|\bexamples?\s+include|\bpreferred\b|\bof\s+(?:your|their)\s+(?:own\s+)?choice|例如|比如|譬如|自选|任选|自己选/i;
/** Method names a title must not carry when the brief only gave examples (the brief's own are added). */
const KNOWN_METHODS = [
  "ANN", "SVM", "KNN", "K-?NN", "CNN", "RNN", "LSTM", "GRU", "YOLO", "BERT", "GPT", "K-?means", "K-?均值", "MeanShift", "Mean\\s?Shift", "DBSCAN",
  "Naive\\s+Bayes", "Naïve\\s+Bayes", "Random\\s+Forest", "Decision\\s+Trees?", "Logistic\\s+Regression", "XGBoost", "TF-?IDF", "Word2Vec",
  "collaborative\\s+filtering", "content-based", "hybrid", "Dialogflow", "Rasa", "ResNet", "VGG",
  "神经网络", "支持向量", "K\\s?近邻", "近邻", "卷积", "循环神经", "长短期记忆", "决策树", "随机森林", "逻辑回归", "朴素贝叶斯", "贝叶斯", "协同过滤", "基于内容", "混合推荐", "混合式", "均值漂移", "密度聚类", "层次聚类", "词袋", "词嵌入",
];

/** The windows after each 「each member must provide a solution」 sentence (for the example check). */
function eachMemberWindows(briefText: string): string[] {
  const flat = briefText.replace(/\s+/g, " ");
  return [...flat.matchAll(EACH_EN_RE), ...flat.matchAll(EACH_ZH_RE)].map((m) => {
    const w = flat.slice(m.index, m.index + m[0].length + 300);
    // Up to the brief's next lettered item ("f) Compare the results … such as accuracy" is not a method list).
    const next = w.slice(m[0].length).search(/\s[a-h][.)]\s+[A-Z]|\s[a-h][.)、]\s*[一-鿿]/);
    return next >= 0 ? w.slice(0, m[0].length + next) : w;
  });
}

/** Method names listed as examples after "e.g." / "such as" / 「例如」 in the each-member windows. */
function exampleNames(windows: string[]): string[] {
  const names = new Set<string>();
  for (const w of windows) {
    for (const m of w.matchAll(/(?:\be\.\s?g\.?,?|\bsuch\s+as|\blike|\bexamples?\s+include:?|例如|比如)\s*([^)）.。;；]{2,160})/gi)) {
      for (const raw of m[1]!.split(/,|，|、|;|\bor\b|\band\b|\blike\b|或|和|及|\s+i+\.\s/i)) {
        const name = raw.replace(/-\s+/g, "-").replace(/\betc\b\.?|等/gi, "").replace(/^\W+|\W+$/g, "").trim();
        if (name.length >= 2 && name.length <= 30 && /[A-Za-z㐀-鿿]/.test(name) && !/^(?:the|a|an|use|methods?)$/i.test(name)) names.add(name);
      }
    }
  }
  return [...names];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first known or brief-listed method a title names, else null. */
function methodIn(title: string, briefNames: string[]): string | null {
  const patterns = [...KNOWN_METHODS, ...briefNames.map((n) => escapeRe(n).replace(/\\-/g, "-?\\s?"))];
  for (const p of patterns) {
    const m = title.match(new RegExp(`(?<![A-Za-z])${p}(?![A-Za-z])`, "i"));
    if (m) return m[0];
  }
  return null;
}

/**
 * 「个人方案 1：基于 ANN 的分类模型」 when the brief only gave ANN as an example: the title becomes generic, the
 * method goes into the steps as a suggestion, and the checklist asks for a method the others don't use.
 * Returns how many titles changed.
 */
function genericIndividualTitles(list: BriefTaskOut[], kept: BriefTaskOut[], briefNames: string[], locale: Locale): number {
  const found = kept.map((t) => methodIn(t.title, briefNames));
  if (!found.some(Boolean)) return 0;
  const picked = [...new Set([...found.filter((m): m is string => !!m), ...briefNames.slice(0, 4)])].slice(0, 5);
  const renamed = new Map<string, string>();
  let n = 0;
  kept.forEach((t, i) => {
    if (found[i]) {
      const title = locale === "zh" ? `个人方案 ${i + 1}：自选一种方法实现并评估` : `Individual solution ${i + 1}: implement and evaluate a method of your choice`;
      renamed.set(norm(t.title), title);
      t.title = title;
      n++;
    }
    const hint = locale === "zh" ? `方法自己选，作业举的例子可以参考：${picked.join("、")}（也可以用别的）` : `Choose your own method; the brief's examples: ${picked.join(", ")} (or another)`;
    if (!t.howto.some((s) => /自己选|自选|your own method|of your choice/i.test(s))) t.howto = [hint, ...t.howto].slice(0, 6);
    if (!t.checklist.some((s) => /不一样|不同|different/i.test(s))) t.checklist = [...t.checklist, locale === "zh" ? "用的方法和其他组员不一样" : "The method differs from the other members'"].slice(0, 7);
  });
  for (const t of list) if (t.prereqTitle && renamed.has(norm(t.prereqTitle))) t.prereqTitle = renamed.get(norm(t.prereqTitle))!;
  return n;
}

/**
 * 「每个组员各做一份」: exactly `count` individual tasks in each option that holds implementation work
 * (when options carry code), else in the top-level tasks. Returns the individual tasks and a note.
 */
export function ensureEachMember(out: BriefOut, briefText: string | null, count: number, locale: Locale): { individual: Set<BriefTaskOut>; note: string } {
  const individual = new Set<BriefTaskOut>();
  if (eachMemberMentions(briefText) === 0) {
    const n = unmarkIndividual(out);
    return { individual, note: `each member: not in the brief${n ? ` (「个人方案 N」 taken off ${n} title(s))` : ""}` };
  }
  if (count < 2) return { individual, note: "each member: one package only" };
  const codeOptions = out.questions.filter((q) => q.options.filter((o) => o.tasks.some((t) => t.kind === "CODE")).length * 2 >= q.options.length);
  const scopes: { name: string; list: BriefTaskOut[] }[] = codeOptions.length
    ? codeOptions.flatMap((q) => q.options.map((o: Option) => ({ name: o.label, list: o.tasks })))
    : [{ name: "top level", list: out.tasks }];
  const done: string[] = [];
  const skipped: string[] = [];
  const windows = eachMemberWindows(briefText ?? "");
  const examplesOnly = windows.some((w) => EXAMPLE_MARK_RE.test(w));
  const names = examplesOnly ? exampleNames(windows) : [];
  let generic = 0;
  for (const s of scopes) {
    const kept = normaliseIndividual(s.list, count, locale);
    if (kept) {
      kept.forEach((t) => individual.add(t));
      if (examplesOnly) generic += genericIndividualTitles(s.list, kept, names, locale);
      done.push(s.name);
    } else skipped.push(s.name);
  }
  return {
    individual,
    note: `each member: ${count} individual tasks in ${done.length ? done.join(", ") : "nothing"}${skipped.length ? `; no implementation task in ${skipped.join(", ")}` : ""}${generic ? `; ${generic} title(s) named a method the brief only gave as an example: made generic` : ""}`,
  };
}

// ─── Things every member does personally ─────────────────────────────────────

type PerMemberText = { title: string; howto: string[]; checklist: string[]; own: string; /** Checks every copy gets (what the brief adds, e.g. on-the-spot coding). */ extra?: string[] };
type PerMember = {
  id: string;
  /** What the brief's per-person sentence asks for. */
  brief: RegExp;
  /** The sentence is about something else too closely related (an AI disclosure is one per submission). */
  briefNot?: RegExp;
  /** A task (by title) that does it. */
  task: RegExp;
  /** A title that does it among other, group-level things ("slides", "AI disclosure too"): not multiplied. */
  taskNot?: RegExp;
  kind: BriefTaskOut["kind"];
  /** Share of the plan's points all copies get together when none of the tasks does it. */
  share: number;
  hours: number;
  zh: PerMemberText;
  en: PerMemberText;
};

const PER_MEMBER: PerMember[] = [
  {
    id: "declaration",
    brief: /plagiar|originality|academic\s+integrity|\b(?:sign|signs|signed|signature)\b|\bdeclar|抄袭|原创|诚信|签名|签署|签字|声明/i,
    briefNot: /\bAI\b|artificial\s+intelligence|ChatGPT|generative|free.?rider|人工智能|AI\s*使用/i,
    task: /plagiar|originality|academic\s+integrity|抄袭|原创|学术诚信|诚信声明/i,
    taskNot: /\bAI\b|AI\s*使用|人工智能|free.?rider|搭便车/i,
    kind: "DOC",
    share: 0.01,
    hours: 0.5,
    zh: { title: "签署抄袭声明表", howto: ["找到作业要求里的抄袭声明表格（不够就复印一份）", "填上自己的名字和学号，亲笔签名，交给负责提交的组员"], checklist: ["表格上是自己的名字和学号", "亲笔签了名", "交给了负责提交的人"], own: "填写和签名的是自己本人（别人不能代签）" },
    en: { title: "Sign the plagiarism statement form", howto: ["Find the plagiarism statement form in the brief or template (make a copy if needed)", "Fill in your own name and ID, sign it and hand it to whoever submits"], checklist: ["The form carries your own name and ID", "Signed by you", "Handed to whoever submits"], own: "Filled in and signed by you personally (nobody signs for you)" },
  },
  {
    id: "presentation",
    brief: /\bpresent(?:s|ing|ation)?\b|\bdemonstrat|\bdemo\b|\bQ\s?&\s?A\b|\bviva\b|\boral\b|\bpitch(?:es|ing)?\b|演示|答辩|上台|讲解|汇报|问答|展示|口头|路演|推介/i,
    task: /present|\bdemo|Q\s?&\s?A|\bviva\b|\boral\b|\bpitch|演示|答辩|答问|问答|讲解|上台|汇报|口头|路演|推介/i,
    taskNot: /slide|deck|\bppt\b|poster|video|rehears|幻灯片|演示文稿|海报|视频|排练/i,
    kind: "MEETING",
    share: 0.03,
    hours: 2,
    zh: { title: "演示与答问：讲解自己的部分", howto: ["准备自己负责那部分要讲的内容和演示", "按安排的时间上台讲解、演示，并回答提问"], checklist: ["讲清楚了自己做的部分", "现场演示能运行", "回答了老师的提问"], own: "自己亲自讲解和答问（别人不能代讲）" },
    en: { title: "Presentation and Q&A: present your own part", howto: ["Prepare what you will say and show about your own part", "Present and demonstrate it at the scheduled time and answer questions"], checklist: ["Your own part is explained clearly", "The demo runs live", "Questions are answered"], own: "Presented and answered in person by you (nobody presents for you)" },
  },
  {
    id: "peer-evaluation",
    brief: /peer\s+(?:evaluation|assessment|review|rating)|rate\s+(?:each\s+other|(?:their|your)\s+(?:team|group)\s*-?mates)|互评|同伴评价|评价其他组员/i,
    task: /peer|互评|同伴评价/i,
    kind: "DOC",
    share: 0.01,
    hours: 0.5,
    zh: { title: "完成组员互评", howto: ["找到互评表格或链接", "如实评每个组员，按时提交"], checklist: ["评了每个组员", "在截止前提交"], own: "是自己填写并提交的" },
    en: { title: "Complete the peer evaluation", howto: ["Find the peer evaluation form or link", "Rate the other members honestly and submit it on time"], checklist: ["Every other member is rated", "Submitted before the deadline"], own: "Filled in and submitted by you" },
  },
  {
    id: "reflection",
    brief: /reflect(?:ion|ive)|\bjournal\b|\bdiary\b|\blog\s*book\b|learning\s+log|reflective\s+log|反思|心得|学习日志|工作日志/i,
    task: /reflect|journal|diary|log\s*book|learning\s+log|反思|心得|日志/i,
    kind: "DOC",
    share: 0.02,
    hours: 1.5,
    zh: { title: "写个人反思", howto: ["回顾自己在项目里做了什么、学到了什么", "按要求的格式写好并提交"], checklist: ["写的是自己的经历和体会", "符合要求的格式和字数", "按时提交"], own: "是自己写的反思" },
    en: { title: "Write your individual reflection", howto: ["Look back at what you did and learned in the project", "Write it in the required format and submit it"], checklist: ["It is about your own experience", "Required format and length", "Submitted on time"], own: "Your own reflection" },
  },
  {
    id: "contribution",
    brief: /contribution\s+(?:report|statement|form|log)|individual\s+(?:report|contribution)|贡献(?:说明|报告|表|声明)|个人报告/i,
    task: /contribution|individual\s+report|贡献|个人报告/i,
    kind: "DOC",
    share: 0.01,
    hours: 1,
    zh: { title: "写个人贡献说明", howto: ["列出自己负责并完成的部分", "按要求的格式写好并提交"], checklist: ["列清楚了自己做的部分", "按时提交"], own: "写的是自己本人的贡献" },
    en: { title: "Write your individual contribution statement", howto: ["List the parts you were responsible for and completed", "Write it in the required format and submit it"], checklist: ["Your own parts are listed", "Submitted on time"], own: "Describes your own contribution" },
  },
];

/** The per-member titles the prompt shows as examples. */
const EXAMPLE_TITLES = new Set(PER_MEMBER.flatMap((p) => [norm(p.zh.title), norm(p.en.title)]));

const PITCH_RE = /\bpitch(?:es|ing)?\b|路演|推介/i;
const LIVE_CODING_RE = /on[-\s]the[-\s]spot\s+(?:coding|programming)|live\s+coding|现场(?:编程|写代码|改代码)|当场(?:编程|写代码|改代码)/i;
const PITCH_TEXT: Record<Locale, PerMemberText> = {
  zh: { title: "路演与答问：介绍自己负责的部分", howto: ["准备自己负责那部分要讲的内容，和组员排好交接顺序", "按安排的时间上台路演，并回答提问"], checklist: ["讲清楚了自己负责的部分", "和组员交接顺畅", "回答了老师的提问"], own: "自己亲自上台讲和答问（别人不能代讲）" },
  en: { title: "Pitch and Q&A: present your own part", howto: ["Prepare what you will say about your own part and agree the hand-over order with the others", "Pitch at the scheduled time and answer questions"], checklist: ["Your own part is explained clearly", "Smooth hand-over to the next presenter", "Questions are answered"], own: "Pitched and answered in person by you (nobody presents for you)" },
};

/** A per-member item's text, as the brief names it: a pitch is a pitch; on-the-spot coding is checked. */
function perMemberText(p: PerMember, briefText: string | null, locale: Locale): PerMemberText {
  if (p.id !== "presentation" || !briefText) return locale === "zh" ? p.zh : p.en;
  const text = structuredClone(PITCH_RE.test(briefText) && !/\bdemos?\b|\bprototype|演示原型/i.test(briefText) ? PITCH_TEXT[locale] : locale === "zh" ? p.zh : p.en);
  if (LIVE_CODING_RE.test(briefText)) text.extra = [locale === "zh" ? "能当场按要求改代码（on-the-spot coding）" : "Can change the code on the spot when asked (on-the-spot coding)"];
  return text;
}

const PER_SUBJECT_EN_RE = /\b(?:each|every)\s+(?:(?:group|team)\s+)?(?:member|student|individual|person)s?\b|\beach\s+of\s+(?:you|the\s+(?:members|students))\b|\ball\s+(?:of\s+)?(?:the\s+)?(?:group\s+|team\s+)?(?:members|students)\b/gi;
const PER_SUBJECT_ZH_RE = /每一?[位个名](?:组员|成员|同学|学生|人)|每人|各(?:位)?(?:组员|成员|同学)/g;
/** One person does it for the group ("Team leader has to compile and submit"), or it is optional. */
const PER_NOT_RE = /\bleader\b|on\s+behalf|\bone\s+(?:member|student|person|representative)\b|\boptional\b|组长|队长|(?<!每)代表|派一|(?<!每)一名组员|(?<!每)一个人|可选|选做/i;
/** Sentence ends: 。；; and bullets always, "." before a capital or a list marker ("3.)", "b)"), not "e.g., ANN". */
const SENTENCE_END_RE = /[。；;!！•●]|\.(?=\s+(?:[A-Z(“"'‘]|\d{1,2}\s*[.)]|[a-z]{1,3}\s*[.)]\s)|\s*$)/g;

/** The sentence around index `at` of `flat`, at most 300 characters. */
function sentenceAt(flat: string, at: number, len: number): string {
  let start = 0;
  for (const m of flat.slice(Math.max(0, at - 300), at).matchAll(SENTENCE_END_RE)) start = Math.max(0, at - 300) + m.index + 1;
  const rest = flat.slice(at + len, at + len + 300);
  const end = rest.search(SENTENCE_END_RE);
  return flat.slice(start, at + len + (end >= 0 ? end : rest.length));
}

/**
 * The things the brief says each student / each member must do personally (「每位同学都要签名」, "EACH team
 * member is required to present their own work"): their ids, with the brief line it was said on (1-based).
 */
export function perMemberItems(briefText: string | null): Map<string, number | null> {
  const found = new Map<string, number | null>();
  if (!briefText) return found;
  const flat = briefText.replace(/\s+/g, " ");
  const sentences = [...flat.matchAll(PER_SUBJECT_EN_RE), ...flat.matchAll(PER_SUBJECT_ZH_RE)].map((m) => ({ subject: m[0], text: sentenceAt(flat, m.index, m[0].length) }));
  const lines = briefText.split("\n");
  for (const s of sentences) {
    if (PER_NOT_RE.test(s.text)) continue;
    for (const p of PER_MEMBER) {
      if (found.has(p.id) || !p.brief.test(s.text) || p.briefNot?.test(s.text)) continue;
      // The line with the per-person subject and the activity (on it or the next line).
      const subject = new RegExp(s.subject.split(/\s+/).map(escapeRe).join("\\s+"), "i");
      const at = lines.findIndex((l, i) => subject.test(l) && p.brief.test(`${l} ${lines[i + 1] ?? ""}`));
      found.set(p.id, at >= 0 ? at + 1 : null);
    }
  }
  return found;
}

/** A title without its copy marker: 「签署抄袭声明表（第 2 份）」, "Sign the form (member 2)", 「组员 2：…」. */
const COPY_SUFFIX_RE = /\s*[(（]\s*(?:第\s*\d+\s*份|copy\s*#?\d+|member\s*#?\d+|student\s*#?\d+|组员\s*\d+|成员\s*\d+|同学\s*\d+|\d+\s*(?:\/|of)\s*\d+|\d+|每人一份|每人各一份|每位组员|每个组员|每人|each\s+member|every\s+member|per\s+member|all\s+members|individual)\s*[)）]\s*$/i;
const COPY_PREFIX_RE = /^\s*(?:member|student|组员|成员|同学)\s*#?\d+\s*[:：\-–]\s*/i;
const stripCopy = (title: string) => {
  let t = title.trim();
  for (let i = 0; i < 2; i++) t = t.replace(COPY_SUFFIX_RE, "").replace(COPY_PREFIX_RE, "").replace(/\s*[-–:：]\s*(?:member|student|组员|成员)\s*#?\d+\s*$/i, "").trim();
  return t;
};
const copyTitle = (base: string, n: number, locale: Locale) => {
  const out = locale === "zh" ? `${base}（第 ${n} 份）` : `${base} (member ${n})`;
  return out.length > MAX_TITLE ? `${base.slice(0, MAX_TITLE - (out.length - base.length) - 1)}…${out.slice(base.length)}` : out;
};
/** Steps and checks written for the whole group ("every member signs") don't fit one person's copy. */
const WHOLE_GROUP_RE = /每个|每位|每名|所有|全体|大家|各自|每人|一起|全组|共同|与组员|jointly|with\s+the\s+(?:team|group|others)|every|\beach\b|\ball\s+(?:the\s+)?(?:members|students)|everyone|whole\s+(?:team|group)|together/i;

function personalise(t: BriefTaskOut, text: PerMemberText): void {
  const howto = t.howto.filter((s) => !WHOLE_GROUP_RE.test(s));
  t.howto = howto.length ? howto : [...text.howto];
  const checklist = t.checklist.filter((s) => !WHOLE_GROUP_RE.test(s));
  for (const c of text.extra ?? []) if (!checklist.includes(c)) checklist.push(c);
  // One 「自己本人做」 line: the item's own one replaces the component's generic one.
  const generic = [COMPONENT_TEXT.zh.own, COMPONENT_TEXT.en.own];
  if (!generic.includes(text.own)) for (let i = checklist.length - 1; i >= 0; i--) if (generic.includes(checklist[i]!)) checklist.splice(i, 1);
  if (!checklist.some((s) => s === text.own)) checklist.push(text.own);
  for (const c of text.checklist) if (checklist.length < 2 && !checklist.includes(c)) checklist.unshift(c);
  t.checklist = checklist.slice(0, 7);
}

/**
 * Makes `group` (tasks of one list doing one per-member item) exactly `count` copies: 「…（第 n 份）」, the
 * group's points shared equally, feature n each, checklist for one person. Returns the copies.
 */
function multiplyPerMember(list: BriefTaskOut[], group: BriefTaskOut[], count: number, text: PerMemberText, feature: (n: number) => string, locale: Locale): BriefTaskOut[] {
  const total = group.reduce((s, t) => s + weight(t), 0);
  const oldTitles = new Set(group.map((t) => norm(t.title)));
  const stripped = stripCopy(group[0]!.title);
  // The prompt's example title copied as is (「演示与答问：讲解自己的部分」 for a pitch): the brief's own name.
  // (Not for an individual component's generic text: the per-member item that runs after it names it.)
  const generic = text === COMPONENT_TEXT.zh || text === COMPONENT_TEXT.en;
  const base = !stripped || (EXAMPLE_TITLES.has(norm(stripped)) && !generic) ? text.title : stripped;
  let kept = group;
  if (group.length > count) {
    kept = group.slice(0, count);
    for (const t of group.slice(count)) list.splice(list.indexOf(t), 1);
  } else if (group.length < count) {
    const added = Array.from({ length: count - group.length }, () => structuredClone(group[0]!));
    list.splice(list.indexOf(group[group.length - 1]!) + 1, 0, ...added);
    kept = [...group, ...added];
  }
  kept.forEach((t, i) => {
    t.title = copyTitle(base, i + 1, locale);
    t.points = Math.max(0.1, total / count);
    t.feature = feature(i + 1);
    if (t.prereqTitle && oldTitles.has(norm(t.prereqTitle))) t.prereqTitle = null;
    personalise(t, text);
  });
  for (const t of list) if (!kept.includes(t) && t.prereqTitle && oldTitles.has(norm(t.prereqTitle))) t.prereqTitle = kept[0]!.title;
  return kept;
}

// A graded component the brief marks as individual: 「1. Idea Generation  20 marks (Individual)」,
// 「CLO 1: IDEA GENERATION (INDIVIDUAL ASSIGNMENT)」, 「• Executive Summary (Individual)」, 「个人反思（个人）」.
const INDIVIDUAL_MARK_RE = /[(（]\s*(?:individual|个人)(?![^)）]*(?:group|小组|团体|全组))[^)）]*[)）]/i;
const COMPONENT_NOT_RE = /rubric|assessment|marking|criteria|cover|attachment|appendix|student\s*(?:name|id)|\btotal\b|评分|封面|附件|附录/i;
/** Chinese words for common English component names (the brief is in English, the plan in Chinese). */
const COMPONENT_ALIASES: [RegExp, string][] = [
  [/executive\s+summary/i, "执行摘要|摘要"],
  [/idea|opportunit/i, "点子|创意|构思|商业机会|商机"],
  [/pitch/i, "路演|推介"],
  [/reflect/i, "反思|心得"],
  [/presentation|presenting/i, "演示|展示|汇报"],
  [/essay/i, "论文|短文"],
  [/journal|log\b/i, "日志|日记"],
  [/proposal/i, "提案|计划书"],
  [/literature\s+review/i, "文献综述"],
  [/interview/i, "访谈|采访"],
  [/summary/i, "摘要"],
];
/** Work shared by the group even inside an individual component (the team picks one idea, one slide deck). */
const SHARED_RE =
  /slide|deck|\bppt\b|poster|rehears|compile|consolidat|merge|integrat|select|choose|\bpick|vote|discuss|agree|\bgroup\b|\bteam\b|幻灯片|演示文稿|海报|排练|汇总|整合|合并|编入|挑选|选出|选定|选择|投票|评选|讨论|商定|小组|全组|整组|组内/i;

/** The graded components the brief marks as individual work (each member hands in their own), by name. */
export function individualComponents(briefText: string | null): string[] {
  if (!briefText) return [];
  const names = new Map<string, string>();
  for (const line of briefText.split("\n")) {
    const m = line.match(INDIVIDUAL_MARK_RE);
    if (!m) continue;
    let name = line.slice(0, m.index);
    for (let i = 0; i < 2; i++)
      name = name
        .replace(/^\s*(?:[•●▪\-*]|\d{1,2}\s*[.)、]\)?|[a-z]\s*[.)]\)?|CLO\s*\d+\s*[:：]?)\s*/i, "")
        .replace(/\s*\d+(?:\.\d+)?\s*(?:%|marks?|分)\s*$/i, "")
        .replace(/[\s:：\-–]+$/, "")
        .trim();
    if (name.length < 3 || name.length > 60 || COMPONENT_NOT_RE.test(name) || !/[A-Za-z]{3}|[一-鿿]{2}/.test(name)) continue;
    if (!names.has(key(name))) names.set(key(name), name);
  }
  return [...names.values()];
}

/** A title or part that is this component's work. */
function componentMatcher(name: string): (t: BriefTaskOut) => boolean {
  const k = key(name);
  const alias = COMPONENT_ALIASES.find(([re]) => re.test(name))?.[1];
  const aliasRe = alias ? new RegExp(alias, "i") : null;
  return (t) => key(t.title).includes(k) || (!!t.part && key(t.part) === k) || (!!aliasRe && aliasRe.test(t.title));
}

/**
 * An individual component's tasks in one list become `count` copies of one task: the model's copies
 * (or its one task) with any other tasks of the component merged in (their steps, checks, hours and
 * points), so each member gets one task for their own piece of it.
 */
function mergePerMember(list: BriefTaskOut[], cands: BriefTaskOut[], count: number, text: PerMemberText, feature: (n: number) => string, locale: Locale): BriefTaskOut[] {
  const by = new Map<string, BriefTaskOut[]>();
  for (const t of cands) {
    const k = norm(stripCopy(t.title)).replace(/\d+/g, "#");
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const groups = [...by.values()];
  const main = groups.sort((a, b) => b.length - a.length || weight(b[0]!) - weight(a[0]!))[0]!;
  const others = groups.slice(1).map((g) => g[0]!);
  const first = main[0]!;
  const total = cands.reduce((s, t) => s + weight(t), 0);
  const merged: BriefTaskOut = {
    ...structuredClone(first),
    howto: [...first.howto, ...others.flatMap((t) => t.howto)].filter((s, i, a) => a.indexOf(s) === i).slice(0, 6),
    checklist: [...first.checklist, ...others.flatMap((t) => t.checklist)].filter((s, i, a) => a.indexOf(s) === i).slice(0, 6),
    estimateHours: first.estimateHours + others.reduce((s, t) => s + (t.estimateHours > 0 ? t.estimateHours : 0), 0),
  };
  const oldTitles = new Set(cands.map((t) => norm(t.title)));
  const at = Math.min(...cands.map((t) => list.indexOf(t)));
  for (const t of cands) list.splice(list.indexOf(t), 1);
  list.splice(at, 0, merged);
  const kept = multiplyPerMember(list, [merged], count, text, feature, locale);
  kept.forEach((t) => (t.points = Math.max(0.1, total / count)));
  for (const t of list) if (t.prereqTitle && oldTitles.has(norm(t.prereqTitle))) t.prereqTitle = kept.includes(t) ? null : kept[0]!.title;
  return kept;
}

const COMPONENT_TEXT: Record<Locale, PerMemberText> = {
  zh: { title: "个人部分", howto: ["按作业要求完成自己的这一份"], checklist: ["按作业要求完成", "按时提交"], own: "是自己本人完成的（个人部分，别人不能代做）" },
  en: { title: "Individual part", howto: ["Do your own piece as the brief asks"], checklist: ["Done as the brief asks", "Handed in on time"], own: "Done by you personally (individual work)" },
};

/**
 * What the brief says each member must do personally (sign the plagiarism form, present their own work,
 * the peer evaluation, a reflection, a contribution statement) becomes exactly `count` copies, one per
 * package: the model's one task is multiplied (its points shared), its copies are brought to `count`, or,
 * when no task does it, `count` small ones are added. Copy n joins feature n: the individual solutions'
 * (「个人方案 n」) when there are some, else 「组员 n」. Runs before the coverage check, which then sees them.
 */
export function ensurePerMember(out: BriefOut, briefText: string | null, count: number, locale: Locale, individual: Set<BriefTaskOut> = new Set()): string {
  const items = perMemberItems(briefText);
  const components = individualComponents(briefText);
  if (items.size === 0 && components.length === 0) return "per member: nothing in the brief";
  if (count < 2) return `per member: ${[...components, ...items.keys()].join(", ")} (one package only)`;
  const features = [...new Set([...individual].map((t) => t.feature).filter((f): f is string => !!f && MARK_FEATURE_RE.test(f)))];
  const feature = (n: number) => (features.length >= count ? (locale === "zh" ? `个人方案 ${n}` : `Individual solution ${n}`) : locale === "zh" ? `组员 ${n}` : `Member ${n}`);
  const refPoints = referenceTasks(out).reduce((s, t) => s + weight(t), 0) || 100;
  const done: string[] = [];
  // Components the brief marks individual: each member hands in their own.
  const claimed = new Set<BriefTaskOut>(individual);
  for (const name of components) {
    const match = componentMatcher(name);
    const candidates = (list: BriefTaskOut[]) => list.filter((t) => !claimed.has(t) && match(t) && !SHARED_RE.test(t.title));
    const lists = candidates(out.tasks).length ? [out.tasks] : out.questions.flatMap((q) => q.options.map((o) => o.tasks)).filter((l) => candidates(l).length);
    if (lists.length === 0) {
      done.push(`${name}: no task`);
      continue;
    }
    for (const list of lists) {
      const cands = candidates(list);
      const kept = mergePerMember(list, cands, count, COMPONENT_TEXT[locale], feature, locale);
      kept.forEach((t) => claimed.add(t));
      done.push(`${name} ${cands.length} task(s) → ${count}`);
    }
  }
  for (const [id, line] of items) {
    const p = PER_MEMBER.find((x) => x.id === id)!;
    const text = perMemberText(p, briefText, locale);
    const candidates = (list: BriefTaskOut[]) => list.filter((t) => t.kind !== "CODE" && p.task.test(t.title) && !p.taskNot?.test(t.title));
    // The top-level tasks when they do it, else every option that does.
    const lists = candidates(out.tasks).length ? [out.tasks] : out.questions.flatMap((q) => q.options.map((o) => o.tasks)).filter((l) => candidates(l).length);
    if (lists.length === 0) {
      const one: BriefTaskOut = {
        title: text.title,
        kind: p.kind,
        points: (refPoints * p.share) / count,
        estimateHours: p.hours,
        suggestedDue: null,
        milestone: null,
        feature: null,
        part: null,
        briefFrom: line,
        briefTo: line,
        quote: null,
        howto: [...text.howto],
        checklist: [...text.checklist],
        prereqTitle: null,
      };
      out.tasks.push(one);
      multiplyPerMember(out.tasks, [one], count, text, feature, locale);
      done.push(`${id} added`);
      continue;
    }
    for (const list of lists) {
      const cands = candidates(list);
      // The model's own copies (the same title up to the number) when it made some, else its main task.
      const by = new Map<string, BriefTaskOut[]>();
      for (const t of cands) {
        const k = norm(stripCopy(t.title)).replace(/\d+/g, "#");
        by.set(k, [...(by.get(k) ?? []), t]);
      }
      const copies = [...by.values()].sort((a, b) => b.length - a.length)[0]!;
      const group = copies.length >= 2 ? copies : [[...cands].sort((a, b) => weight(b) - weight(a))[0]!];
      const kept = multiplyPerMember(list, group, count, text, feature, locale);
      // Presenting is done in a session, whatever the model called it (a pitch tagged DESIGN).
      if (p.id === "presentation") kept.forEach((t) => (t.kind = "MEETING"));
      done.push(`${id} ${group.length === 1 ? "split" : `${group.length} copies`} → ${count}`);
    }
  }
  return `per member: ${done.join(", ")}`;
}

// ─── Meeting first ───────────────────────────────────────────────────────────

/**
 * The 「一起定好接口」 meeting only helps when different people's code is joined into one system: two
 * CODE tasks of different features where one waits for the other. Never when each member builds an
 * independent solution of their own (`individual` holds those tasks).
 */
export function meetingJustified(out: BriefOut, individual: Set<BriefTaskOut> = new Set()): boolean {
  if (individual.size > 0) return false;
  const code = allTasks(out).filter((t) => t.kind === "CODE" && !individual.has(t));
  const byTitle = new Map(code.map((t) => [norm(t.title), t]));
  const featureOf = (t: BriefTaskOut) => norm(t.feature) || `task:${norm(t.title)}`;
  return code.some((t) => {
    const p = t.prereqTitle ? byTitle.get(norm(t.prereqTitle)) : undefined;
    return !!p && p !== t && featureOf(p) !== featureOf(t);
  });
}

// ─── Coverage ────────────────────────────────────────────────────────────────

type Required = {
  id: string;
  /** The brief asks for it. */
  brief: RegExp;
  /** A task already covers it (title, steps or checklist). */
  covered: RegExp;
  kind: BriefTaskOut["kind"];
  /** Share of the plan's points the added task gets. */
  share: number;
  hours: number;
  zh: { title: string; howto: string[]; checklist: string[] };
  en: { title: string; howto: string[]; checklist: string[] };
};

const REQUIRED: Required[] = [
  {
    id: "plagiarism",
    brief: /plagiari[sz]m\s+(?:statement|declaration|form)|declaration\s+(?:form\s+)?of\s+(?:originality|academic\s+integrity)|originality\s+(?:statement|declaration|form)|academic\s+integrity\s+(?:statement|declaration|form)|抄袭声明|原创(?:性)?声明|学术诚信声明|诚信声明/i,
    covered: /plagiar|originality|academic\s+integrity|抄袭|原创|学术诚信|诚信声明/i,
    kind: "DOC",
    share: 0.01,
    hours: 0.5,
    zh: { title: "填写并签署抄袭声明表", howto: ["找到作业要求里的抄袭声明表格", "每个组员各填一份并签名，附在提交的文件里"], checklist: ["每个组员都填好并签了名", "声明表附在提交的文件里"] },
    en: { title: "Fill in and sign the plagiarism statement form", howto: ["Find the plagiarism statement form the brief refers to", "Every member fills in and signs a copy; attach them to the submission"], checklist: ["Every member has filled in and signed the form", "The forms are attached to the submission"] },
  },
  {
    id: "ai-disclosure",
    brief: /\bAI\s+(?:use\s+|usage\s+)?(?:disclosure|declaration|statement)|disclos\w*\s+(?:the\s+|any\s+|all\s+)?(?:use\s+of\s+)?(?:AI|generative\s+AI|ChatGPT)|AI\s*(?:使用|工具使用)?\s*(?:声明|披露)|使用\s*AI[^。\n]{0,20}(?:声明|说明|披露)/i,
    covered: /\bAI\b[^\n]{0,30}(?:disclos|declar|statement|声明|披露)|disclos|AI\s*(?:使用)?\s*声明/i,
    kind: "DOC",
    share: 0.01,
    hours: 1,
    zh: { title: "写 AI 使用声明", howto: ["记下用过的 AI 工具和主要的提示词", "写明怎么检查 AI 给的内容是否正确，按要求的格式附在提交的文件里"], checklist: ["列出了用过的 AI 工具和提示词", "写了怎么核对 AI 的内容", "附在提交的文件里"] },
    en: { title: "Write the AI disclosure statement", howto: ["List the AI tools and the main prompts used", "Explain how the AI output was checked, in the required format, and attach it to the submission"], checklist: ["Tools and prompts are listed", "How the output was checked is explained", "It is attached to the submission"] },
  },
  {
    id: "presentation",
    brief: /\bpresentation\b|\bpresent\s+(?:the|their|your|our)\s+(?:work|project|prototype|system|app|findings)|\bdemo\b|\bdemonstration\b|demonstrate\s+the\s+(?:prototype|system|app|program)|\bQ\s?&\s?A\b|\bviva\b|\boral\s+(?:report|presentation)|\bpitch\b|演示|答辩|口头报告|上台|课堂展示|汇报/i,
    covered: /present|\bdemo|Q\s?&\s?A|\bviva\b|\bpitch|slides|演示|答辩|口头|上台|展示|汇报|简报/i,
    kind: "MEETING",
    share: 0.03,
    hours: 3,
    zh: { title: "准备演示和问答", howto: ["整理要展示的内容，写好每个人要讲的部分", "一起排练一遍，准备可能被问到的问题"], checklist: ["每个人都知道自己讲哪部分", "排练过一次", "准备好常见问题的回答"] },
    en: { title: "Prepare the presentation / demo and Q&A", howto: ["Put together what to show and who presents which part", "Rehearse once together and prepare answers to likely questions"], checklist: ["Everyone knows their part", "Rehearsed once", "Answers to likely questions are ready"] },
  },
  {
    id: "peer-evaluation",
    brief: /peer\s+(?:evaluation|assessment|review|rating)|互评|组员互评|同伴评价/i,
    covered: /peer|互评|同伴评价/i,
    kind: "DOC",
    share: 0.01,
    hours: 0.5,
    zh: { title: "完成组员互评", howto: ["找到互评表格或链接", "按要求如实评每个组员并按时提交"], checklist: ["每个组员都评了", "在截止前提交"] },
    en: { title: "Complete the peer evaluation", howto: ["Find the peer evaluation form or link", "Rate every member honestly as asked and submit it on time"], checklist: ["Every member is rated", "Submitted before the deadline"] },
  },
  {
    id: "references",
    brief: /\b(?:APA|IEEE|Harvard|MLA|Chicago)\b(?:\s+(?:style|format|referencing|citation))?|citation\s+style|referencing\s+style|reference\s+list|bibliography|参考文献|引用格式/i,
    covered: /referen|citation|\bcite|bibliograph|参考文献|引用/i,
    kind: "DOC",
    share: 0.02,
    hours: 1.5,
    zh: { title: "整理参考文献（按要求的引用格式）", howto: ["收集报告里用到的文献、数据集和工具的来源", "按作业要求的引用格式排好，正文里的引用要对得上"], checklist: ["每个来源都列出来了", "格式符合作业要求", "正文引用和列表对得上"] },
    en: { title: "Compile the references in the required citation style", howto: ["Collect the sources of the papers, datasets and tools used", "Format them in the required style and match every in-text citation"], checklist: ["Every source is listed", "The required style is used", "In-text citations match the list"] },
  },
  {
    id: "source-code",
    brief: /source\s+code|源代码|源码/i,
    covered: /source\s+code|repositor|github|gitlab|\bzip\b|源代码|源码|代码仓库|提交代码|打包代码/i,
    kind: "DOC",
    share: 0.01,
    hours: 1,
    zh: { title: "整理并提交源代码", howto: ["把最终版本的代码整理好，删掉没用的文件，写一个简单的运行说明", "按要求打包或上传"], checklist: ["别人照说明能运行", "按要求的方式提交了"] },
    en: { title: "Tidy up and submit the source code", howto: ["Clean up the final code, remove unused files and add short run instructions", "Package or upload it as the brief asks"], checklist: ["Someone else can run it from the instructions", "Submitted the way the brief asks"] },
  },
  {
    id: "user-manual",
    brief: /user\s+(?:manual|guide)|使用说明书|用户手册|使用手册/i,
    covered: /user\s+(?:manual|guide)|manual|使用说明|用户手册|使用手册/i,
    kind: "DOC",
    share: 0.03,
    hours: 3,
    zh: { title: "写使用说明书", howto: ["按使用流程截图，每一步写清楚怎么操作", "请一个没用过的人照着试一遍并改好"], checklist: ["主要功能都有步骤和截图", "有人照着用过一遍"] },
    en: { title: "Write the user manual", howto: ["Walk through the app with screenshots and explain each step", "Have someone new follow it once and fix what was unclear"], checklist: ["Every main feature has steps and screenshots", "Someone followed it once"] },
  },
];

/**
 * Adds a small task (at the end of the top-level tasks) for each item the brief requires but no task
 * covers. Returns the ids added.
 */
export function ensureCoverage(out: BriefOut, briefText: string | null, locale: Locale): string[] {
  if (!briefText) return [];
  const lines = briefText.split("\n");
  const flat = briefText.replace(/\s+/g, " ");
  const ref = referenceTasks(out);
  const refPoints = ref.reduce((s, t) => s + weight(t), 0) || 100;
  const text = allTasks(out).map(taskText).join("\n");
  const added: string[] = [];
  for (const r of REQUIRED) {
    if (!r.brief.test(flat) || r.covered.test(text)) continue;
    const at = lines.findIndex((l) => r.brief.test(l));
    const own = locale === "zh" ? r.zh : r.en;
    out.tasks.push({
      title: own.title,
      kind: r.kind,
      points: Math.max(0.1, refPoints * r.share),
      estimateHours: r.hours,
      suggestedDue: null,
      milestone: null,
      feature: null,
      part: null,
      briefFrom: at >= 0 ? at + 1 : null,
      briefTo: at >= 0 ? at + 1 : null,
      quote: null,
      howto: [...own.howto],
      checklist: [...own.checklist],
      prereqTitle: null,
    });
    added.push(r.id);
  }
  return added;
}

// ─── Tidying ─────────────────────────────────────────────────────────────────

/** 「1. 监督式机器学习」→「监督式机器学习」: options get their own keys (A, B, …), the brief's numbering goes. */
export function tidyOptionLabels(out: BriefOut): number {
  let n = 0;
  for (const q of out.questions)
    for (const o of q.options) {
      const label = o.label.replace(/^\s*(?:\d{1,2}|[A-Za-z]|[ivxIVX]{1,4})\s*[.)、:：]\s+|^\s*[(（](?:\d{1,2}|[A-Za-z])[)）]\s*/, "");
      if (label && label !== o.label) {
        o.label = label;
        n++;
      }
    }
  return n;
}

/**
 * Report sections chained one after another (引言 → 相关研究 → 方法 → …) can all be written at the same
 * time: when three or more document tasks each wait for the previous one, those waits are dropped.
 * A section waiting for code (结果讨论 → 实现) stays.
 */
export function unchainSections(out: BriefOut): number {
  const lists = [out.tasks, ...out.questions.flatMap((q) => q.options.map((o) => o.tasks))];
  let dropped = 0;
  for (const list of lists) {
    const doc = (t: BriefTaskOut | undefined) => !!t && (t.kind === "DOC" || t.kind === "RESEARCH");
    const byTitle = new Map(list.map((t) => [norm(t.title), t]));
    const prereqOf = (t: BriefTaskOut) => (t.prereqTitle ? byTitle.get(norm(t.prereqTitle)) : undefined);
    const links = new Set(list.filter((t) => doc(t) && doc(prereqOf(t))));
    // Only links inside a chain of three or more (A ← B ← C); a single wait (采访 ← 采访提纲) stays.
    const chained = [...links].filter((t) => links.has(prereqOf(t)!) || [...links].some((o) => prereqOf(o) === t));
    for (const t of chained) t.prereqTitle = null;
    dropped += chained.length;
  }
  return dropped;
}

// ─── Points without a value ──────────────────────────────────────────────────

/**
 * Tasks the model gave no points (0, negative, not a number: typically every option's tasks, when the
 * top-level tasks already made 100) get points from their hours, at the median points-per-hour of the
 * tasks that have both. Returns how many were filled in.
 */
export function fillMissingPoints(out: BriefOut): number {
  const tasks = allTasks(out);
  const missing = tasks.filter((t) => !(Number.isFinite(t.points) && t.points > 0));
  if (missing.length === 0) return 0;
  const rates = tasks
    .filter((t) => Number.isFinite(t.points) && t.points > 0 && t.estimateHours > 0)
    .map((t) => t.points / t.estimateHours)
    .sort((a, b) => a - b);
  const rate = rates.length ? rates[Math.floor(rates.length / 2)]! : 1;
  for (const t of missing) t.points = Math.max(0.1, (t.estimateHours > 0 ? t.estimateHours : 2) * rate);
  return missing.length;
}

// ─── Hours and count ─────────────────────────────────────────────────────────

/** 2–10 hours is the aim; the stored estimate is clamped to 0.5–10 (a longer task is kept, not rejected). */
export function clampHours(out: BriefOut): number {
  let over = 0;
  for (const t of allTasks(out)) {
    const h = clampNumber(t.estimateHours, 0, 500, 0);
    if (h > 10) over++;
    t.estimateHours = h > 0 ? Math.min(10, Math.max(0.5, h)) : 2;
  }
  return over;
}

/** How many tasks the plan should have at least (packageCount × 2), and whether the answer has too few. */
export function tooFewTasks(out: BriefOut, packageCount: number): { have: number; want: number } | null {
  const have = referenceTasks(out).length;
  const want = Math.max(2, packageCount * 2);
  return have < want ? { have, want } : null;
}

// ─── All of it ───────────────────────────────────────────────────────────────

/** A meetingFirst about joining code: interfaces, APIs, data formats. */
const INTERFACE_RE = /interface|\bAPI|data\s*format|schema|contract\s+between|module|integrat|接口|数据格式|格式|模块|对接|整合|串接/i;

export type CheckContext ={ locale: Locale; packageCount: number; briefText: string | null; parts?: GradedPart[] | null };

/**
 * The deterministic part, in order: each member → per member → coverage → meetingFirst → hours → part weights.
 * Works on a copy; returns it with notes (what changed) for logs and the evaluation script.
 */
// ─── Forms every member signs ────────────────────────────────────────────────

const CONTRACT_BRIEF_RE = /free[-\s]?rider|group\s+contract|team\s+contract|搭便车|小组合约|小组契约|团队合约/i;
const PLAGIARISM_FORM_RE = /plagiari[sz]m\s+(?:statement|declaration|form)|declaration\s+(?:form\s+)?of\s+(?:originality|academic\s+integrity)|originality\s+(?:statement|declaration|form)|抄袭声明|原创(?:性)?声明|学术诚信声明|诚信声明/i;
/** A small task that is only signing a form (not one that also writes a section). */
const SIGN_TASK_RE = /签|sign|declar|声明|合约|契约|contract|free[-\s]?rider|plagiar|抄袭/i;
const SIGN_FORM_RE = /contract|free[-\s]?rider|合约|契约|搭便车|plagiar|originality|抄袭|原创|诚信/i;
const SIGN_TEXT: Record<"both" | "contract", Record<Locale, PerMemberText>> = {
  both: {
    zh: { title: "签署抄袭声明和小组合约", howto: ["找到作业要求里的抄袭声明和小组合约（free-rider）表格", "在两张表上填自己的名字和学号、写上自己负责的部分，亲笔签名，交给负责提交的组员"], checklist: ["两张表上都有自己的名字和学号", "合约上写了自己负责的部分", "交给了负责提交的人"], own: "签名的是自己本人（别人不能代签）" },
    en: { title: "Sign the plagiarism statement and the group contract", howto: ["Find the plagiarism statement and the group contract (free-rider) forms the brief refers to", "Fill in your name, ID and role, sign both and hand them to whoever submits"], checklist: ["Both forms carry your name and ID", "Your role is written on the contract", "Handed to whoever submits"], own: "Signed by you personally (nobody signs for you)" },
  },
  contract: {
    zh: { title: "签署小组合约（free-rider 表）", howto: ["找到作业要求里的小组合约（free-rider）表格", "填上自己的名字、学号和负责的部分，亲笔签名和写日期，交给负责提交的组员"], checklist: ["表上有自己的名字、学号和负责的部分", "交给了负责提交的人"], own: "签名的是自己本人（别人不能代签）" },
    en: { title: "Sign the group contract (free-rider form)", howto: ["Find the group contract (free-rider) form the brief refers to", "Fill in your name, ID and role, sign and date it, and hand it to whoever submits"], checklist: ["The form carries your name, ID and role", "Handed to whoever submits"], own: "Signed by you personally (nobody signs for you)" },
  },
};

/**
 * Forms the whole group signs (the plagiarism statement, the free-rider contract) are signed by each
 * member personally: one signing task per member covering every such form, instead of one task for the
 * group or one task per form. Runs after the coverage check. Returns a note.
 */
export function ensureSignatures(out: BriefOut, briefText: string | null, count: number, locale: Locale): string {
  if (!briefText || count < 2) return "signatures: nothing to do";
  const flat = briefText.replace(/\s+/g, " ");
  const contract = CONTRACT_BRIEF_RE.test(flat);
  const plagiarism = PLAGIARISM_FORM_RE.test(flat);
  if (!contract && !plagiarism) return "signatures: no form to sign";
  const signing = out.tasks.filter((t) => t.kind === "DOC" && t.estimateHours <= 1.5 && SIGN_TASK_RE.test(t.title) && SIGN_FORM_RE.test(t.title));
  const total = signing.reduce((s, t) => s + weight(t), 0);
  const declaration = PER_MEMBER.find((p) => p.id === "declaration")!;
  const text = contract ? (plagiarism ? SIGN_TEXT.both : SIGN_TEXT.contract)[locale] : locale === "zh" ? declaration.zh : declaration.en;
  const at = signing.length ? out.tasks.indexOf(signing[0]!) : out.tasks.length;
  for (const t of signing) out.tasks.splice(out.tasks.indexOf(t), 1);
  const one: BriefTaskOut = {
    title: text.title,
    kind: "DOC",
    points: Math.max(0.4, total || (referenceTasks(out).reduce((s, t) => s + weight(t), 0) || 100) * 0.02),
    estimateHours: 0.5,
    suggestedDue: signing.map((t) => t.suggestedDue).find(Boolean) ?? null,
    milestone: signing.map((t) => t.milestone).find(Boolean) ?? null,
    feature: null,
    part: null,
    briefFrom: signing.map((t) => t.briefFrom).find((n) => n != null) ?? null,
    briefTo: signing.map((t) => t.briefTo).find((n) => n != null) ?? null,
    quote: null,
    howto: [...text.howto],
    checklist: [...text.checklist],
    prereqTitle: null,
  };
  out.tasks.splice(at, 0, one);
  // The copies join each member's other copies (「个人方案 n」 or 「组员 n」), whichever this plan uses.
  const features = new Set(allTasks(out).map((t) => t.feature).filter((f): f is string => !!f && MARK_FEATURE_RE.test(f)));
  const feature = (n: number) => (features.size >= count ? (locale === "zh" ? `个人方案 ${n}` : `Individual solution ${n}`) : locale === "zh" ? `组员 ${n}` : `Member ${n}`);
  multiplyPerMember(out.tasks, [one], count, text, feature, locale);
  return `signatures: ${signing.length} signing task(s) → ${count} (${[plagiarism && "plagiarism statement", contract && "contract"].filter(Boolean).join(" + ")})`;
}

// ─── AI-use colours ──────────────────────────────────────────────────────────

/** The brief's key to an AI-use colour code ("Green (AI-Supported) … Red (No AI)"). */
const AI_LEGEND_RE = /green\s*\(\s*AI[-\s]?supported|yellow\s*\(\s*limited\s+AI|red\s*\(\s*no\s+AI|(?:绿色|黄色|红色)\s*[(（:：]?\s*(?:可以用|有限|禁止|不准)[^。\n]{0,8}AI/i;
const AI_COLOUR_STEP_RE = /(?:绿色|黄色|红色|\bgreen\b|\byellow\b|\bred\b)[^。.\n]{0,16}(?:级别|等级|标记|\blevel\b|AI)|AI[^。.\n]{0,24}(?:绿色|黄色|红色|\bgreen\b|\byellow\b|\bred\b)/i;
const AI_REMINDER: Record<Locale, string> = {
  zh: "这份作业对用 AI 有规定：动手前先确认这一项准不准用 AI、能用到什么程度。",
  en: "The brief has rules on using AI: before you start, check whether this item allows AI and how far.",
};

/**
 * The brief marks AI use per item with colours the extracted text often doesn't carry (dots in the
 * rubric table), so a step naming a colour or level is a guess (a "no AI" item told it may use AI). It
 * becomes a plain reminder to check the rule. Returns how many steps changed.
 */
export function groundAiColours(out: BriefOut, briefText: string | null, locale: Locale): number {
  if (!briefText || !AI_LEGEND_RE.test(briefText)) return 0;
  let n = 0;
  for (const t of allTasks(out)) t.howto = t.howto.map((s) => (AI_COLOUR_STEP_RE.test(s) ? (n++, AI_REMINDER[locale]) : s)).filter((s, i, a) => a.indexOf(s) === i);
  return n;
}

/** 「从各组员提出的点子里选一个」: the options are the members' own work, not ones the brief lists. */
const OWN_RESULTS_RE =
  /(?:组员|成员|同学|每人|各人|大家)[^。；;\n]{0,30}(?:提出|提交|想出|想到)的|(?:members?|students?)['’]?\s+(?:own|individual)\s+(?:ideas?|opportunit\w*|proposals?|results?)|(?:proposed|provided|submitted|suggested)\s+(?:earlier\s+)?by\s+(?:the\s+)?(?:team\s+|group\s+)?members/i;
const PICK_MEETING_RE = /选出|挑选|选定|评选|投票|\bpick|\bchoose|\bselect|\bvote/i;

/**
 * A question whose options are the members' own results (the model invented options for 「从各人的点子里选
 * 一个」) goes: that choice is a meeting, added when no task holds it. Returns how many went.
 */
export function dropInventedQuestions(out: BriefOut, locale: Locale): number {
  const invented = out.questions.filter((q) => OWN_RESULTS_RE.test(q.prompt));
  if (!invented.length) return 0;
  out.questions = out.questions.filter((q) => !invented.includes(q));
  if (!out.tasks.some((t) => t.kind === "MEETING" && PICK_MEETING_RE.test(t.title))) {
    const ref = referenceTasks(out).reduce((s, t) => s + weight(t), 0) || 100;
    out.tasks.unshift({
      title: locale === "zh" ? "一起从各人的成果里选出要做的一个" : "Pick one of the members' results together",
      kind: "MEETING",
      points: Math.max(0.1, ref * 0.01),
      estimateHours: 1,
      suggestedDue: null,
      milestone: null,
      feature: null,
      part: null,
      briefFrom: null,
      briefTo: null,
      quote: null,
      howto: [invented[0]!.prompt],
      checklist: [locale === "zh" ? "开过会并记下了选了哪一个" : "Met and wrote down which one was picked"],
      prereqTitle: null,
    });
  }
  return invented.length;
}

export function checkBrief(answer: BriefOut, ctx: CheckContext): { out: BriefOut; notes: string[] } {
  const out = structuredClone(answer);
  const notes: string[] = [];
  const invented = dropInventedQuestions(out, ctx.locale);
  if (invented) notes.push(`questions: dropped ${invented} whose options are the members' own results (a meeting instead)`);
  const filled = fillMissingPoints(out);
  if (filled) notes.push(`points: ${filled} task(s) without points got them from their hours`);
  const labels = tidyOptionLabels(out);
  if (labels) notes.push(`options: numbering taken off ${labels} label(s)`);
  const unchained = unchainSections(out);
  if (unchained) notes.push(`prereqs: ${unchained} document task(s) chained one after another now run in parallel`);
  const { individual, note } = ensureEachMember(out, ctx.briefText, ctx.packageCount, ctx.locale);
  notes.push(note);
  notes.push(ensurePerMember(out, ctx.briefText, ctx.packageCount, ctx.locale, individual));
  const added = ensureCoverage(out, ctx.briefText, ctx.locale);
  if (added.length) notes.push(`coverage: added ${added.join(", ")}`);
  notes.push(ensureSignatures(out, ctx.briefText, ctx.packageCount, ctx.locale));
  const colours = groundAiColours(out, ctx.briefText, ctx.locale);
  if (colours) notes.push(`ai rules: ${colours} step(s) guessed an item's AI colour: a plain reminder instead`);
  if (out.meetingFirst && !meetingJustified(out, individual)) {
    const m = out.meetingFirst;
    out.meetingFirst = null;
    const why = individual.size ? "each member builds an independent solution" : "no code of different features waits for another";
    // A meeting about something else (「选出最好的点子」, 「确定分工」) is still work to do: an ordinary task.
    if (!INTERFACE_RE.test(`${m.title} ${m.why}`) && m.title.trim() && !out.tasks.some((t) => norm(t.title) === norm(m.title))) {
      const ref = referenceTasks(out).reduce((s, t) => s + weight(t), 0) || 100;
      out.tasks.unshift({ title: m.title, kind: "MEETING", points: Math.max(0.1, ref * 0.01), estimateHours: 1, suggestedDue: null, milestone: null, feature: null, part: null, briefFrom: null, briefTo: null, quote: null, howto: m.why ? [m.why] : [], checklist: [ctx.locale === "zh" ? "开过会并记下了决定" : "Met and wrote down the decision"], prereqTitle: null });
      notes.push(`meetingFirst: made an ordinary meeting task (${why})`);
    } else notes.push(`meetingFirst: dropped (${why})`);
  }
  const over = clampHours(out);
  if (over) notes.push(`hours: ${over} task(s) over 10 h clamped`);
  notes.push(rescaleToParts(out, ctx.parts === undefined ? gradedParts(ctx.briefText) : ctx.parts));
  return { out, notes };
}
