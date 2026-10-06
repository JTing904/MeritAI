// What the server asks the model (M6 spec §4–§6): the output schemas and the prompts. Untrusted text (the
// brief, evidence, and the 怎么做 / checklist people wrote) always goes in fenced blocks (fence.ts).
import { z } from "zod";
import type { Locale } from "../../../../shared/constants";
import type { Grade } from "../../generated/prisma/client";
import { fence, UNTRUSTED_RULE } from "./fence";
import type { AiPart } from "./types";

export const AI_TASK_KINDS = ["CODE", "DOC", "RESEARCH", "DESIGN", "MEETING"] as const;
const LEVELS = ["LOW", "MID", "HIGH"] as const;

// A factory, not a shared instance: a reused zod object becomes a $ref in the JSON schema, which Gemini's
// responseSchema can't follow.
const taskOut = () =>
  z.object({
    title: z.string(),
    kind: z.enum(AI_TASK_KINDS),
    /** Relative weight (any scale); the server turns it into tenths. */
    points: z.number(),
    estimateHours: z.number(),
    /** "YYYY-MM-DD" within the project, or null. */
    suggestedDue: z.string().nullable(),
    milestone: z.string().nullable(),
    feature: z.string().nullable(),
    /** The brief's graded part (component / rubric item) the task counts towards, as the brief names it. */
    part: z.string().nullable(),
    /** Line numbers of the brief text (as numbered in the prompt), inclusive. */
    briefFrom: z.number().nullable(),
    briefTo: z.number().nullable(),
    quote: z.string().nullable(),
    howto: z.array(z.string()),
    checklist: z.array(z.string()),
    prereqTitle: z.string().nullable(),
  });

export const BriefOutSchema = z.object({
  tasks: z.array(taskOut()),
  questions: z.array(
    z.object({
      prompt: z.string(),
      quote: z.string().nullable(),
      type: z.enum(["PICK_N", "METHOD"]),
      pickCount: z.number(),
      options: z.array(
        z.object({
          label: z.string(),
          summary: z.string(),
          hours: z.number(),
          material: z.enum(LEVELS),
          difficulty: z.enum(LEVELS),
          pros: z.array(z.string()),
          cons: z.array(z.string()),
          recommended: z.boolean(),
          tasks: z.array(taskOut()),
        }),
      ),
    }),
  ),
  meetingFirst: z.object({ title: z.string(), why: z.string() }).nullable(),
});
export type BriefOut = z.infer<typeof BriefOutSchema>;
export type BriefTaskOut = BriefOut["tasks"][number];

export const HowtoOutSchema = z.object({ howto: z.array(z.string()), checklist: z.array(z.string()) });
export type HowtoOut = z.infer<typeof HowtoOutSchema>;

export const GradeOutSchema = z.object({
  score: z.number(),
  reasons: z.array(z.string()),
  suggestions: z.array(z.string()),
  summary: z.string(),
});
export type GradeOut = z.infer<typeof GradeOutSchema>;

/** REQUIREMENTS §5: ≥ 85 优秀, 60–84 合格, 40–59 拿一半, < 40 不通过. The number itself is never stored or shown. */
export function gradeForScore(score: number): Exclude<Grade, "SELF"> {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 85) return "EXCELLENT";
  if (s >= 60) return "PASS";
  if (s >= 40) return "HALF";
  return "FAIL";
}

const LANGUAGE: Record<Locale, string> = { zh: "简体中文", en: "English" };

// ─── Brief analysis ──────────────────────────────────────────────────────────

export type BriefContext = {
  locale: Locale;
  today: string;
  deadline: string;
  timezone: string;
  teamSize: number;
  packageCount: number;
  projectName: string;
};

/**
 * The brief prompt. Written for the light model as much as the good ones (the good chain falls back to
 * it when busy or out of quota): an order to read in, the rules, and one short example of the shape.
 */
export function briefSystem(ctx: BriefContext, nonce: string): string {
  const n = ctx.packageCount;
  if (ctx.locale === "zh") {
    return [
      "你帮学生小组把作业要求拆成任务。只输出要求的 JSON。",
      UNTRUSTED_RULE.zh(nonce),
      `语言：title、howto、checklist、选择题的 prompt 和选项（label、summary、pros、cons）、feature、milestone 全部用${LANGUAGE.zh}写，作业原文是英文也一样；专有名词和术语可以在中文后面的括号里留英文原文，例如「监督式机器学习（Machine Learning (Supervised)）」。称呼人时不要用「他 / 她」。`,
      "先按这个顺序看懂作业，再输出：",
      "1. 评分部分和比例（例如「Documentation 40%、Prototype 60%」、评分表的每一项）、每个要交的东西、要填的表格或声明、演示 / 答辩、截止日期。",
      "2. 选择题（「从下面几个题目选一个」「任选 N 个」），以及哪些事只有选了某个选项才要做。",
      "3. 把每个评分部分按评分项或章节拆成任务，再分 points。",
      "规则：",
      "- 每个任务只有一个人负责，写成具体能交的东西（报告的某一节、某个功能、某份调查）。开会、沟通也是任务（kind = MEETING）。",
      `- 拆得够细：一般每个任务 2–10 小时，全部任务（外面的 tasks 加上推荐的选项）大约 ${n * 3}–${n * 6} 个，好让每个任务包都有好几件事。评分表有几项就至少拆成几项（例如报告的引言、相关研究、方法、结果讨论、结论和参考文献各一个任务）。`,
      "- 不要漏：作业里每个要交的东西、每个评分项、要填的表格或声明（例如抄袭声明、AI 使用声明）、演示 / 答辩 / 上台讲，都要有任务；任务名要看得出对应哪个评分项（例如「演示与现场编程答辩」）。",
      "- part：这个任务算在作业哪一个评分部分，照原文的名字写；给了「评分部分」清单时，只能从清单里挑一个名字原样照抄。表格、声明这类不单独算分的写 null。",
      "- points：整份作业算 100 分，写每个任务值几分；外面的 tasks 加上任何一个选项的 tasks 合起来是 100（每个选项的 tasks 都按「选了它」来算，不要写 0）。作业写了分数或比例时，每个评分部分和评分表的每一项，任务 points 加起来都要符合那个比例，再在里面按工作量分。estimateHours 是大概要几小时。",
      `- 只有作业原文明确要求「每个组员各做一份 / 各用不同的方法」时（例如 Each member must provide a solution）：为这件事建刚好 ${n} 份任务，title 写「个人方案 1：…」「个人方案 2：…」，points 一样，feature 各自不同（「个人方案 1」「个人方案 2」…），让每个包各分到一份；不要替组员选定具体方法：作业只是举例（e.g. / 例如）时，title 只写「个人方案 1：选一种分类方法实现并评估」这类通用说法，把作业举的例子写进 howto 当参考（「例如 ANN、SVM、KNN，也可以用别的」），并在 checklist 写「和组员用的方法不一样」；只有作业明确规定要用哪几种方法时，title 才写那种方法。比较各人结果另建一个任务。这件事写在选项里时，每个选项都要有这 ${n} 份。作业没这样要求时，不要用「个人方案」这种写法，按功能或章节命名。`,
      `- 作业原文要求每个人亲自做、别人不能代做的事（例如 Each student is required to fill up the Plagiarism Statement Form、EACH team member is required to present their own work … Q&A、「每位同学都要签名」「每个组员都要上台讲自己的部分」）：签名的声明表、演示 / 讲解 / 答辩 / 问答、互评、个人反思或日志、个人贡献说明，要建刚好 ${n} 份任务，title 后面加「（第 1 份）」…「（第 ${n} 份）」（例如「签署抄袭声明表（第 1 份）」「演示与答问：讲解自己的部分（第 1 份）」），points 一样，feature 各自不同（有个人方案时用同编号的「个人方案 1」…，否则「组员 1」…），每份各交自己的证据，checklist 按一个人写。整组只交一份的东西（报告、每次提交附一份的 AI 使用声明、源代码、组长汇总提交）只建一个任务。`,
      `- 评分部分标明是个人的（例如「Idea Generation 20 marks (Individual)」「Executive Summary (Individual)」「个人作业」），每个组员各交自己的一份：这一部分建刚好 ${n} 份任务（「个人商业点子（第 1 份）」…），一份里写齐这个人要做的全部步骤，不要再拆成好几个任务；要整组一起做的事（例如从各人的点子里选一个、合并各人的部分、共用的幻灯片）另建一个任务。混合的部分（例如「10% 个人 + 40% 小组」）只有标明个人的那一块按人分。`,
      "- 整组要从各人的成果里选一个（例如从每人的点子里选出最好的一个）时，建一个 MEETING 任务，prereqTitle 写个人那份的第 1 份，不要写成 meetingFirst。这不是选择题：选择题的选项一定是作业原文列出来的，不要自己编选项。",
      "- 任务名用作业自己的叫法：作业叫 pitching 就写「路演」，叫 viva 就写「答辩」；下面例子里的任务名只示范格式，不要照抄。",
      "- 作业对用 AI 有规定时（例如红色 = 不准用、黄色 = 有限使用、绿色 = 可以用），在相关任务 howto 第一步提醒「动手前先确认这一项准不准用 AI」；不要写这一项是什么颜色或级别（原文常常看不出来）。",
      `- suggestedDue 用 YYYY-MM-DD，在今天（${ctx.today}）之后、项目截止（${ctx.deadline}）之前，按里程碑排；前置任务要排在等它的任务前面。`,
      "- feature：把同一个功能的代码、报告那一段、测试放同一个 feature 名字，方便分给同一个人；没有功能分组就写 null。",
      "- briefFrom / briefTo：这个任务在作业原文里的行号（原文每行前面有行号）；看的是文件图片就写 null，改用 quote 摘一句原文。",
      "- howto：2–5 步具体怎么做；checklist：2–6 条「做到这些才算完成」，要能一眼判断有没有做到。",
      "- prereqTitle：只有这个任务真的要用到另一个任务的成果才能开始时才填（写那个任务的 title，例如「结果与讨论」要等实现做完），否则 null。报告各节、各人的方案可以同时做，不要串成一条长链。",
      "- 选择题：作业里「任选几个」写成 PICK_N（pickCount = 要选几个），「整组从几个题目 / 方向 / 做法里选一个」写成 METHOD（pickCount = 1）。作业列了几个选项就列几个，每个写工作量（hours）、资料多少（material）、难度（difficulty），METHOD 还要写 pros 和 cons。",
      "  recommended 只看工作量、资料多少、难度（不看组员擅长什么），推荐刚好 pickCount 个。每个选项的 tasks 是选了它之后要做的任务；这些任务不要再放进外面的 tasks。",
      "- 选项的 tasks 只放选了这个选项才有的事（例如这个方向的数据收集、算法实现）；不管选哪个都要做的事（报告各节、演示、表格）放外面的 tasks。",
      "- 只有当不同的人各写一部分代码、而且要把这些部分串接成同一个系统时（例如登录模块和聊天模块要互相调用），才填 meetingFirst（例如「一起定好接口和数据格式」），并在 why 里建议先用假数据各做各的；每人各做一个独立方案、或只有一个人写代码时，写 null。",
      `例子（只示范拆法，不是这份作业）：作业写「报告 40%（引言、方法、结果）；原型 60%；从聊天机器人、推荐系统中选一个；每个组员用自选的算法（例如 SVM、KNN）各做一个方案；第 12 周每个组员都要讲自己的部分并答辩；每位同学签一份抄袭声明；每次提交附一份 AI 使用声明」，${n} 个任务包 →`,
      `  tasks：「报告：引言」「报告：方法」「报告：结果与讨论」（part 报告）、「演示与答问：讲解自己的部分（第 1 份）」…「（第 ${n} 份）」（part 原型）、「签署抄袭声明表（第 1 份）」…「（第 ${n} 份）」（part null）、「写 AI 使用声明」（只一份，part null）……；`,
      `  questions：一道 METHOD，两个选项，每个选项的 tasks：「收集并整理数据」「个人方案 1：选一种算法实现并评估」…「个人方案 ${n}：选一种算法实现并评估」（howto 写「例如 SVM、KNN，也可以用别的」）「比较各方案的结果」（part 原型）；meetingFirst = null。`,
      `项目：${ctx.projectName}；小组 ${ctx.teamSize} 人，分成 ${n} 个任务包；时区 ${ctx.timezone}。`,
    ].join("\n");
  }
  return [
    "You help a student group turn an assignment brief into tasks. Output only the requested JSON.",
    UNTRUSTED_RULE.en(nonce),
    `Language: titles, steps, checklists, question prompts and options (label, summary, pros, cons), feature and milestone names are all in ${LANGUAGE.en}, even when the brief is in another language. Never use gendered pronouns for people.`,
    "Read the brief in this order before answering:",
    "1. The graded parts and their weights (e.g. 'Documentation 40%, Prototype 60%', every rubric item), every deliverable, every form or declaration, every demo / Q&A, the deadlines.",
    "2. Choice questions ('choose one of these titles', 'pick N of'), and which work exists only when a given option is picked.",
    "3. Split every graded part into tasks by rubric item or section, then give points.",
    "Rules:",
    "- Each task has one owner and is something concrete to hand in (a report section, a feature, a survey). Meetings and coordination are tasks too (kind = MEETING).",
    `- Split finely enough: usually 2–10 hours per task, about ${n * 3}–${n * 6} tasks in total (top-level tasks plus the recommended options'), so every work package gets several. At least one task per rubric item (e.g. the report's introduction, related work, methodology, results and discussion, conclusion and references each as a task).`,
    "- Leave nothing out: every deliverable, every graded criterion, every form or declaration to fill in (e.g. plagiarism statement, AI disclosure), and every demo / presentation / Q&A gets a task, titled so the rubric item it serves is recognisable (e.g. 'Presentation and on-the-spot coding').",
    "- part: the brief's graded part the task counts towards, named as the brief names it; when a list of graded parts is given, copy exactly one name from it. Forms and declarations that carry no marks of their own: null.",
    "- points: the whole assignment is worth 100; give each task its share. The top-level tasks plus any one option's tasks add up to 100 (score every option's tasks as if it were picked; never 0). When the brief gives marks or weights, the tasks of each graded part and of each rubric item add up to its weight, split inside by workload. estimateHours is a rough number of hours.",
    `- Only when the brief explicitly says each member must produce their own piece / use a different method (e.g. 'Each member must provide a solution'): create exactly ${n} tasks for it titled 'Individual solution 1: …', 'Individual solution 2: …', with the same points and each its own feature ('Individual solution 1', 'Individual solution 2', …) so every package gets one; never pick the method for the members: when the brief only gives examples (e.g. …), the title stays generic ('Individual solution 1: implement and evaluate a classification method of your choice'), the brief's examples go into howto as suggestions ('e.g. ANN, SVM, KNN, or another'), and the checklist says 'a different method from the other members'; only when the brief prescribes the methods does a title name one. Comparing the results is a separate task. When this work sits inside the options, every option gets these ${n} tasks. Otherwise never title tasks 'Individual solution'; name them by feature or section.`,
    `- Work the brief says every student / each member must do personally, which nobody can do for someone else (e.g. 'Each student is required to fill up the Plagiarism Statement Form', 'EACH team member is required to present their own work … Q&A'): a signed declaration form, the presentation / demo / viva / Q&A, peer evaluation, an individual reflection or log, an individual contribution statement. Create exactly ${n} tasks for each such item, titled with '(member 1)' … '(member ${n})' (e.g. 'Sign the plagiarism statement form (member 1)', 'Presentation and Q&A: present your own part (member 1)'), with the same points and each its own feature (the matching 'Individual solution n' when there are individual solutions, else 'Member n'), each handing in its own evidence, the checklist written for one person. Things handed in once per group (the report, one AI disclosure per submission, the source code, what the team leader compiles and submits) stay one task.`,
    `- A graded component the brief marks individual (e.g. 'Idea Generation 20 marks (Individual)', 'Executive Summary (Individual)'): every member hands in their own, so create exactly ${n} tasks for it ('Business idea (member 1)' …), each holding all the steps that person does; don't split it further. Work the group does together (picking one of the members' ideas, merging the individual parts, a shared slide deck) is a separate task. In a mixed part ('10% individual + 40% group') only the individual piece is per member.`,
    "- When the group picks one of the members' individual results (e.g. the best of everyone's ideas), that is a MEETING task whose prereqTitle is the first individual copy, not meetingFirst. It is not a choice question: a question's options are always ones the brief itself lists; never invent options.",
    "- Name tasks the way the brief does (a 'pitch' stays a pitch, a 'viva' a viva); the task names in the example below only show the format, don't copy them.",
    "- When the brief has rules on AI use (e.g. red = no AI, yellow = limited, green = allowed), the first howto step of the tasks concerned reminds the student to check whether that item allows AI before starting; never state an item's colour or level (the text often doesn't show it).",
    `- suggestedDue is YYYY-MM-DD, after today (${ctx.today}) and before the project deadline (${ctx.deadline}), following the milestones; a prerequisite is due before the task that waits for it.`,
    "- feature: give the code, report section and tests of one feature the same feature name so one person can take them; null when there are no features.",
    "- briefFrom / briefTo: the task's line numbers in the brief text (each line is numbered); null when you read the brief from a file image, then quote one sentence instead.",
    "- howto: 2–5 concrete steps; checklist: 2–6 checkable points that define done.",
    "- prereqTitle: only when the task really needs another task's output before it can start (e.g. results and discussion waits for the implementation), the title of that task; else null. Report sections and each member's solution can run in parallel: don't chain everything.",
    "- Choice questions: 'choose N of these' is PICK_N (pickCount = how many), 'the group picks one title / topic / method' is METHOD (pickCount = 1). List every option the brief lists, each with hours, material (how much reference material exists), difficulty, and for METHOD also pros and cons.",
    "  recommended looks only at workload, material and difficulty (never at who is in the group); recommend exactly pickCount options. Each option's tasks are the tasks it adds when picked; don't repeat them in the top-level tasks.",
    "- An option's tasks hold only the work that exists because that option was picked (e.g. that topic's data gathering and implementation); work needed whatever is picked (report sections, demo, forms) goes in the top-level tasks.",
    "- Fill meetingFirst (e.g. 'Agree on the interfaces and data formats', suggesting in why that everyone starts with fake data) only when different people write parts of the code that must be joined into one system (e.g. a login module the chat module calls); null when each member builds an independent solution or only one person codes.",
    `Example (the shape only, not this brief): 'Report 40% (introduction, method, results); prototype 60%; choose a chatbot or a recommender; each member builds a solution with a preferred algorithm (e.g. SVM, KNN); in week 12 each member presents their own part and answers questions; every student signs a plagiarism statement; one AI disclosure with each submission', ${n} packages →`,
    `  tasks: 'Report: introduction', 'Report: method', 'Report: results and discussion' (part Report), 'Presentation and Q&A: present your own part (member 1)' … '(member ${n})' (part Prototype), 'Sign the plagiarism statement form (member 1)' … '(member ${n})' (part null), 'Write the AI disclosure statement' (just one, part null), …;`,
    `  questions: one METHOD with two options, each option's tasks: 'Collect and prepare the data', 'Individual solution 1: implement and evaluate an algorithm of your choice' … 'Individual solution ${n}: …' (howto: 'e.g. SVM, KNN, or another'), 'Compare the solutions' results' (part Prototype); meetingFirst = null.`,
    `Project: ${ctx.projectName}; ${ctx.teamSize} people, ${n} work packages; time zone ${ctx.timezone}.`,
  ].join("\n");
}

/** The brief as numbered lines (1-based, as briefFrom / briefTo expect). */
export function numberedBrief(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${i + 1}| ${line}`)
    .join("\n");
}

export type BriefPartsOptions = {
  /** The graded parts the rules found in the brief (brief-check.ts gradedParts): the names `part` copies. */
  gradedParts?: { name: string; weight: number }[] | null;
  /** The second try after an answer with too few tasks. */
  retry?: { have: number; want: number } | null;
  /**
   * 让 AI 重新拆 a running project: the tasks someone already started, handed in or finished. They stay as
   * they are; the model splits only the rest. `points` in tenths (their share of 100 is already taken).
   */
  keep?: { title: string; points: number }[] | null;
};

export function briefParts(
  brief: { text: string | null; file: { bytes: Uint8Array; mimeType: string; name: string } | null },
  locale: Locale,
  nonce: string,
  opts: BriefPartsOptions = {},
): AiPart[] {
  const zh = locale === "zh";
  const parts: AiPart[] = [];
  if (brief.file) {
    parts.push({ text: zh ? `作业要求在这个文件里（${brief.file.name}）：` : `The brief is in this file (${brief.file.name}):` });
    parts.push({ mimeType: brief.file.mimeType, bytes: brief.file.bytes, name: brief.file.name });
  }
  if (brief.text) parts.push({ text: fence("BRIEF", numberedBrief(brief.text), nonce) });
  if (opts.gradedParts?.length) {
    const list = fence("GRADED PARTS", opts.gradedParts.map((p) => `${p.name} = ${p.weight}`).join("\n"), nonce);
    parts.push({
      text: zh
        ? `从作业里找到的评分部分（名字 = 分数或比例）：\n${list}\n每个任务的 part 从这里挑一个名字原样照抄；每一部分的任务 points 加起来要符合它的比例。`
        : `Graded parts found in the brief (name = marks or weight):\n${list}\nCopy one of these names exactly into each task's part; each part's task points add up to its weight.`,
    });
  }
  if (opts.keep?.length) {
    const taken = opts.keep.reduce((s, t) => s + t.points, 0) / 10;
    const share = Math.round(taken * 10) / 10;
    const list = fence("KEPT TASKS", opts.keep.map((t) => `${t.title} = ${Math.round(t.points) / 10}`).join("\n"), nonce);
    parts.push({
      text: zh
        ? `项目已经在进行。下面这些任务已经有人在做、交了或做完了（任务名 = 分数），保持不变：\n${list}\n只拆剩下还没做的部分，不要再输出这些任务，也不要换个名字重复它们；它们已经占了 100 分里的 ${share} 分，你拆的任务分剩下的 ${Math.round((100 - share) * 10) / 10} 分。每人一份的任务（「（第 n 份）」「个人方案 n」）只补上面没有的那几份。`
        : `The project is already running. These tasks are already being done, handed in or finished (title = points) and stay as they are:\n${list}\nSplit only the rest of the work: don't output these tasks again, not even renamed. They already take ${share} of the 100 points; your tasks share the remaining ${Math.round((100 - share) * 10) / 10}. Of the per-member copies ('(member n)', 'Individual solution n') add only the ones missing above.`,
    });
  }
  if (opts.retry) {
    parts.push({
      text: zh
        ? `你上一次只拆出 ${opts.retry.have} 个任务（算上推荐的选项），太粗了。这次至少拆成 ${opts.retry.want} 个：按评分项、报告章节、功能拆开，每个 2–10 小时，别的规则不变。`
        : `Your last answer had only ${opts.retry.have} tasks (counting the recommended options): too coarse. Split into at least ${opts.retry.want} this time, by rubric item, report section and feature, 2–10 hours each; every other rule stays.`,
    });
  }
  parts.push({ text: zh ? "把上面的作业要求拆成任务，并找出选择题。" : "Turn the brief above into tasks and find any choice questions." });
  return parts;
}

// ─── Language repair (one light call after the brief analysis) ───────────────

export const BriefFixOutSchema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
export type BriefFixOut = z.infer<typeof BriefFixOutSchema>;

export function briefFixSystem(locale: Locale, nonce: string): string {
  return locale === "zh"
    ? [
        "你把一份任务计划里的文字翻译成简体中文。只输出要求的 JSON。",
        UNTRUSTED_RULE.zh(nonce),
        "每一条都翻成通顺、简短的简体中文，意思不变，不加内容，不要用「他 / 她」。产品名、工具、算法和技术名词（例如 Python、SVM、K-means、Dialogflow、Carousell）保留英文；网址、文件名、代码照抄。",
        "作业里的专门说法（表格、评分项、平台的名字，例如 free-rider form、Turnitin、APA、pitching）用常用的中文说法，没有通用中文就保留英文，不要逐字直译：free-rider 是「搭便车」，不是「自由骑士」。",
        "只有选项名称（id 以 .label 结尾）在中文后面的括号里留英文原文，例如「Machine Learning (Supervised)」→「监督式机器学习（Machine Learning (Supervised)）」；其他各条直接写中文，不要附英文原文。",
        "id 原样照抄，每一条都要回。",
      ].join("\n")
    : [
        "You translate the strings of a task plan into English. Output only the requested JSON.",
        UNTRUSTED_RULE.en(nonce),
        "Translate each string into short, natural English with the same meaning; add nothing and never use gendered pronouns. Keep product, tool and algorithm names as they are; URLs, file names and code stay unchanged.",
        "Copy every id exactly and answer every item.",
      ].join("\n");
}

export function briefFixParts(items: { id: string; text: string }[], locale: Locale, nonce: string): AiPart[] {
  return [
    { text: fence("STRINGS", JSON.stringify(items), nonce) },
    { text: locale === "zh" ? "把上面每一条翻成简体中文，按 { items: [{ id, text }] } 输出。" : "Translate every item above into English as { items: [{ id, text }] }." },
  ];
}

// ─── 怎么做 for a task added later ───────────────────────────────────────────

export type TaskContext = { title: string; kind: string; points: number; description: string | null; briefExcerpt: string | null };

export function howtoSystem(locale: Locale, nonce: string): string {
  return locale === "zh"
    ? ["你帮学生写一个任务的「怎么做」和「做到这些才算完成」。只输出要求的 JSON。", UNTRUSTED_RULE.zh(nonce), `用${LANGUAGE.zh}写，不要用「他 / 她」。howto 2–5 步，checklist 2–6 条，每条一句话、具体、能判断。`].join("\n")
    : ["You write the steps and the definition of done for one student task. Output only the requested JSON.", UNTRUSTED_RULE.en(nonce), `Write in ${LANGUAGE.en}, no gendered pronouns. howto: 2–5 steps; checklist: 2–6 items; one concrete, checkable sentence each.`].join("\n");
}

export function taskParts(task: TaskContext, nonce: string): AiPart[] {
  const lines = [`TITLE: ${task.title}`, `KIND: ${task.kind}`, `POINTS: ${(task.points / 10).toFixed(1)} / 100`];
  if (task.description) lines.push(`DESCRIPTION: ${task.description}`);
  const parts: AiPart[] = [{ text: fence("TASK", lines.join("\n"), nonce) }];
  if (task.briefExcerpt) parts.push({ text: fence("BRIEF EXCERPT", task.briefExcerpt, nonce) });
  return parts;
}

// ─── Grading ─────────────────────────────────────────────────────────────────

export function gradeSystem(locale: Locale, nonce: string): string {
  if (locale === "zh") {
    return [
      "你是公正的助教，按作业要求审核学生交的一个任务。只输出要求的 JSON。",
      UNTRUSTED_RULE.zh(nonce),
      "score 是 0–100：≥ 85 很好，60–84 合格，40–59 只做到一半，< 40 不合格。对照作业要求、「怎么做」和「做到这些才算完成」清单来看。",
      "score < 60 时写 2–4 条 reasons（对照作业要求，哪里没做到、少了什么），并写至少 1 条 suggestions（怎么改才能拿满，要具体）；score ≥ 60 时 reasons 和 suggestions 可以是空的或写 1–2 条。",
      `summary 是一两句总评。全部用${LANGUAGE.zh}写，称呼交作业的人用「你」，不要用「他 / 她」。`,
      "只有链接、没有打开的内容时，不要猜链接里有什么。",
    ].join("\n");
  }
  return [
    "You are a fair teaching assistant reviewing one task a student handed in, against the assignment brief. Output only the requested JSON.",
    UNTRUSTED_RULE.en(nonce),
    "score is 0–100: ≥ 85 excellent, 60–84 pass, 40–59 only half done, < 40 fail. Judge against the brief, the steps and the definition-of-done checklist.",
    "When score < 60 give 2–4 reasons (what the brief asks that is missing or wrong) and at least 1 concrete suggestion for getting full marks; when score ≥ 60 reasons and suggestions may be empty or 1–2 items.",
    `summary is one or two sentences. Write everything in ${LANGUAGE.en}, address the student as "you", never use gendered pronouns.`,
    "For links you were given as text only, don't guess what they contain.",
  ].join("\n");
}

/** One piece of evidence as the model gets it. */
export type EvidencePiece =
  | { kind: "file"; name: string; mimeType: string; bytes: Uint8Array }
  | { kind: "text"; name: string; text: string; note?: string }
  | { kind: "link"; url: string }
  | { kind: "unreadable"; name: string };

export function gradeParts(
  task: TaskContext & { howto: string[]; checklist: string[] },
  evidence: EvidencePiece[],
  locale: Locale,
  nonce: string,
): AiPart[] {
  const zh = locale === "zh";
  const parts = taskParts(task, nonce);
  if (task.howto.length) parts.push({ text: fence("HOWTO", task.howto.map((s, i) => `${i + 1}. ${s}`).join("\n"), nonce) });
  if (task.checklist.length) parts.push({ text: fence("CHECKLIST", task.checklist.map((s) => `- ${s}`).join("\n"), nonce) });
  parts.push({ text: zh ? `交上来的证据（${evidence.length} 份）：` : `The evidence handed in (${evidence.length} items):` });
  evidence.forEach((e, i) => {
    const n = i + 1;
    if (e.kind === "file") {
      parts.push({ text: zh ? `证据 ${n}：文件「${e.name}」` : `Evidence ${n}: file "${e.name}"` });
      parts.push({ mimeType: e.mimeType, bytes: e.bytes, name: e.name });
    } else if (e.kind === "text") {
      const head = zh ? `证据 ${n}：文件「${e.name}」读出来的文字${e.note ? `（${e.note}）` : ""}` : `Evidence ${n}: text read from the file "${e.name}"${e.note ? ` (${e.note})` : ""}`;
      parts.push({ text: `${head}\n${fence(`EVIDENCE ${n}`, e.text, nonce)}` });
    } else if (e.kind === "link") {
      const head = zh ? `证据 ${n}：一个链接（服务器不会打开链接，你只能看到网址）` : `Evidence ${n}: a link (the server never opens links; you only see the address)`;
      parts.push({ text: `${head}\n${fence(`LINK ${n}`, e.url, nonce)}` });
    } else {
      parts.push({ text: zh ? `证据 ${n}：文件「${e.name}」读不出来（格式不支持）。` : `Evidence ${n}: the file "${e.name}" could not be read (unsupported format).` });
    }
  });
  parts.push({ text: zh ? "请评这份作业。" : "Grade this work." });
  return parts;
}
