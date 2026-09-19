// Free rule-based brief parser (used when the project has no AI key). Chinese and English.
// It does not understand meaning: it finds scored items ("40%", "占 40 分", "40 marks") or list items
// ("1.", "•", "(a)", "一、"), turns each into a task, and guesses its kind from keywords.
import type { TaskKind } from "../../../../shared/types";

export type RuleTask = {
  title: string;
  kind: TaskKind;
  /** Raw weight: the number found (SCORES) or 1 (LIST). The caller apportions to 1000 tenths. */
  weight: number;
};

export type RulesResult =
  | { ok: true; method: "SCORES" | "LIST"; tasks: RuleTask[] }
  | { ok: false; reason: "NO_STRUCTURE" | "EMPTY" };

/** Longest task title the rules produce (characters). */
export const MAX_TITLE_CHARS = 120;
/**
 * Scored items with no stated total count as a mark sheet only when they add up to roughly a full
 * mark. Items that add up exactly to the total the brief states ("Total 30 marks") always count.
 */
const SCORE_SUM_MIN = 40;
const SCORE_SUM_MAX = 160;
/** A numbered list longer than this is cut (a brief is not a 300-line code listing). */
const MAX_LIST_TASKS = 50;
/** Text beyond this is ignored: briefs are a few pages; this bounds the work on odd input. */
const MAX_INPUT_CHARS = 300_000;
/** A mark sheet line is never this long; longer lines are prose and only their start is read. */
const MAX_LINE_CHARS = 2000;
/** In a typed description, a line longer than this is a paragraph, not one task (the app's hint uses the same limit). */
export const TYPED_PARAGRAPH_CHARS = 200;

export type ParseOptions = {
  /**
   * Text the leader typed in 「打字描述」: unless its scores make a mark sheet, every line ended with
   * the Enter key is one task, numbered or not (screen wrapping is not a line). Uploaded files never set this.
   */
  typed?: boolean;
};

/** Turns brief text (typed, or extracted from a file) into tasks. Never throws on odd input. */
export function parseBriefWithRules(text: string, opts: ParseOptions = {}): RulesResult {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "EMPTY" };
  try {
    const lines = readLines(text);
    if (lines.every((l) => l.blank)) return { ok: false, reason: "EMPTY" };
    const scored = findScoredItems(lines);
    const listed = findListItems(lines);
    if (scored && !(listed && listBeatsScores(listed, scored))) {
      return { ok: true, method: "SCORES", tasks: scored.items.map((c) => ({ title: c.title, kind: guessKind(c.title), weight: c.weight })) };
    }
    // Before the list reader, which would merge a line into the item above it or keep only one list of
    // several. A single typed line ("要做的事：1. 做网站 2. 写报告") still goes to the list reader.
    if (opts.typed) {
      const titles = typedLineTitles(text);
      if (titles.length >= 2) return { ok: true, method: "LIST", tasks: titles.map((title) => ({ title, kind: guessKind(title), weight: 1 })) };
    }
    if (listed) return { ok: true, method: "LIST", tasks: listed.titles.map((title) => ({ title, kind: guessKind(title), weight: 1 })) };
  } catch {
    // Unexpected input shapes fall through to "can't split it" rather than a server error.
  }
  return { ok: false, reason: "NO_STRUCTURE" };
}

/** A typed line that only introduces the lines below it (「要做的事：」, "We need to:"). */
const LEAD_IN_LINE_RE = /[:：]$/;
/** A name needs something besides numbers, punctuation and symbols ("3.", "•", "20%" are not tasks). */
const HAS_NAME_RE = /[^\d\p{P}\p{S}\s]/u;

/**
 * 「一行一件事」: one task per typed line, skipping blank lines, lead-in lines, lines with no name and
 * paragraph-long lines. The app's 「会拆成 N 个任务」 count (typedTaskCount) follows the same rules.
 */
function typedLineTitles(text: string): string[] {
  const titles: string[] = [];
  for (const raw of normalize(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.length > TYPED_PARAGRAPH_CHARS || LEAD_IN_LINE_RE.test(line)) continue;
    const title = cleanTitle(firstSentence(line)) || cleanTitle(line);
    if (HAS_NAME_RE.test(title)) titles.push(title);
    if (titles.length >= MAX_LIST_TASKS) break;
  }
  return titles;
}

// ─── Kinds ────────────────────────────────────────────────────────────────────

type KindHit = TaskKind | "PRESENTATION";

// Chinese keywords match as substrings; English ones as whole words (with the listed suffixes).
const KIND_ZH: [KindHit, string[]][] = [
  ["MEETING", ["会议", "會議", "开会", "開會", "组会", "組會", "例会", "例會", "讨论", "討論"]],
  ["PRESENTATION", ["口头报告", "口頭報告", "演示", "汇报", "匯報", "答辩", "答辯", "展示", "路演", "上台"]],
  ["DESIGN", ["设计", "設計", "海报", "海報", "幻灯片", "幻燈片", "演示文稿", "视频", "視頻", "短片", "影片", "拍摄", "拍攝", "剪辑", "剪輯", "动画", "動畫", "界面", "草图", "草圖", "配色", "原型图", "原型圖", "线框图", "線框圖", "宣传册", "宣傳冊", "传单", "傳單", "插画", "插畫"]],
  ["CODE", ["代码", "代碼", "编程", "編程", "程序", "程式", "系统", "系統", "开发", "開發", "网站", "網站", "网页", "網頁", "应用", "應用", "数据库", "數據庫", "資料庫", "实现", "實現", "编码", "編碼", "前端", "后端", "後端", "部署", "原型"]],
  ["RESEARCH", ["调研", "調研", "调查", "調查", "问卷", "問卷", "访谈", "訪談", "采访", "採訪", "研究", "文献", "文獻", "资料", "資料", "考察", "观察", "觀察", "数据收集", "收集数据"]],
  ["DOC", ["报告", "報告", "文档", "文檔", "论文", "論文", "计划书", "計劃書", "策划书", "策劃書", "企划书", "企劃書", "说明书", "說明書", "手册", "手冊", "反思", "总结", "總結", "综述", "綜述", "文章", "周报", "週報"]],
];

const KIND_EN: [KindHit, string][] = [
  ["MEETING", String.raw`meetings?|minutes|stand-?ups?`],
  ["PRESENTATION", String.raw`presentations?|present(?:ing)?|pitch(?:es|ing)?|demos?|demonstrations?|viva|oral`],
  ["DESIGN", String.raw`design(?:s|ing|ed)?|posters?|slides?|slide\s?decks?|decks?|videos?|mock-?ups?|ui|ux|ui\/ux|wireframes?|storyboards?|infographics?|brochures?|leaflets?|flyers?|banners?|logos?|powerpoint|ppt|canva|figma|animations?|illustrations?`],
  ["CODE", String.raw`implement\w*|develop\w*|code|codes|coding|source\s+code|program(?:s|ming|med)?|systems?|websites?|web\s?(?:site|page|app)s?|apps?|applications?|apis?|databases?|prototyp(?:e|es|ing)|front-?end|back-?end|deploy\w*|software|python|java|javascript|android|ios|flutter|react|html|css|sql|arduino|iot|chatbots?|algorithms?|debug\w*`],
  ["RESEARCH", String.raw`research\w*|surveys?|interview(?:s|ing)?|literature|questionnaires?|data\s+collection|collect(?:ing)?\s+data|field\s?work|field\s+trips?|observations?|focus\s+groups?|benchmark\w*`],
  ["DOC", String.raw`reports?|proposals?|essays?|documentation|documents?|reflections?|reflective|write-?ups?|summary|summaries|manuals?|papers?|thesis|journals?|portfolios?|specifications?|guides?|articles?|plans?|charter`],
];

const KIND_EN_RE = KIND_EN.map(([kind, src]) => [kind, new RegExp(String.raw`\b(?:${src})\b`, "gi")] as const);
// "20-minute", "10 分钟": durations are not meeting minutes.
const DURATION_RE = /\d+\s*-?\s*(?:minutes?|mins?|分钟|分鐘|hours?|hrs?|小时|小時)/gi;
const DESIGN_WORD_RE = /^(?:design\w*|设计|設計)$/i;
// After the first keyword, a preposition or clause break starts a modifier ("report on the survey").
const CUT_RE =
  /\s(?:on|about|of|for|to|with|using|regarding|from|at|in|by|into|based|including|covering|via|that|which|who|where|explaining|describing|showing|detailing|discussing)\b|[,;:，；：(（、]/gi;

type Hit = { kind: KindHit; start: number; end: number; word: string };

/** Guesses a task kind from its title (zh + en keywords). Defaults to DOC. */
export function guessKind(title: string): TaskKind {
  if (!title) return "DOC";
  const text = title.replace(DURATION_RE, (m) => " ".repeat(m.length));
  const found: Hit[] = [];
  for (const [kind, words] of KIND_ZH) {
    for (const w of words) {
      let at = text.indexOf(w);
      while (at >= 0) {
        found.push({ kind, start: at, end: at + w.length, word: w });
        at = text.indexOf(w, at + w.length);
      }
    }
  }
  for (const [kind, re] of KIND_EN_RE) {
    for (const m of text.matchAll(re)) found.push({ kind, start: m.index, end: m.index + m[0].length, word: m[0] });
  }
  // Longest match wins where matches overlap ("口头报告" over "报告", "演示文稿" over "演示").
  found.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const hits: Hit[] = [];
  for (const h of found) {
    const prev = hits[hits.length - 1];
    if (prev && h.start < prev.end) {
      if (h.end - h.start > prev.end - prev.start) hits[hits.length - 1] = h;
      continue;
    }
    // "结果与讨论" is a report section, not a meeting.
    if ((h.word === "讨论" || h.word === "討論") && /[与和及、與]$/.test(text.slice(0, h.start))) continue;
    hits.push(h);
  }
  if (hits.length === 0) return "DOC";
  let cutAt = text.length;
  for (const m of text.matchAll(CUT_RE)) {
    if (m.index >= hits[0]!.end) {
      cutAt = m.index;
      break;
    }
  }
  const kept = hits.filter((h) => h.start < cutAt);
  const kinds: KindHit[] = kept.map((h, i) => {
    // "问卷设计", "database design": designing a questionnaire is research, a database is code.
    const prev = kept[i - 1];
    if (prev && DESIGN_WORD_RE.test(h.word) && /^[\s-]*$/.test(text.slice(prev.end, h.start)) && prev.kind !== "DOC") {
      return prev.kind;
    }
    return h.kind;
  });
  let kind = kinds[kinds.length - 1]!;
  if (kind === "PRESENTATION") return "DESIGN";
  // "调研报告", "survey report", "literature review": the research is the work.
  if (kind === "DOC" && kinds.includes("RESEARCH")) kind = "RESEARCH";
  return kind;
}

// ─── Lines ────────────────────────────────────────────────────────────────────

type Marker = { style: string; ordinal: number | null; label: string };

type Line = {
  i: number;
  text: string;
  indent: number;
  blank: boolean;
  marker: Marker | null;
  /** Text after the marker. */
  body: string;
  /** 0 = not a heading, 1 = ends with a colon, 2 = a section heading. */
  heading: 0 | 1 | 2;
  /** Indexes of the item lines this line sits under. */
  parents: number[];
  /** Wrapped lines that belong to this item (their own entries are marked absorbed). */
  continuation: string[];
  absorbed: boolean;
};

function normalize(text: string): string {
  return text
    .slice(0, MAX_INPUT_CHARS)
    .replace(/\r\n?|\u2028|\u2029/g, "\n")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[％﹪]/g, "%")
    // Word's Symbol-font bullets come out of PDFs as private-use characters.
    .replace(/[\uF0B7\uF0A8]/g, "•")
    .replace(/[\uF0A7\uF06E]/g, "▪")
    .replace(/[\uF0D8\uF0E0]/g, "➢")
    .replace(/\uF0FC/g, "✓")
    .replace(/\uF076/g, "❖")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function readLines(text: string): Line[] {
  const raw = expandInlineLists(normalize(text).split("\n").map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) : l)));
  const lines: Line[] = [];
  const letters = new Map<string, number>();
  for (const r of raw) {
    const lead = /^[ \t]*/.exec(r)![0];
    const indent = [...lead].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
    const t = r.trim();
    const marker = t ? detectMarker(t, letters) : null;
    const body = marker ? t.slice(marker.label.length).trim() : t;
    const line: Line = { i: lines.length, text: t, indent, blank: !t, marker, body, heading: 0, parents: [], continuation: [], absorbed: false };
    line.heading = headingLevel(line);
    lines.push(line);
  }
  assignParents(lines);
  absorbContinuations(lines);
  return lines;
}

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (ch === "百") {
      total += (cur || 1) * 100;
      cur = 0;
    } else if (ch in CN_DIGITS) cur = CN_DIGITS[ch]!;
    else return null;
  }
  return total + cur;
}

const ROMAN_RE = /^(x{0,3})(ix|iv|v?i{0,3})$/i;
function romanNumber(s: string): number | null {
  const m = ROMAN_RE.exec(s);
  if (!s || !m) return null;
  const tens = m[1]!.length * 10;
  const unitsMap: Record<string, number> = { "": 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
  const units = unitsMap[m[2]!.toLowerCase()];
  return units === undefined ? null : tens + units;
}

/**
 * A letter or roman-numeral marker. "ii", "iv" are roman; a single "i" is roman unless it follows
 * "h" in the same list form, and "v"/"x" are roman only right after "iv"/"ix".
 */
function letterMarker(token: string, form: string, state: Map<string, number>): { style: string; ordinal: number } | null {
  const lower = token.toLowerCase();
  const key = form + (token === token.toUpperCase() ? "U" : "L");
  const roman = romanNumber(lower);
  const code = lower.charCodeAt(0) - 96;
  let isRoman: boolean;
  if (lower.length > 1) isRoman = roman !== null;
  else if (state.get(`a${key}`) === code - 1) isRoman = false;
  else isRoman = roman !== null && (lower === "i" || state.get(`r${key}`) === roman - 1);
  if (isRoman && roman !== null) {
    state.set(`r${key}`, roman);
    return { style: `roman${key}`, ordinal: roman };
  }
  if (lower.length !== 1) return null;
  state.set(`a${key}`, code);
  return { style: `alpha${key}`, ordinal: code };
}

const WORD_MARKER_RE =
  /^(part|section|task|question|deliverable|component|stage|phase|step|milestone|activity|chapter|criterion|criteria|item|q)\s*([A-Z]|\d{1,2}|[ivxIVX]{1,4})(?!\w|\.\d)\s*(?:[:.)\-–—]\s*|(?=\s+[A-Z\u3400-\u9FFF(（“"'‘])|$)/i;

function detectMarker(t: string, letters: Map<string, number>): Marker | null {
  let m: RegExpExecArray | null;
  if ((m = /^第\s*([一二三四五六七八九十百零〇两兩\d]{1,4})\s*(部分|章|节|節|项|項|条|條|点|點|题|題|阶段|階段|步)\s*[:：、.．)）\-–—]?\s*/.exec(t))) {
    return { style: `cn-${m[2]}`, ordinal: cnNumber(m[1]!), label: m[0] };
  }
  if ((m = /^([一二三四五六七八九十]{1,3})\s*[、.．]\s*/.exec(t))) return { style: "cn、", ordinal: cnNumber(m[1]!), label: m[0] };
  if ((m = /^[（(]\s*([一二三四五六七八九十]{1,3})\s*[）)]\s*/.exec(t))) return { style: "(cn)", ordinal: cnNumber(m[1]!), label: m[0] };
  if ((m = /^[（(]\s*(\d{1,2})\s*[）)]\s*/.exec(t))) return { style: "(dec)", ordinal: Number(m[1]), label: m[0] };
  if ((m = /^([\u2460-\u2473])\s*/.exec(t))) return { style: "circ", ordinal: m[1]!.charCodeAt(0) - 0x245f, label: m[0] };
  if ((m = /^([\u2776-\u277F])\s*/.exec(t))) return { style: "circ-dark", ordinal: m[1]!.charCodeAt(0) - 0x2775, label: m[0] };
  if ((m = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(?=[A-Z\u3400-\u9FFF(（“"'‘])/.exec(t))) {
    const parts = m[1]!.split(".");
    // "2.0 Tasks" heads a section whose items are "2.1", "2.2"…
    if (parts.slice(1).every((p) => /^0+$/.test(p))) return { style: "dec-section", ordinal: Number(parts[0]), label: m[0] };
    return { style: `dec${parts.length}`, ordinal: Number(parts[parts.length - 1]), label: m[0] };
  }
  if ((m = /^(\d{1,2})\s*([.)、．）:：])(?![\d.])\s*/.exec(t))) {
    const sep = m[2] === "．" ? "." : m[2] === "）" ? ")" : m[2] === "：" ? ":" : m[2]!;
    // "10: 30" is a time, "3: …" after a label is rare; a bare "1:" still reads as numbering.
    return { style: `dec${sep}`, ordinal: Number(m[1]), label: m[0] };
  }
  if ((m = /^[（(]\s*([a-zA-Z]{1,4})\s*[）)]\s*/.exec(t))) {
    const lm = letterMarker(m[1]!, "()", letters);
    if (lm) return { ...lm, label: m[0] };
  }
  if ((m = /^([a-zA-Z]{1,4})\s*([.)）])\s+/.exec(t))) {
    const lm = letterMarker(m[1]!, m[2] === "." ? "." : ")", letters);
    if (lm) return { ...lm, label: m[0] };
  }
  if ((m = WORD_MARKER_RE.exec(t))) {
    const word = m[1]!.toLowerCase().replace(/^criteri(on|a)$/, "criteria");
    const id = m[2]!;
    const ordinal = /^\d+$/.test(id) ? Number(id) : (romanNumber(id) ?? id.toLowerCase().charCodeAt(0) - 96);
    return { style: `word-${word}`, ordinal, label: m[0] };
  }
  if ((m = /^([•●○◦▪▫■□◆◇►▶➢➤✓✔❖✗✘·‣⁃∙⦁*+\-–—−])\s+/.exec(t))) {
    const ch = m[1] === "−" ? "-" : m[1]!;
    return { style: `bullet${ch}`, ordinal: null, label: m[0] };
  }
  if ((m = /^o\s+(?=[A-Z\u3400-\u9FFF])/.exec(t))) return { style: "bullet-o", ordinal: null, label: m[0] };
  if ((m = /^(?:\[\s?[xX✓]?\s?\]|[☐☑☒])\s*/.exec(t))) return { style: "bullet[]", ordinal: null, label: m[0] };
  return null;
}

/** "要做的事：1. 做网站 2. 写报告" (typed on one line) → one line per numbered item. */
function expandInlineLists(lines: string[]): string[] {
  const out: string[] = [];
  const patterns: { re: RegExp; ord: (m: RegExpExecArray) => number }[] = [
    { re: /(?<=^|[\s，,；;。:：])(\d{1,2})[.)、．）](?![\d.])(?=\s*\S)/g, ord: (m) => Number(m[1]) },
    { re: /(?<=^|[\s，,；;。:：])[（(](\d{1,2})[）)](?=\s*\S)/g, ord: (m) => Number(m[1]) },
    { re: /([\u2460-\u2473])(?=\s*\S)/g, ord: (m) => m[1]!.charCodeAt(0) - 0x245f },
    { re: /(?<=^|[\s，,；;:：])[（(]?([a-h])[）)](?=\s*\S)/g, ord: (m) => m[1]!.charCodeAt(0) - 96 },
  ];
  for (const line of lines) {
    let split: number[] | null = null;
    for (const { re, ord } of patterns) {
      const found = [...line.matchAll(re)].map((m) => ({ at: m.index, n: ord(m as RegExpExecArray) }));
      // Longest run of consecutive numbers starting at 1 (or continuing the first marker).
      const run: number[] = [];
      let next = -1;
      for (const f of found) {
        if (run.length === 0) {
          if (f.n === 1) {
            run.push(f.at);
            next = 2;
          }
        } else if (f.n === next) {
          run.push(f.at);
          next++;
        }
      }
      const inline = run.some((at) => line.slice(0, at).trim() !== "");
      if (run.length >= 2 && inline) {
        split = run;
        break;
      }
    }
    if (!split) {
      out.push(line);
      continue;
    }
    const indent = /^[ \t]*/.exec(line)![0];
    const head = line.slice(0, split[0]).trim();
    if (head) out.push(indent + head);
    split.forEach((at, k) => out.push(indent + line.slice(at, split![k + 1] ?? line.length).trim()));
  }
  return out;
}

const SECTION_EN =
  /^(?:\d+(?:\.\d+)*\.?\s*)?(?:(?:project|assignment|group)\s+)?(?:background|introduction|overview|objectives?|aims?|learning\s+outcomes?|deliverables?|tasks?(?:\s+and\s+weightage)?|requirements?|scope|instructions?|guidelines?|submission(?:\s+(?:guidelines|details|requirements|instructions))?|assessments?(?:\s+(?:criteria|breakdown|components?))?|marking(?:\s+(?:scheme|rubric|criteria|guide))?|grading(?:\s+(?:scale|criteria|scheme))?|rubrics?|evaluation|notes?|important\s+notes?|references?|appendix|schedule|timeline|rules|judging\s+criteria|late\s+submission|academic\s+integrity|plagiarism|format(?:ting)?(?:\s+requirements)?|components?|what\s+you\s+need\s+to\s+do|contact|marking\s+scheme)\s*[:：]?$/i;
const SECTION_ZH_TAIL = /(背景|简介|簡介|介绍|介紹|目标|目標|要求|内容|內容|任务|任務|说明|說明|标准|標準|细则|細則|方式|事项|事項|须知|須知|安排|比重|等级|等級|评分|評分|附录|附錄|参考文献|參考文獻)[:：]?$/;

function headingLevel(line: Line): 0 | 1 | 2 {
  const t = line.text;
  if (!t) return 0;
  if (/^#{1,6}\s/.test(t)) return 2;
  if (line.marker) return 0;
  if (t.length <= 80 && /[:：]$/.test(t)) return 1;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && t === t.toUpperCase() && letters.length / t.length > 0.5 && t.length <= 70 && !/[.!?]$/.test(t)) return 2;
  if (t.length <= 40 && SECTION_EN.test(t)) return 2;
  if (t.length <= 14 && !/\d/.test(t) && SECTION_ZH_TAIL.test(t)) return 2;
  return 0;
}

/** Works out which item each line sits under, from indentation and numbering style. */
function assignParents(lines: Line[]) {
  const stack: { idx: number; indent: number; style: string }[] = [];
  let prevBlank = false;
  for (const line of lines) {
    if (line.blank) {
      prevBlank = true;
      continue;
    }
    if (line.marker) {
      const style = line.marker.style;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.indent > line.indent) {
          stack.pop();
          continue;
        }
        if (top.indent === line.indent) {
          if (top.style === style) {
            stack.pop();
            break;
          }
          if (stack.some((s) => s.indent === line.indent && s.style === style)) {
            stack.pop();
            continue;
          }
        }
        break;
      }
      line.parents = stack.map((s) => s.idx);
      stack.push({ idx: line.i, indent: line.indent, style });
    } else {
      const closes = line.heading === 2 || prevBlank;
      while (stack.length && (closes ? stack[stack.length - 1]!.indent >= line.indent : stack[stack.length - 1]!.indent > line.indent)) {
        stack.pop();
      }
      // Plain text only sits under items it is indented beneath; at the same indent it is a sibling row.
      line.parents = stack.filter((s) => s.indent < line.indent).map((s) => s.idx);
    }
    prevBlank = false;
  }
}

const TERMINAL_RE = /[.。!?！？;；:：]\s*$/;
const CONNECTOR_RE = /(?:[,，、(（\-–]|\b(?:and|or|of|the|to|for|with|in|on|a|an|by|from)\b)\s*$/i;

/** Joins lines that a PDF wrapped in the middle of a list item back onto the item. */
function absorbContinuations(lines: Line[]) {
  for (const line of lines) {
    if (!line.marker || line.absorbed) continue;
    if (findWeights(line.body).length > 0) continue;
    let text = line.body;
    for (let j = line.i + 1; j < lines.length && line.continuation.length < 3; j++) {
      const next = lines[j]!;
      if (next.blank || next.marker || next.heading || next.indent < line.indent || TERMINAL_RE.test(text)) break;
      if (isLabelLine(next.text)) break;
      const wrapped = /^[a-z]/.test(next.text) || CONNECTOR_RE.test(text) || text.length >= 60;
      if (!wrapped) break;
      line.continuation.push(next.text);
      next.absorbed = true;
      text = joinText(text, next.text);
      if (findWeights(next.text).length > 0) break;
    }
  }
}

function joinText(a: string, b: string): string {
  if (!a) return b;
  if (/[\u3400-\u9FFF，、（]$/.test(a) && /^[\u3400-\u9FFF（(]/.test(b)) return a + b;
  return `${a} ${b}`;
}

function logicalBody(line: Line): string {
  return line.continuation.reduce(joinText, line.body);
}

// ─── Weights ──────────────────────────────────────────────────────────────────

type Weight = { value: number; start: number; end: number; unit: "%" | "marks" | "points" | "fen" };

// "分钟" (minutes), "分之" (fractions), "分组" (grouping)… are not points.
const WEIGHT_RE =
  /(?<![\d.,])(\d{1,4}(?:\.\d{1,2})?)\s*(%|percent\b|marks?\b|pts?\b|points?\b|分(?![钟鐘之组組工配析别別享类類成为為开開布支段解担擔摊攤拆秒期册冊批队隊页頁数數辨手散发發送给給出]))/gi;
const RANGE_RE =
  /(\d{1,4}(?:\.\d+)?)\s*(%|分|marks?)?\s*(?:-|–|—|~|～|〜|至|到|to)\s*(\d{1,4}(?:\.\d+)?)\s*(%|分|marks?)/gi;
const RANGE_TEST_RE = new RegExp(RANGE_RE.source, "i");
const QUALIFIER_BEFORE_RE =
  /(?:≥|≤|>=?|<=?|=<|=>|\b(?:above|below|over|under|at\s+least|at\s+most|less\s+than|more\s+than|minimum(?:\s+of)?|maximum(?:\s+of)?|min\.?|max\.?|up\s+to|exceed(?:s|ing)?|within|about|around|approx(?:imately|\.)?|by|only|nearly|almost|reach(?:es|ing)?)|不少于|不低于|不超过|不高于|不得高于|不得低于|不得超过|不可超过|低于|高于|超过|超過|达到|達到|至少|最多|最少|约|約|大约|大約|增长了?|增加了?|减少了?|下降了?|提高了?|降低了?)\s*$/i;
const QUALIFIER_AFTER_RE = /^\s*(?:以上|以下|以内|以內|及以上|或以上|或以下|左右|\+|or\s+(?:more|above|higher|less|below|lower|better)|and\s+(?:above|below|over))/i;
const SEP_BEFORE_RE = /(?:占|佔|worth|weight(?:age|ing|ed)?|carr(?:y|ies|ying)|allocat\w*|score|分值|分数|分數|比重|权重|權重|占比|佔比|[:：=\-–—|\t,，、]| {2})\s*$/i;
// Two or more spaces (or a tab) separate table cells; "、", "/" and "and/和/及" separate items typed on one line.
const SEP_AFTER_RE =
  /^(?: {2,}|\t)|^\s*(?:[)）\]】,，;；:：\-–—|\t。.、/&]|(?:and|plus)\b|以及|和|及|与|與|of\s+(?:the\s+)?(?:total|overall|full)|each\b|$)/i;
// "20/40 marks": the score out of the weight belongs to the weight token.
const OUT_OF_RE = /\d{1,4}(?:\.\d{1,2})?\s*\/\s*$/;

function unitOf(s: string): Weight["unit"] {
  const u = s.toLowerCase();
  if (u === "%" || u === "percent") return "%";
  if (u.startsWith("mark")) return "marks";
  if (u === "分") return "fen";
  return "points";
}

/** Weights in a line that look like a mark allocation (not a range, a threshold or a number in prose). */
function findWeights(s: string): Weight[] {
  const ranges: [number, number][] = [];
  for (const m of s.matchAll(RANGE_RE)) {
    // "10% - 2 pages" is not a range; "80 - 100%" and "80% - 100%" are.
    if (m[2] && !m[4]) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  const out: Weight[] = [];
  for (const m of s.matchAll(WEIGHT_RE)) {
    const outOf = OUT_OF_RE.exec(s.slice(Math.max(0, m.index - 12), m.index));
    const start = m.index - (outOf ? outOf[0].length : 0);
    const end = m.index + m[0].length;
    const value = Number(m[1]);
    if (!(value > 0) || value > 1000) continue;
    if (ranges.some(([a, b]) => start < b && end > a)) continue;
    // Only the text near the number matters; short windows keep long lines linear.
    const before = s.slice(Math.max(0, start - 60), start);
    const after = s.slice(end, end + 60);
    if (QUALIFIER_BEFORE_RE.test(before) || QUALIFIER_AFTER_RE.test(after)) continue;
    const unit = unitOf(m[2]!);
    const bracketed = /[(（\[【][^()（）\[\]【】]{0,40}$/.test(before) && /^[^()（）\[\]【】]{0,40}[)）\]】]/.test(after);
    const atStart = start <= 60 && stripLead(before) === "";
    const tail = s.length - end <= 60 ? after : null;
    const atEnd = tail !== null && (/^[\s)）\]】.。,，;；:：!！]*$/.test(tail) || DUE_AFTER_RE.test(tail));
    const sepBefore = SEP_BEFORE_RE.test(before);
    const sepAfter = SEP_AFTER_RE.test(after);
    const structural = unit === "points" ? bracketed || sepBefore || atEnd : bracketed || atStart || atEnd || sepBefore || sepAfter;
    if (structural) out.push({ value, start, end, unit });
  }
  return out;
}

// Lines that carry numbers but are not items of the mark sheet.
const PENALTY_RE =
  /\b(?:late(?:ness)?|penal\w*|deduct\w*|lose|loses|losing|lost|plagiari\w*|turnitin|similarity|bonus|extra\s+credit|attendance|absent\w*|resubmi\w*|overdue)\b|迟交|遲交|逾期|延迟|延遲|扣|抄袭|抄襲|查重|相似度|重复率|重複率|出勤|缺席|加分|零分|不及格/i;
const COURSE_WEIGHT_RES = [
  /\b(?:this|the|our|your|each)\s+(?:group\s+|individual\s+|final\s+|mini\s+)?(?:assignment|project|coursework|course\s?work|assessment|task|paper|mini[\s-]?project)\b.*\b(?:carr(?:y|ies)|contribut\w*|worth|account\w*\s+for|weigh\w*|constitut\w*|represent\w*|makes?\s+up|counts?|is\s+\d)/i,
  /\bof\s+(?:the|your)\s+(?:final|overall|total\s+course|course|module|subject|unit|semester)\b/i,
  /\b(?:to|towards)\s+(?:the|your)\s+(?:final|overall|course|module)\s+(?:grade|marks?|score|result)/i,
  /(?:本|该|該|此|这|這)(?:次|个|個|份|项|項)?(?:小组|小組)?(?:作业|作業|项目|項目|课题|課題|大作业|大作業|报告|報告|任务|任務|考核|作品)[^。]*?(?:占|佔|满分|滿分|共|计|計)/,
  /(?:课程|課程|科目|本科|期末|学期|學期)(?:总|總)?(?:成绩|成績|评|評|分)/,
  /总评|總評/,
];
const TOTAL_RE =
  /^[\s\d.、)）(（|:：\-–—•*#]*(?:(?:grand|sub)[\s-]?)?(?:total|overall\s+total|合计|合計|总计|總計|总分|總分|满分|滿分|共计|共計|小计|小計|总和|總和|总共|總共|共)(?:\s*(?:weightage|weight|marks?|score|points?|percentage|分数|分數|分值))?\s*(?:[:：=]|为|為|是)?\s*[(（]?\s*(\d{1,4}(?:\.\d+)?)\s*(?:%|分|marks?|points?|pts?)?\s*[)）]?\s*[.。]?$/i;

function totalValue(t: string): number | null {
  const cells = splitCells(t);
  const m = TOTAL_RE.exec(cells.length > 1 ? cells.join(" ") : t);
  return m ? Number(m[1]) : null;
}

// "Subtotal 30", "小计 30 分" add up one section of the sheet, not the whole of it.
const SUBTOTAL_RE = /\bsub[\s-]?total|小计|小計/i;

function isExcluded(t: string): boolean {
  return PENALTY_RE.test(t) || COURSE_WEIGHT_RES.some((re) => re.test(t));
}

// ─── Titles ───────────────────────────────────────────────────────────────────

const DUE_AFTER_RE =
  /^\s*(?:[-–—,，;；]\s*)?[(（\[]?\s*(?:due|deadline|submission|submit\s+by|to\s+be\s+submitted|week|wk)\b[^()（）]*[)）\]]?\s*[.。]?\s*$/i;
const DUE_TAIL_RES = [
  /\s*[(（\[]\s*(?:due|deadline|submission|submit\s+by|to\s+be\s+submitted|week|wk)\b[^()（）\[\]]*[)）\]]/gi,
  /\s*[-–—,，;；|]\s*(?:due|deadline|submission|submit\s+by|to\s+be\s+submitted|week|wk)\b.*$/i,
  /\s*[(（]\s*(?:截止|截至|第\s*\d+\s*[周週])[^()（）]*[)）]/g,
  /\s*[，,；;]\s*(?:第\s*\d+\s*[周週]|截止|截至|\d+\s*月\s*\d+\s*日).*$/,
];
const LABEL_WORDS =
  /(?:weightage|weighting|weight|worth|carr(?:y|ies|ying)|mark\s+allocation|allocation|marks?|score|points?|percentage|分值|分数|分數|占总成绩的|占总分的|占总分|占比|佔比|比重|权重|權重|占|佔)/i;
// Only words that introduce a weight are cut from the end ("Credit score" keeps its "score").
const LABEL_TAIL_RE =
  /(?:\s*[:：=]?\s*(?:(?:is|are|will\s+be)\s+)?(?:weightage|weighting|weighted|weight|worth|carr(?:y|ies|ying)|(?:mark\s+)?allocation|占总成绩的|占总分的|占总分|占比|佔比|占|佔|分值|比重|权重|權重)\s*[:：=]?\s*)+$/i;
const LABEL_HEAD_RE = new RegExp(String.raw`^\s*(?:${LABEL_WORDS.source})\s*[:：=]\s*`, "i");
const GENERIC_PREFIX_RE =
  /^(?:(?:part|section|task|question|deliverable|component|stage|step|item|criteria|criterion|q)\s*(?:[A-Z]|\d{1,2}|[ivx]{1,4})\s*[:.\-–—)]\s*|第\s*[一二三四五六七八九十\d]{1,3}\s*(?:部分|项|項|题|題)\s*[:：、.\-–—]\s*|(?:任务|任務|部分)\s*[一二三四五六七八九十\dA-Z]{1,3}\s*[:：、.\-–—]\s*)(?=\S)/i;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const WEEKDAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?`;
const WHEN = [
  String.raw`(?:weeks?|wk)\s*\d{1,2}(?:\s*(?:-|–|~|to|&|and)\s*\d{1,2})?`,
  String.raw`第\s*[\d一二三四五六七八九十]{1,3}(?:\s*[-–~至到]\s*[\d一二三四五六七八九十]{1,3})?\s*[周週]`,
  String.raw`${WEEKDAY}\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?:,?\s+\d{4})?`,
  String.raw`${WEEKDAY}${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?`,
  String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`,
  String.raw`\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}`,
  String.raw`(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号號]`,
].join("|");
// "Week 5 - Proposal", "15 Oct 2026: Proposal", "Done by Week 4: Proposal", "(Week 5) Proposal": the server
// assigns its own due dates, so a schedule in front of the name only gets in the way.
const SCHEDULE_PREFIX_RE = new RegExp(
  String.raw`^(?:(?:due|done|completed?|submit(?:ted)?|deadline)\s*(?:by|in|on|at|before)?\s*[:：]?\s*)?(?:[(（\[]\s*(?:${WHEN})\s*[)）\]]\s*[:：\-–—|,，]?|(?:${WHEN})\s*[:：\-–—|,，])\s*(?=\S)`,
  "i",
);
const LEAD_PUNCT_RE = /^[\s:：\-–—=|,，、;；.。)）\]】>»·]+/;
const TRAIL_PUNCT_RE = /[\s:：\-–—=|,，、;；.。(（\[【<«]+$/;

function stripLead(s: string): string {
  return s.replace(LABEL_HEAD_RE, "").replace(LEAD_PUNCT_RE, "").trim();
}

function truncate(s: string): string {
  const chars = [...s];
  if (chars.length <= MAX_TITLE_CHARS) return s;
  return chars.slice(0, MAX_TITLE_CHARS).join("").trimEnd();
}

/** The first sentence of a list item ("Conduct a survey. It must…" → "Conduct a survey"). */
function firstSentence(s: string): string {
  const m = /(?<!\b(?:e\.g|i\.e|etc|vs|dr|mr|mrs|ms|no|fig|approx|min|max|[a-z]))[.!?](?=\s|$)|[。！？；;]/i.exec(s);
  if (!m) return s;
  const head = s.slice(0, m.index).trim();
  return head.length >= 2 ? head : s;
}

/** Strips numbering, bullets, weights, labels ("占", "worth", "weightage"), empty brackets and due dates. */
export function cleanTitle(input: string): string {
  let t = input
    .replace(/\*\*|__|`/g, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/[.·…_]{3,}|…+/g, " ")
    .replace(/\s*(?:\||\t)\s*/g, " ");
  for (let k = 0; k < 3; k++) {
    const trimmed = t.trim();
    const marker = detectMarker(trimmed, new Map());
    if (!marker || marker.label.trim() === trimmed) break;
    t = trimmed.slice(marker.label.length);
  }
  t = t.replace(GENERIC_PREFIX_RE, "");
  t = t.trimStart().replace(SCHEDULE_PREFIX_RE, "");
  t = removeWeightTokens(t);
  for (const re of DUE_TAIL_RES) t = t.replace(re, "");
  t = t.replace(/[(（\[【]\s*[)）\]】]/g, "");
  t = t.replace(LABEL_HEAD_RE, "").replace(LABEL_TAIL_RE, "");
  t = t.replace(/[(（\[【]\s*[)）\]】]/g, "");
  t = t.replace(LEAD_PUNCT_RE, "").replace(TRAIL_PUNCT_RE, "");
  t = t.replace(/\s+/g, " ").trim();
  // Unbalanced leftovers: "Report (3000 words" → keep, but drop a lone trailing opener or leading closer.
  t = t.replace(/^[)）\]】]\s*/, "").replace(/\s*[(（\[【]$/, "");
  if (/^[a-z]/.test(t) && !/^(?:e|i)[A-Z]/.test(t)) t = t[0]!.toUpperCase() + t.slice(1);
  return truncate(t);
}

function removeWeightTokens(s: string): string {
  let out = s;
  const ws = findWeights(s);
  for (let k = ws.length - 1; k >= 0; k--) {
    const w = ws[k]!;
    let a = w.start;
    let b = w.end;
    // Drop the whole bracket when it only holds the weight and labels: "(Weightage: 20%)".
    const open = /[(（\[【]([^()（）\[\]【】]{0,40})$/.exec(out.slice(0, a));
    const close = /^([^()（）\[\]【】]{0,40})[)）\]】]/.exec(out.slice(b));
    if (open && close) {
      const inner = (open[1]! + close[1]!).replace(LABEL_WORDS, "").replace(/[\s:：=,，;；]/g, "");
      if (!inner || /^(?:due|deadline|week|wk|截止|第\d+[周週])/i.test(inner)) {
        a = a - open[0].length;
        b = b + close[0].length;
      }
    }
    out = `${out.slice(0, a)} ${out.slice(b)}`;
  }
  return out;
}

/** A line that only says "Weightage: 20%", "(20 marks)", "分值：20 分": it belongs to the line above. */
function isLabelLine(t: string): boolean {
  if (BARE_LABEL_RE.test(t)) return true;
  const ws = findWeights(t);
  if (ws.length !== 1) return false;
  const rest = removeWeightTokens(t).replace(LABEL_WORDS, "").replace(/[\s:：=()（）\[\]【】,，.。\-–—|]/g, "");
  return rest === "";
}

const BARE_LABEL_RE = /^[\s(（]*(?:weightage|weighting|weight|marks?|score|points?|分值|分数|分數|占比|佔比|比重|权重|權重)\s*[:：=]\s*(\d{1,3}(?:\.\d{1,2})?)\s*[)）]?\s*$/i;

// ─── SCORES ───────────────────────────────────────────────────────────────────

type Candidate = { line: number; title: string; weight: number; parents: number[] };
/** The chosen mark sheet; `exact` when it adds up to the stated total (or 100), not just into 40–160. */
type Scored = { items: Candidate[]; exact: boolean };

const META_LINE_RE =
  /^(?:due|deadline|date|submission|submit|length|word\s+count|words|format|duration|time|venue|mode|type|clo|plo|截止|提交|日期|字数|字數|格式|时长|時長|时间|時間|地点|地點|形式|方式)\s*(?:date)?\s*[:：]/i;
const WEIGHT_HEADER_RE =
  /\b(?:weight(?:age|ing)?|marks?|score|points?|percentage)\b|^%$|^(?:分值|分数|分數|比例|占比|佔比|权重|權重|比重|得分)|[(（]\s*(?:%|marks?|分)\s*[)）]/i;
const GRADE_HEADER_RE = /\b(?:grade|gred|band|result|range|level)\b|等级|等級|成绩等级/i;
// Grade scales list grades, not work: "A 80%", "优秀：85分", "Pass mark 50%", "Distinction 75%".
const GRADE_TITLE_RE =
  /^(?:(?:grade|gred|band|level)\s*)?(?:[A-F][+-]?|excellent|very\s+good|good|satisfactory|fair|average|poor|weak|marginal(?:\s+pass)?|pass(?:ing)?(?:\s+(?:mark|grade|score))?|fail(?:ed|ure)?|(?:high\s+)?distinction|credit|merit|honou?rs?|(?:first|second|third)\s+class(?:\s+(?:upper|lower))?|优秀|優秀|良好|中等|及格|不及格|合格|不合格|优|優|良|中|差|甲|乙|丙|丁)(?:\s*[(（][^()（）]{0,20}[)）])?$/i;
// Headings of a grade scale. Bare "Grading", "Rubric" and "成绩评定" are left out on purpose: real mark
// sheets sit under them too ("Group Project Marking Rubric", "成绩评定：报告 40%，汇报 60%").
const GRADE_SECTION_RE =
  /^(?:(?:final|overall|course)\s+)?(?:grad(?:e|es|ing)\s+(?:scales?|system|boundar(?:y|ies)|bands?|table|distribution|ranges?|descriptors?|equivalents?|points?|policy)|marks?\s+(?:to|and)\s+grades?|成绩等级|成績等級|评分等级|評分等級|等级划分|等級劃分|等级标准|等級標準|等级|等級|等第|评级|評級)$/i;

function gradeHeading(line: Line): boolean {
  const head = (line.marker ? line.body : line.text).replace(/^#{1,6}\s*/, "").replace(/[\s:：]+$/, "");
  return head.length <= 40 && GRADE_SECTION_RE.test(head);
}

/** "成绩等级：A 80–100 分 B 65–79 分" on one line. */
function inlineGradeScale(t: string): boolean {
  const m = /^([^:：]{1,30})[:：]\s*\S/.exec(t);
  return !!m && GRADE_SECTION_RE.test(m[1]!.replace(/^#{1,6}\s*/, "").trim());
}
const REF_CELL_RE = /^(?:clo|plo|lo|mqf|co|po)\s*\d/i;

function splitCells(t: string): string[] {
  if (!/\||\t| {2,}/.test(t)) return [t];
  return t
    .split(/\s*\|\s*|\t+| {2,}/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

function isNumberCell(c: string): boolean {
  return /^\d{1,4}(?:\.\d{1,2})?\s*[.)]?$/.test(c);
}

/**
 * Every weighted item in the brief, in order, the total line's value, and the numbers a sentence about
 * the whole assignment states ("This assignment carries 30 marks", 「本作业满分 30 分」).
 */
function collectCandidates(lines: Line[]): { candidates: Candidate[]; total: number | null; stated: number[] } {
  const candidates: Candidate[] = [];
  const usedAnchors = new Set<number>();
  let total: number | null = null;
  const stated: number[] = [];
  let table: { col: number; cells: number } | null = null;
  // The grade scale being read: it runs until a blank line, the next heading or the next sibling section.
  let grade: { style: string | null; indent: number; rows: number } | null = null;

  const push = (c: Candidate) => {
    if (c.title && c.weight > 0 && !GRADE_TITLE_RE.test(c.title)) candidates.push(c);
  };

  for (const line of lines) {
    if (line.blank) {
      table = null;
      if (grade && grade.rows > 0) grade = null;
      continue;
    }
    if (line.absorbed) continue;
    const text = line.marker ? `${line.marker.label}${logicalBody(line)}` : line.text;
    const t = totalValue(line.text);
    if (t !== null) {
      if (total === null && t > 0 && t <= 1000 && !SUBTOTAL_RE.test(line.text)) total = t;
      continue;
    }
    if (grade && (line.heading > 0 || (grade.style !== null && line.marker?.style === grade.style && line.indent <= grade.indent))) {
      grade = null;
    }
    if (gradeHeading(line)) {
      grade = { style: line.marker?.style ?? null, indent: line.indent, rows: 0 };
      table = null;
      continue;
    }
    if (grade) {
      grade.rows++;
      continue;
    }
    if (isExcluded(text) || inlineGradeScale(line.text)) {
      if (!PENALTY_RE.test(text) && COURSE_WEIGHT_RES.some((re) => re.test(text))) stated.push(...findWeights(text).map((w) => w.value));
      continue;
    }

    const cells = splitCells(line.text);
    if (cells.length >= 2 && cells.some((c) => WEIGHT_HEADER_RE.test(c)) && !cells.some((c) => isNumberCell(c) || findWeights(c).length)) {
      table = GRADE_HEADER_RE.test(line.text) ? null : { col: cells.findIndex((c) => WEIGHT_HEADER_RE.test(c)), cells: cells.length };
      continue;
    }
    if (cells.length < 2) table = null;

    const body = line.marker ? logicalBody(line) : line.text;
    const weights = findWeights(body);

    if (weights.length === 0) {
      // A table whose header says "Weightage (%)": the numbers in that column are the weights.
      if (table && cells.length >= 2) {
        const idx = cells.length === table.cells ? table.col : table.col === table.cells - 1 ? cells.length - 1 : -1;
        const cell = idx >= 0 ? cells[idx] : undefined;
        if (cell && isNumberCell(cell) && !RANGE_TEST_RE.test(line.text)) {
          const title = cleanTitle(cells.filter((c, k) => k !== idx && !isNumberCell(c) && !REF_CELL_RE.test(c)).join(" "));
          push({ line: line.i, title, weight: Number.parseFloat(cell), parents: line.parents });
        }
        continue;
      }
      const bare = BARE_LABEL_RE.exec(line.text);
      if (bare) attachToAnchor(lines, line, Number(bare[1]), usedAnchors, push);
      continue;
    }

    if (weights.length === 1) {
      const w = weights[0]!;
      if (isLabelLine(line.text) && !line.marker) {
        attachToAnchor(lines, line, w.value, usedAnchors, push);
        continue;
      }
      const title = titleAround(body, w) || markerTitle(line, lines);
      if (title) push({ line: line.i, title, weight: w.value, parents: line.parents });
      else if (!line.marker) attachToAnchor(lines, line, w.value, usedAnchors, push);
      continue;
    }

    for (const item of splitInline(body, weights)) push({ line: line.i, title: item.title, weight: item.weight, parents: line.parents });
  }
  return { candidates, total, stated };
}

/** "Part A", "Question 2", "第一部分" can name an item on their own; "1." or "•" can't. */
function markerTitle(line: Line, lines?: Line[]): string {
  const style = line.marker?.style ?? "";
  if (!line.marker || !(style.startsWith("word-") || style.startsWith("cn-"))) return "";
  const name = cleanTitle(line.marker.label);
  // "Question 1 (20 marks)" followed by what the question asks: "Question 1: Explain the 4Ps".
  const next = lines?.slice(line.i + 1).find((l) => !l.blank);
  if (!next || next.marker || next.heading || findWeights(next.text).length || isLabelLine(next.text) || META_LINE_RE.test(next.text)) return name;
  const what = cleanTitle(firstSentence(next.text));
  if (!what) return name;
  return truncate(/[\u3400-\u9FFF]/.test(name) ? `${name}：${what}` : `${name}: ${what}`);
}

/** Title for a line with one weight: the words before it, else the first clause after it. */
function titleAround(body: string, w: Weight): string {
  const before = cleanTitle(body.slice(0, w.start));
  if (before) return before;
  const after = body.slice(w.end).replace(/^[\s)）\]】]*/, "");
  return cleanTitle(firstSentence(after));
}

function attachToAnchor(lines: Line[], label: Line, weight: number, used: Set<number>, push: (c: Candidate) => void) {
  let seen = 0;
  for (let j = label.i - 1; j >= 0 && seen < 4; j--) {
    const prev = lines[j]!;
    if (prev.blank || prev.absorbed) continue;
    seen++;
    if (isLabelLine(prev.text) || META_LINE_RE.test(prev.text)) continue;
    if (findWeights(prev.text).length > 0 || totalValue(prev.text) !== null || used.has(prev.i)) return;
    const title = cleanTitle(prev.marker ? logicalBody(prev) : prev.text) || markerTitle(prev);
    if (!title) return;
    used.add(prev.i);
    push({ line: prev.i, title, weight, parents: prev.parents });
    return;
  }
}

const LEAD_IN_RE =
  /^.*(?:consists?\s+of|compris(?:es|ing)|includ(?:es|ing)|made\s+up\s+of|divided\s+into|split\s+into|as\s+follows|breakdown|assessed\s+(?:on|through|by)|[:：]|包括|包含|分为|分為|分成|组成|組成|如下)\s*/is;
const CONJ_RE = /^(?:\s|[,，、;；:：/+&]|and\b|or\b|plus\b|as\s+well\s+as\b|then\b|finally\b|lastly\b|和|及|以及|与|與|还有|還有|另加|加上|再加|最后|最後|另外)+/i;
const ARTICLE_RE = /^(?:a|an|the)\s+/i;

/** "a proposal (10%), a report (50%) and a presentation (40%)" → three items. */
function splitInline(body: string, weights: Weight[]): { title: string; weight: number }[] {
  // "Report (40%) (40 marks)": the same weight twice with nothing between is one weight.
  const merged: Weight[] = [];
  for (const w of weights) {
    const prev = merged[merged.length - 1];
    if (prev && prev.value === w.value && /^[\s()（）\[\]【】/,，=]*$/.test(body.slice(prev.end, w.start))) {
      prev.end = w.end;
      continue;
    }
    merged.push({ ...w });
  }
  if (merged.length === 1) {
    const title = titleAround(body, merged[0]!);
    return title ? [{ title, weight: merged[0]!.value }] : [];
  }
  const items: { title: string; weight: number }[] = [];
  let cursor = 0;
  for (const [k, w] of merged.entries()) {
    let seg = body.slice(cursor, w.start);
    cursor = w.end;
    const close = /^\s*[)）\]】]/.exec(body.slice(cursor));
    if (close) cursor += close[0].length;
    if (k === 0) seg = seg.replace(LEAD_IN_RE, "");
    seg = seg.replace(/^\s*[)）\]】]/, "").replace(CONJ_RE, "").replace(ARTICLE_RE, "");
    const title = cleanTitle(seg);
    if (!title) return [];
    items.push({ title, weight: w.value });
  }
  return items;
}

const EPS = 1e-6;
const sumOf = (list: Candidate[]) => list.reduce((s, c) => s + c.weight, 0);
const inRange = (s: number) => s >= SCORE_SUM_MIN - EPS && s <= SCORE_SUM_MAX + EPS;

/**
 * Picks the mark sheet out of the weighted items: the set that adds up to the stated total (or 100).
 * Handles a course-weight heading above the sheet ("Group Project (30%)"), the same sheet printed
 * twice (task list + rubric), and a parent row printed with its breakdown.
 */
function solveScores(all: Candidate[], total: number | null, lines: Line[], stated: number[] = []): Scored | null {
  const list = all.slice(0, 200);
  if (list.length < 2) return null;
  const target = total ?? 100;
  // A sheet that adds up exactly to the total the brief states counts whatever that total is ("Total 30 marks").
  const accept = (s: number) => inRange(s) || (total !== null && Math.abs(s - total) < EPS);
  const sum = sumOf(list);
  if (Math.abs(sum - target) < EPS && accept(sum)) return { items: list, exact: true };
  // The same, with the total in a sentence ("This assignment carries 30 marks."). Only the whole sheet
  // counts: a part of it that happens to match could be anything.
  if (total === null && stated.some((v) => Math.abs(sum - v) < EPS)) return { items: list, exact: true };

  const solutions: { items: Candidate[]; start: number; heading?: number }[] = [];
  for (let a = 0; a < list.length; a++) {
    let s = 0;
    for (let b = a; b < list.length; b++) {
      s += list[b]!.weight;
      if (b > a && Math.abs(s - target) < EPS && solutions.length < 500) solutions.push({ items: list.slice(a, b + 1), start: a });
    }
  }
  for (let k = 0; k < list.length; k++) {
    if (Math.abs(sum - list[k]!.weight - target) < EPS) solutions.push({ items: list.filter((_, j) => j !== k), start: k === 0 ? 1 : 0 });
  }
  for (let p = 0; p < list.length; p++) {
    let s = 0;
    for (let q = p + 1; q < Math.min(list.length, p + 25); q++) {
      s += list[q]!.weight;
      if (q >= p + 2 && Math.abs(s - list[p]!.weight) < EPS) {
        const items = list.filter((_, j) => j <= p || j > q);
        if (Math.abs(sumOf(items) - target) < EPS) solutions.push({ items, start: 0 });
      }
    }
  }
  const valid = solutions.filter((x) => x.items.length >= 2 && accept(sumOf(x.items)));
  if (valid.length) {
    // A sheet under "Deliverables" beats one under "Marking rubric"; then the fuller sheet; then the first.
    for (const x of valid) x.heading = Math.sign(headingScore(lines, x.items[0]!.line));
    valid.sort((x, y) => y.heading! - x.heading! || y.items.length - x.items.length || x.start - y.start);
    return { items: valid[0]!.items, exact: true };
  }
  // "Group Project (30%)" above its own breakdown (5% + 15% + 10%): the heading is not a task, and the
  // breakdown counts whatever it adds up to. A first item that only equals the rest by chance stays.
  const rest = list.slice(1);
  if (rest.length >= 2 && Math.abs(list[0]!.weight - sumOf(rest)) < EPS && (headsRest(list[0]!, rest, lines) || inRange(sumOf(rest)))) {
    return { items: rest, exact: true };
  }
  // From here on nothing adds up to the total: the closest in-range run is only a guess.
  if (inRange(sum)) return { items: list, exact: false };

  let best: { items: Candidate[]; diff: number; start: number } | null = null;
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const items = list.slice(a, b + 1);
      const s = sumOf(items);
      if (!inRange(s)) continue;
      const diff = Math.abs(s - target);
      if (!best || diff < best.diff - EPS || (Math.abs(diff - best.diff) < EPS && items.length > best.items.length)) {
        best = { items, diff, start: a };
      }
    }
  }
  return best ? { items: best.items, exact: false } : null;
}

/** Whether a scored line heads the scored lines after it (their parent, or a plain line above a list). */
function headsRest(first: Candidate, rest: Candidate[], lines: Line[]): boolean {
  const head = lines[first.line]!;
  if (rest.every((c) => c.parents.includes(first.line))) return true;
  return head.heading > 0 || (!head.marker && rest.every((c) => lines[c.line]!.marker !== null));
}

function findScoredItems(lines: Line[]): Scored | null {
  const { candidates, total, stated } = collectCandidates(lines);
  if (candidates.length < 2) return null;
  const scoredLines = new Set(candidates.map((c) => c.line));
  // Sub-criteria under a weighted item are part of that item, not separate tasks.
  const topLevel = candidates.filter((c) => !c.parents.some((p) => scoredLines.has(p)));
  return (
    solveScores(topLevel, total, lines, stated) ?? (topLevel.length === candidates.length ? null : solveScores(candidates, total, lines, stated))
  );
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

const ADMIN_RE =
  /\b(?:submit(?:ted|ting)?\s+(?:[\w-]+\s+){0,3}?(?:via|through|online|electronically|in\s+(?:pdf|word|hard|soft))|submissions?\s+(?:via|through|link|portal|platform|folder|box)|soft\s?copy|hard\s?copy|fonts?|spacing|margins?|word\s+(?:count|limit)|cover\s+page|apa|harvard\s+(?:style|referencing)|referencing|citations?|academic\s+(?:integrity|misconduct|honesty)|medical\s+certificate|extensions?|zero\s+marks?|will\s+not\s+be\s+(?:accepted|marked|graded)|form\s+(?:a\s+)?groups?|groups?\s+of\s+\d|\d\s*(?:to|-|–)\s*\d\s+(?:members|students|persons|people)|should\s+have\s+\d|consultation|e-?mail|lecturer|tutor)\b|提交至|提交到|上传至|上传到|上傳至|上傳到|字体|字體|字号|字號|行距|页边距|頁邊距|封面|参考文献|參考文獻|引用格式|不予评分|不予評分|不接受|学术诚信|學術誠信|人一组|人一組|讲师|講師|联系|聯繫|打包/i;
const TASK_CTX_RE =
  /deliverables?|\btasks?\b|requirements?|components?|\bscope\b|activities|work\s+(?:to\s+be\s+done|packages?)|what\s+(?:you|your\s+(?:group|team))\s+(?:need|have)\s+to\s+do|required\s+to|(?:group|team)\s+(?:is|are|will|must|should)|following|to\s+do|needs?\s+to|任务|任務|要求|内容|內容|交付|需要完成|须完成|須完成|需完成|要做|工作|包括|包含|如下|以下/i;
const ADMIN_CTX_RE =
  /instructions?|guidelines?|\bnotes?\b|submission|format(?:ting)?|\brules\b|learning\s+outcomes?|\bclos?\b|objectives?|\baims?\b|rubrics?|marking|grading|assessment\s+criteria|plagiarism|references?|important|reminders?|contact|background|introduction|overview|注意事项|注意事項|须知|須知|提交|格式|规则|規則|学习(?:目标|成果)|學習(?:目標|成果)|课程目标|課程目標|目标|目標|评分|評分|参考|參考|背景|简介|簡介|介绍|介紹|联系|聯繫/i;
const TASK_VERB_RE =
  /^(?:to\s+)?(?:conduct|carry\s+out|perform|develop|design|build|create|make|write|draft|prepare|produce|compile|record|film|shoot|edit|present|deliver|analy[sz]e|evaluate|assess|compare|investigate|identify|propose|plan|organi[sz]e|hold|attend|collect|gather|interview|survey|research|review|implement|code|program|test|deploy|document|draw|sketch|model|construct|set\s+up|install|configure|integrate|launch|run|visit|observe|summari[sz]e|translate|keep|maintain|submit|study|explore|examine|discuss|describe|explain|justify|recommend|calculate|estimate|simulate|apply)\b|^(?:进行|進行|开展|開展|完成|制作|製作|撰写|撰寫|编写|編寫|写|寫|做|设计|設計|开发|開發|搭建|建立|实现|實現|测试|測試|收集|整理|分析|调查|調查|访谈|訪談|采访|採訪|拍摄|拍攝|剪辑|剪輯|录制|錄製|准备|準備|组织|組織|召开|召開|举办|舉辦|参加|參加|绘制|繪製|画|畫|比较|比較|评估|評估|提出|规划|規劃|策划|策劃|翻译|翻譯|总结|總結|汇报|匯報|展示|演示|上台|提交|记录|記錄|访问|訪問|观察|觀察|研究|讨论|討論|介绍|介紹|说明|說明)/i;

type Block = { items: Line[]; parent: number; style: string; depth: number; ctxStart: number };
/** The chosen list: its titles, the item lines they came from, and how task-like it reads (> 0 = work to do). */
type Listed = { titles: string[]; items: Line[]; score: number; depth: number };

function hasKindKeyword(title: string): boolean {
  if (KIND_ZH.some(([, words]) => words.some((w) => title.includes(w)))) return true;
  return KIND_EN_RE.some(([, re]) => {
    re.lastIndex = 0;
    const hit = re.test(title);
    re.lastIndex = 0;
    return hit;
  });
}

function isSectionLike(title: string): boolean {
  if (TASK_VERB_RE.test(title)) return false;
  if (SECTION_EN.test(title) || (title.length <= 14 && SECTION_ZH_TAIL.test(title))) return true;
  const letters = title.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && title === title.toUpperCase() && title.length <= 40;
}

function itemTitle(line: Line): string {
  return cleanTitle(firstSentence(logicalBody(line)));
}

function isAdminItem(line: Line): boolean {
  const t = logicalBody(line);
  return PENALTY_RE.test(t) || ADMIN_RE.test(t) || totalValue(line.text) !== null;
}

/**
 * How much the lines just above a list (or a mark sheet) announce work to do (+) or rules and
 * rubrics (−). Items of another list are not headings; the enclosing item is.
 */
function headingScore(lines: Line[], first: number, parent = -1): number {
  let score = 0;
  let weight = 1;
  let seen = 0;
  const ctx: string[] = [];
  let sawParent = false;
  for (let j = first - 1; j >= 0 && seen < 3; j--) {
    const l = lines[j]!;
    if (l.blank || l.absorbed) continue;
    if (l.marker && l.i !== parent) break;
    seen++;
    ctx.push(l.marker ? logicalBody(l) : l.text);
    if (l.i === parent) {
      sawParent = true;
      break;
    }
  }
  if (parent >= 0 && !sawParent) ctx.push(logicalBody(lines[parent]!));
  for (const t of ctx) {
    const task = TASK_CTX_RE.test(t);
    const admin = ADMIN_CTX_RE.test(t);
    if (task && !admin) score += 3 * weight;
    else if (admin && !task) score -= 3 * weight;
    weight *= 0.5;
  }
  return score;
}

function findListItems(lines: Line[]): Listed | null {
  const blocks: Block[] = [];
  const open = new Map<string, Block>();
  for (const line of lines) {
    if (line.blank || line.absorbed) continue;
    if (!line.marker) {
      if (line.heading) {
        const depth = line.parents.length;
        for (const [key, b] of open) if (b.depth >= depth) open.delete(key);
      }
      continue;
    }
    const parent = line.parents[line.parents.length - 1] ?? -1;
    const key = `${parent}|${line.marker.style}`;
    let block = open.get(key);
    const last = block?.items[block.items.length - 1];
    const restart = block && line.marker.ordinal === 1 && (last?.marker?.ordinal ?? 0) >= 1;
    if (!block || restart) {
      block = { items: [], parent, style: line.marker.style, depth: line.parents.length, ctxStart: line.i };
      blocks.push(block);
      open.set(key, block);
    }
    block.items.push(line);
  }

  let best: Listed | null = null;
  for (const block of blocks) {
    const tasks = block.items.filter((l) => !isAdminItem(l));
    const titles = tasks.map(itemTitle).filter((t) => t !== "");
    if (titles.length < 2) continue;
    const n = titles.length;
    const taskLike = titles.filter((t) => TASK_VERB_RE.test(t) || hasKindKeyword(t)).length;
    const sectionLike = titles.filter(isSectionLike).length;
    const adminShare = (block.items.length - tasks.length) / block.items.length;
    const score = headingScore(lines, block.ctxStart, block.parent) + (4 * taskLike) / n - (4 * sectionLike) / n - 3 * adminShare - 0.5 * block.depth;
    const better =
      !best ||
      score > best.score + EPS ||
      (Math.abs(score - best.score) < EPS && (titles.length > best.titles.length || (titles.length === best.titles.length && block.depth < best.depth)));
    if (better) best = { titles, items: tasks, score, depth: block.depth };
  }
  return best ? { ...best, titles: best.titles.slice(0, MAX_LIST_TASKS) } : null;
}

/**
 * Whether a task list elsewhere in the brief should win over the scored lines. Stray "label N%" lines
 * (survey results, a budget, a schedule, rubric criteria) must not replace a real list: the list wins
 * when it reads like work to do, is not the scored lines themselves, and the scores either don't add
 * up to the total or name no work at all.
 */
function listBeatsScores(listed: Listed, scored: Scored): boolean {
  if (listed.score <= 0) return false;
  const listLines = new Set(listed.items.map((l) => l.i));
  const scoredLines = new Set(scored.items.map((c) => c.line));
  const overlaps =
    scored.items.some((c) => listLines.has(c.line) || c.parents.some((p) => listLines.has(p))) ||
    listed.items.some((l) => l.parents.some((p) => scoredLines.has(p)));
  if (overlaps) return false;
  // The same items printed twice ("Deliverables: - Report - Poster" and later "Report 60 marks"): keep the weights.
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const named = scored.items.filter((c) => {
    const a = norm(c.title);
    return [...a].length >= 2 && listed.titles.some((t) => norm(t).includes(a) || a.includes(norm(t)));
  }).length;
  if (named * 2 >= scored.items.length) return false;
  return !scored.exact || !scored.items.some((c) => TASK_VERB_RE.test(c.title) || hasKindKeyword(c.title));
}
