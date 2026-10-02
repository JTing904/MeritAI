// lib/ai/brief-check.ts: the deterministic checks on the AI's brief analysis (no network, no database), and
// services/ai-brief.ts analyseBrief with a fake model (the retry for a too-coarse answer, the language repair).
import { describe, expect, it } from "vitest";
import {
  applyRepairs,
  checkBrief,
  clampHours,
  eachMemberMentions,
  ensureCoverage,
  ensureEachMember,
  ensureSignatures,
  groundAiColours,
  ensurePerMember,
  fillMissingPoints,
  gradedParts,
  individualComponents,
  languageRepairs,
  meetingJustified,
  partIndex,
  perMemberItems,
  referenceTasks,
  rescaleToParts,
  tidyOptionLabels,
  tooFewTasks,
  unchainSections,
  wrongLanguage,
} from "../src/lib/ai/brief-check";
import type { BriefOut, BriefTaskOut } from "../src/lib/ai/prompts";
import { analyseBrief, type BriefCaller } from "../src/services/ai-brief";
import type { CallOutcome, CallRequest } from "../src/services/ai-call";

const task = (title: string, over: Partial<BriefTaskOut> = {}): BriefTaskOut => ({
  title,
  kind: "DOC",
  points: 10,
  estimateHours: 4,
  suggestedDue: null,
  milestone: null,
  feature: null,
  part: null,
  briefFrom: null,
  briefTo: null,
  quote: null,
  howto: ["第一步", "第二步"],
  checklist: ["做完了", "交了"],
  prereqTitle: null,
  ...over,
});

type Option = BriefOut["questions"][number]["options"][number];
const option = (label: string, tasks: BriefTaskOut[], over: Partial<Option> = {}): Option => ({
  label,
  summary: `${label} 的做法`,
  hours: 20,
  material: "MID",
  difficulty: "MID",
  pros: ["资料多"],
  cons: ["要调参"],
  recommended: false,
  tasks,
  ...over,
});

const plan = (tasks: BriefTaskOut[], questions: BriefOut["questions"] = [], meetingFirst: BriefOut["meetingFirst"] = null): BriefOut => ({ tasks, questions, meetingFirst });
const method = (options: Option[]): BriefOut["questions"][number] => ({ prompt: "选一个研究方向", quote: null, type: "METHOD", pickCount: 1, options });

const titles = (tasks: BriefTaskOut[]) => tasks.map((t) => t.title);
const sum = (tasks: BriefTaskOut[]) => tasks.reduce((s, t) => s + t.points, 0);

// The real TAR UMT brief's key sentences (the full brief stays outside the repo).
const AI_BRIEF = [
  "Form a group of TWO (2) to THREE (3) members.",
  "Titles 1. Machine Learning (Supervised)",
  "   e) Each group member must provide a solution using a preferred classification method (e.g.,",
  "      ANN, SVM, KNN).",
  "2. Machine Learning (Unsupervised)",
  "   e) Each group member must provide a solution using a preferred clustering method.",
  "A demo session to present the prototype is required in week 12 to week 14.",
  "Contribution This assignment consists of the following TWO (2) components:",
  "   1. Documentation (40%)",
  "   2. Prototype development (60%).",
  "Each student is required to fill up Appendix A: “Plagiarism Statement Form” attached in the",
  "documentation template.",
  "Students are required to include an AI Disclosure Statement (Appendix B) with each submission.",
  "EACH team member is required to present their own work, demonstrate the prototype and be ready for a Q&A session.",
].join("\n");

describe("language", () => {
  it("a zh string is wrong only with no Chinese at all; an en string with any Chinese", () => {
    expect(wrongLanguage("Machine Learning (Supervised)", "zh")).toBe(true);
    expect(wrongLanguage("监督式机器学习（Machine Learning (Supervised)）", "zh")).toBe(false);
    expect(wrongLanguage("A", "zh")).toBe(false);
    expect(wrongLanguage("https://www.kaggle.com/datasets", "zh")).toBe(false);
    expect(wrongLanguage("SVM", "zh")).toBe(true);
    expect(wrongLanguage("Write the introduction", "en")).toBe(false);
    expect(wrongLanguage("写引言", "en")).toBe(true);
  });

  it("lists the strings to repair and applies only good answers; prerequisites follow renamed titles", () => {
    const out = plan(
      [task("Write the introduction"), task("写方法", { prereqTitle: "Write the introduction", feature: "Report" })],
      [method([option("Machine Learning (Supervised)", []), option("推荐系统", [])])],
    );
    const wrong = languageRepairs(out, "zh");
    expect(wrong.map((w) => w.text)).toEqual(["Write the introduction", "Machine Learning (Supervised)", "Report"]);
    const ids = Object.fromEntries(wrong.map((w) => [w.text, w.id]));
    const { out: fixed, applied } = applyRepairs(out, "zh", [
      { id: ids["Write the introduction"]!, text: "写引言" },
      // Still English: not taken.
      { id: ids["Machine Learning (Supervised)"]!, text: "Supervised ML" },
      { id: ids["Report"]!, text: "报告" },
      // Not asked for.
      { id: "t1.title", text: "乱改" },
      { id: "nope", text: "什么" },
    ]);
    expect(applied).toBe(2);
    expect(titles(fixed.tasks)).toEqual(["写引言", "写方法"]);
    expect(fixed.tasks[1]).toMatchObject({ prereqTitle: "写引言", feature: "报告" });
    expect(fixed.questions[0]!.options[0]!.label).toBe("Machine Learning (Supervised)");
    // The input is untouched.
    expect(out.tasks[0]!.title).toBe("Write the introduction");
  });
});

describe("part weights", () => {
  it("finds the brief's graded parts with the rules parser, and maps a task's part to them", () => {
    const parts = gradedParts(AI_BRIEF)!;
    expect(parts).toEqual([
      { name: "Documentation", weight: 40 },
      { name: "Prototype development", weight: 60 },
    ]);
    expect(partIndex("Documentation = 40", parts)).toBe(0);
    expect(partIndex("prototype development", parts)).toBe(1);
    expect(partIndex("Prototype", parts)).toBe(1);
    expect(partIndex(null, parts)).toBe(-1);
    expect(partIndex("Forms", parts)).toBe(-1);
    expect(gradedParts("1. 写报告\n2. 做网站\n3. 上台演示")).toBeNull();
    expect(gradedParts(null)).toBeNull();
  });

  it("rescales each part to its share of the reference plan (the same factor for every option)", () => {
    const out = plan(
      [task("引言", { part: "Documentation", points: 10 }), task("结论", { part: "Documentation", points: 10 }), task("演示", { part: "Prototype development", points: 10 })],
      [method([option("A", [task("实现 A", { kind: "CODE", part: "Prototype development", points: 5 })], { recommended: true }), option("B", [task("实现 B", { kind: "CODE", part: "Prototype", points: 10 })])])],
    );
    expect(rescaleToParts(out, gradedParts(AI_BRIEF))).toMatch(/^parts: rescaled/);
    const ref = referenceTasks(out);
    expect(sum(ref)).toBeCloseTo(1000);
    expect(sum(ref.filter((t) => t.part === "Documentation"))).toBeCloseTo(400);
    expect(sum(ref.filter((t) => t.part === "Prototype development"))).toBeCloseTo(600);
    // Option B's task got the prototype factor too (twice option A's), and its part name is the brief's.
    expect(out.questions[0]!.options[1]!.tasks[0]).toMatchObject({ part: "Prototype development" });
    expect(out.questions[0]!.options[1]!.tasks[0]!.points).toBeCloseTo(2 * out.questions[0]!.options[0]!.tasks[0]!.points);
  });

  it("leaves the points alone when the mapping isn't reliable", () => {
    const parts = gradedParts(AI_BRIEF);
    const missing = plan([task("引言", { part: "Documentation", points: 10 }), task("表格", { points: 1 })]);
    expect(rescaleToParts(missing, parts)).toMatch(/no task for Prototype development/);
    expect(missing.tasks.map((t) => t.points)).toEqual([10, 1]);
    const unmapped = plan([task("引言", { part: "Documentation", points: 10 }), task("演示", { part: "Prototype", points: 10 }), task("别的", { points: 20 })]);
    expect(rescaleToParts(unmapped, parts)).toMatch(/50% of the points have no part/);
    expect(unmapped.tasks.map((t) => t.points)).toEqual([10, 10, 20]);
    expect(rescaleToParts(unmapped, null)).toBe("parts: none in the brief");
  });

  it("gives tasks without points a value from their hours", () => {
    const out = plan([task("a", { points: 10, estimateHours: 5 }), task("b", { points: 20, estimateHours: 5 }), task("c", { points: 0, estimateHours: 3 })], [
      method([option("A", [task("d", { points: 0, estimateHours: 6 })])]),
    ]);
    expect(fillMissingPoints(out)).toBe(2);
    // Median rate of (2, 4) with two values: the upper one, 4 points an hour.
    expect(out.tasks[2]!.points).toBe(12);
    expect(out.questions[0]!.options[0]!.tasks[0]!.points).toBe(24);
  });
});

describe("each member", () => {
  it("spots 'each member must build their own' and not 'each member presents' or forms", () => {
    expect(eachMemberMentions(AI_BRIEF)).toBe(2);
    expect(eachMemberMentions("Each member is required to develop and implement a different solution for the task")).toBe(1);
    expect(eachMemberMentions("EACH team member is required to present their own work")).toBe(0);
    expect(eachMemberMentions("Each student is required to fill up Appendix A")).toBe(0);
    expect(eachMemberMentions("每个组员各自用不同的算法实现一个方案。")).toBe(1);
    expect(eachMemberMentions("演示的时候每个人都要上台讲一部分。")).toBe(0);
    expect(eachMemberMentions(null)).toBe(0);
  });

  it("makes exactly packageCount numbered tasks in every option: copies one, merges extras", () => {
    const out = plan(
      [task("引言")],
      [
        method([
          option("监督式机器学习", [task("收集数据", { kind: "RESEARCH" }), task("实现一个分类模型", { kind: "CODE", points: 12, prereqTitle: "收集数据" }), task("比较结果", { kind: "RESEARCH", prereqTitle: "实现一个分类模型" })]),
          option("无监督式机器学习", [1, 2, 3, 4].map((n) => task(`个人方案 ${n}：聚类方法`, { kind: "CODE", points: 6 }))),
        ]),
      ],
    );
    const { individual, note } = ensureEachMember(out, AI_BRIEF, 3, "zh");
    expect(note).toMatch(/3 individual tasks in 监督式机器学习, 无监督式机器学习/);
    const [a, b] = out.questions[0]!.options;
    expect(titles(a!.tasks)).toEqual(["收集数据", "个人方案 1：实现一个分类模型", "个人方案 2：实现一个分类模型", "个人方案 3：实现一个分类模型", "比较结果"]);
    expect(a!.tasks.slice(1, 4).map((t) => [t.points, t.feature, t.prereqTitle])).toEqual([
      [12, "个人方案 1", "收集数据"],
      [12, "个人方案 2", "收集数据"],
      [12, "个人方案 3", "收集数据"],
    ]);
    // What waited for the old title waits for the first copy.
    expect(a!.tasks[4]!.prereqTitle).toBe("个人方案 1：实现一个分类模型");
    // Four became three; the fourth one's points are shared out.
    expect(titles(b!.tasks)).toEqual(["个人方案 1：聚类方法", "个人方案 2：聚类方法", "个人方案 3：聚类方法"]);
    expect(b!.tasks.map((t) => t.points)).toEqual([8, 8, 8]);
    expect(individual.size).toBe(6);
  });

  it("works on the top-level tasks when no option holds code, and copies of different methods get a generic title", () => {
    const out = plan([task("Implement SVM", { kind: "CODE" }), task("Implement KNN", { kind: "CODE" }), task("Write the report")]);
    ensureEachMember(out, "Each member is required to develop and implement a different solution.", 3, "en");
    expect(titles(out.tasks)).toEqual(["Implement SVM", "Implement KNN", "Individual solution 3: implement and evaluate another method", "Write the report"]);
    expect(out.tasks.slice(0, 3).map((t) => t.feature)).toEqual(["Individual solution 1", "Individual solution 2", "Individual solution 3"]);
  });

  it("gives the model's own numbering the standard 「个人方案 N：」 form", () => {
    const out = plan([1, 2, 3].map((n) => task(`监督学习：个人成员方案（${n} 名成员）`, { kind: "CODE" })));
    ensureEachMember(out, "每个组员各自用不同的算法实现一个方案。", 3, "zh");
    expect(titles(out.tasks)).toEqual(["个人方案 1：监督学习：个人成员方案", "个人方案 2：监督学习：个人成员方案", "个人方案 3：监督学习：个人成员方案"]);
  });

  it("takes 「个人方案 N」 off titles when the brief never asked for it", () => {
    const out = plan([task("Individual solution 1: Login module", { kind: "CODE", feature: "Individual solution 1" }), task("Test it", { prereqTitle: "Individual solution 1: Login module" })]);
    expect(ensureEachMember(out, "Build a parking system.", 3, "en").note).toMatch(/taken off 1 title/);
    expect(out.tasks.map((t) => [t.title, t.feature, t.prereqTitle])).toEqual([
      ["Login module", null, null],
      ["Test it", null, "Login module"],
    ]);
  });
});

describe("individual titles when the brief only gives example methods", () => {
  it("takes a method the brief listed after e.g. off the titles, into the steps", () => {
    const out = plan(
      [task("引言")],
      [method([option("监督式机器学习", ["ANN", "SVM", "KNN"].map((m, i) => task(`个人方案 ${i + 1}：基于 ${m} 的疾病预测模型`, { kind: "CODE" })))])],
    );
    const { note } = ensureEachMember(out, AI_BRIEF, 3, "zh");
    expect(note).toMatch(/3 title\(s\) named a method the brief only gave as an example/);
    const tasks = out.questions[0]!.options[0]!.tasks;
    expect(titles(tasks)).toEqual(["个人方案 1：自选一种方法实现并评估", "个人方案 2：自选一种方法实现并评估", "个人方案 3：自选一种方法实现并评估"]);
    expect(tasks[0]!.howto[0]).toMatch(/方法自己选.*ANN、SVM、KNN/);
    expect(tasks[0]!.checklist).toContain("用的方法和其他组员不一样");
    // Chinese method names count too.
    const zh = plan([1, 2, 3].map((n) => task(`个人方案 ${n}：用协同过滤做推荐`, { kind: "CODE" })));
    ensureEachMember(zh, "每个组员用自选的推荐方法（例如协同过滤、基于内容）实现一个方案。", 3, "zh");
    expect(zh.tasks[0]!.title).toBe("个人方案 1：自选一种方法实现并评估");
  });

  it("keeps generic titles, and method names when the brief prescribes them", () => {
    const generic = plan([1, 2, 3].map((n) => task(`个人方案 ${n}：选一种分类方法实现并评估`, { kind: "CODE" })));
    expect(ensureEachMember(generic, AI_BRIEF, 3, "zh").note).not.toMatch(/made generic/);
    expect(generic.tasks[0]!.title).toBe("个人方案 1：选一种分类方法实现并评估");
    const prescribed = plan([task("Individual solution 1: SVM classifier", { kind: "CODE" }), task("Individual solution 2: KNN classifier", { kind: "CODE" })]);
    ensureEachMember(prescribed, "Each member must implement a different classification model: one SVM and one KNN.", 2, "en");
    expect(titles(prescribed.tasks)).toEqual(["Individual solution 1: SVM classifier", "Individual solution 2: KNN classifier"]);
  });
});

describe("per member (each student does it personally)", () => {
  it("finds what the brief says each member must do in person, not group-level items", () => {
    expect([...perMemberItems(AI_BRIEF)]).toEqual([
      ["declaration", 11],
      ["presentation", 14],
    ]);
    expect(perMemberItems("Team leader has to compile and submit the deliverables. Include a plagiarism statement form.").size).toBe(0);
    expect(perMemberItems("Students are required to include an AI Disclosure Statement (Appendix B) with each submission.").size).toBe(0);
    expect(perMemberItems("Each student must attach an AI disclosure statement.").size).toBe(0);
    expect(perMemberItems("Each member is required to develop using different algorithms. You can also demo the system (optional).").size).toBe(0);
    expect(perMemberItems("The group presents its prototype in week 12. Peer evaluation (10%).").size).toBe(0);
    expect([...perMemberItems("Every student must submit a peer evaluation form and a reflective log.").keys()]).toEqual(["peer-evaluation", "reflection"]);
    expect([...perMemberItems("每位同学都要签署抄袭声明。\n演示的时候每个人都要上台讲一部分。\n每一个人都要写个人贡献说明。").keys()]).toEqual(["declaration", "presentation", "contribution"]);
    expect(perMemberItems("组长代表全组提交，每个组员都要签名。").size).toBe(0);
    expect(perMemberItems(null).size).toBe(0);
  });

  it("splits the model's one task into packageCount copies with equal points and a feature each", () => {
    const out = plan([
      task("文档：引言"),
      task("演示与现场编程答辩", { kind: "MEETING", points: 12, part: "Prototype development", checklist: ["每个组员都讲了自己的部分", "回答了提问"] }),
      task("制作演示幻灯片", { points: 3 }),
      task("写 AI 使用声明", { points: 1 }),
      task("结果与讨论", { prereqTitle: "演示与现场编程答辩" }),
    ]);
    expect(ensurePerMember(out, AI_BRIEF, 3, "zh")).toBe("per member: declaration added, presentation split → 3");
    expect(titles(out.tasks)).toEqual([
      "文档：引言",
      "演示与现场编程答辩（第 1 份）",
      "演示与现场编程答辩（第 2 份）",
      "演示与现场编程答辩（第 3 份）",
      "制作演示幻灯片",
      "写 AI 使用声明",
      "结果与讨论",
      "签署抄袭声明表（第 1 份）",
      "签署抄袭声明表（第 2 份）",
      "签署抄袭声明表（第 3 份）",
    ]);
    const demo = out.tasks.slice(1, 4);
    expect(demo.map((t) => [t.points, t.feature, t.part])).toEqual([
      [4, "组员 1", "Prototype development"],
      [4, "组员 2", "Prototype development"],
      [4, "组员 3", "Prototype development"],
    ]);
    // One person's checklist: the whole-group item goes, the in-person one comes.
    expect(demo[0]!.checklist).toEqual(["回答了提问", "自己亲自讲解和答问（别人不能代讲）"]);
    expect(out.tasks[6]!.prereqTitle).toBe("演示与现场编程答辩（第 1 份）");
    const forms = out.tasks.slice(7);
    expect(forms.map((t) => [t.feature, t.briefFrom])).toEqual([
      ["组员 1", 11],
      ["组员 2", 11],
      ["组员 3", 11],
    ]);
    expect(new Set(forms.map((t) => t.points)).size).toBe(1);
    // Coverage then sees both; nothing single is added for them.
    expect(ensureCoverage(out, AI_BRIEF, "zh")).toEqual([]);
  });

  it("brings the model's own copies to packageCount, and leaves a combined declarations task alone", () => {
    const out = plan([
      ...[1, 2, 3, 4].map((n) => task(`Sign the plagiarism form (member ${n})`, { points: 1 })),
      task("Fill in the plagiarism and AI declarations", { points: 2 }),
      task("Presentation and Q&A", { kind: "MEETING", points: 9 }),
    ]);
    ensurePerMember(out, AI_BRIEF, 2, "en");
    expect(titles(out.tasks)).toEqual([
      "Sign the plagiarism form (member 1)",
      "Sign the plagiarism form (member 2)",
      "Fill in the plagiarism and AI declarations",
      "Presentation and Q&A (member 1)",
      "Presentation and Q&A (member 2)",
    ]);
    expect(out.tasks.map((t) => t.points)).toEqual([2, 2, 2, 4.5, 4.5]);
    expect(out.tasks[0]!.feature).toBe("Member 1");
  });

  it("works inside the options when only they hold it, and does nothing without per-person phrases or with one package", () => {
    const out = plan([task("Report")], [method([option("A", [task("Demo A", { kind: "MEETING" })]), option("B", [task("Demo B", { kind: "MEETING" })])])]);
    ensurePerMember(out, "EACH team member is required to present their own work.", 2, "en");
    expect(out.questions[0]!.options.map((o) => titles(o.tasks))).toEqual([
      ["Demo A (member 1)", "Demo A (member 2)"],
      ["Demo B (member 1)", "Demo B (member 2)"],
    ]);
    const none = plan([task("Presentation", { kind: "MEETING" })]);
    expect(ensurePerMember(none, "Final presentation (20%). Peer evaluation (10%).", 3, "en")).toBe("per member: nothing in the brief");
    expect(ensurePerMember(none, AI_BRIEF, 1, "en")).toMatch(/one package only/);
    expect(titles(none.tasks)).toEqual(["Presentation"]);
  });
});

// The MPU3232 entrepreneurship brief's key lines (the full brief stays outside the repo): mixed individual and group work.
const MPU_BRIEF = [
  "Assessment Methods Total",
  "   1. Idea Generation\t20 marks (Individual)",
  "",
  "   2. Student Pitching\t30 marks (Individual)",
  "",
  "   3. Business Plan Report\t50 marks (10 Individual + 40 Group)",
  " TOTAL 100 marks",
  "CLO 1: IDEA GENERATION (INDIVIDUAL ASSIGNMENT)",
  "2.) This individual assessment is in the forms of presentation of business opportunity via written",
  "   introduction/explanation.",
  "3.) Every student is expected to think, observe, and carry out some findings so as to come out a business opportunity.",
  "CLO 2: BUSINESS PLAN (10% INDIVIDUAL + 40% GROUP)",
  "   • Executive Summary (Individual)",
  "   • Business Description",
  "No\t(Individual 20%)",
  "Marking rubric for CLO 1 (Individual Assessment, 20 marks)",
  "Market Analysis\tGreat industry\t(4-5 marks)",
  "The students are required to pitch about their group assignment idea to their tutor. It is COMPULSORY",
  "for ALL the group members to participate in presenting their idea during the pitching session.",
].join("\n");

describe("individual components (mixed individual and group work)", () => {
  it("reads the brief's numbered summary of parts before a rubric table, and the components marked individual", () => {
    expect(gradedParts(MPU_BRIEF)).toEqual([
      { name: "Idea Generation", weight: 20 },
      { name: "Student Pitching", weight: 30 },
      { name: "Business Plan Report", weight: 50 },
    ]);
    expect(individualComponents(MPU_BRIEF)).toEqual(["Idea Generation", "Student Pitching", "Executive Summary"]);
    expect([...perMemberItems(MPU_BRIEF)]).toEqual([["presentation", 19]]);
    expect(individualComponents(AI_BRIEF)).toEqual([]);
    expect(individualComponents("(i) Individual performance review\nIndividual marks may be adjusted.")).toEqual([]);
  });

  it("gives each member one task per individual component, merging the model's pieces, and leaves group work alone", () => {
    const out = plan(
      [
        task("个人创意：调研商业机会", { kind: "RESEARCH", part: "Idea Generation", points: 4, estimateHours: 3, howto: ["看新闻找机会"], checklist: ["找到 3 个机会"] }),
        task("个人创意：写 700 字说明", { part: "Idea Generation", points: 16, estimateHours: 4, prereqTitle: "个人创意：调研商业机会", checklist: ["每个组员都交了", "不超过 700 字"] }),
        task("讨论并选出最好的点子", { kind: "MEETING", points: 2, prereqTitle: "个人创意：写 700 字说明" }),
        task("执行摘要", { part: "Business Plan Report", points: 10 }),
        task("市场分析", { part: "Business Plan Report", points: 10 }),
        task("路演幻灯片", { kind: "DESIGN", part: "Student Pitching", points: 6 }),
        task("路演与问答", { kind: "MEETING", part: "Student Pitching", points: 24 }),
      ],
      [],
    );
    const note = ensurePerMember(out, MPU_BRIEF, 4, "zh");
    expect(note).toMatch(/Idea Generation 2 task\(s\) → 4, Student Pitching 1 task\(s\) → 4, Executive Summary 1 task\(s\) → 4, presentation 4 copies → 4/);
    const n = [1, 2, 3, 4];
    expect(titles(out.tasks)).toEqual([
      ...n.map((i) => `个人创意：写 700 字说明（第 ${i} 份）`),
      "讨论并选出最好的点子",
      ...n.map((i) => `执行摘要（第 ${i} 份）`),
      "市场分析",
      "路演幻灯片",
      ...n.map((i) => `路演与问答（第 ${i} 份）`),
    ]);
    const idea = out.tasks[0]!;
    // Both pieces' steps and hours, the points of both shared out, no wait for a merged-away task.
    expect(idea).toMatchObject({ points: 5, estimateHours: 7, prereqTitle: null, feature: "组员 1", part: "Idea Generation" });
    expect(idea.howto).toEqual(["第一步", "第二步", "看新闻找机会"]);
    expect(idea.checklist).toEqual(["不超过 700 字", "找到 3 个机会", "是自己本人完成的（个人部分，别人不能代做）"]);
    // The team's pick waits for the first copy.
    expect(out.tasks[4]!.prereqTitle).toBe("个人创意：写 700 字说明（第 1 份）");
    expect(out.tasks.filter((t) => t.feature === "组员 2").map((t) => t.title)).toEqual(["个人创意：写 700 字说明（第 2 份）", "执行摘要（第 2 份）", "路演与问答（第 2 份）"]);
    expect(out.tasks.slice(-4).map((t) => t.points)).toEqual([6, 6, 6, 6]);
  });

  it("keeps a meetingFirst that isn't about joining code as an ordinary meeting task", () => {
    const answer = plan([task("市场分析"), task("财务预测")], [], { title: "选出最好的点子", why: "从各人的点子里选一个做商业计划" });
    const { out, notes } = checkBrief(answer, { locale: "zh", packageCount: 2, briefText: "写一份商业计划。", parts: null });
    expect(out.meetingFirst).toBeNull();
    expect(out.tasks[0]).toMatchObject({ title: "选出最好的点子", kind: "MEETING", howto: ["从各人的点子里选一个做商业计划"] });
    expect(notes.join("\n")).toMatch(/made an ordinary meeting task/);
  });

  it("merges a second copy of the same member's solution into that member's copy", () => {
    const opt = option("监督学习", [
      task("收集数据", { kind: "RESEARCH", points: 5 }),
      ...[1, 2, 3].map((n) => task(`个人方案 ${n}：实现并评估一种分类方法`, { kind: "CODE", points: 5 })),
      task("個人方案 3：实现并评估个人选定的解法", { kind: "CODE", points: 6, howto: ["另一步"] }),
    ]);
    const out = plan([task("报告", { prereqTitle: null })], [method([opt])]);
    ensureEachMember(out, AI_BRIEF, 3, "zh");
    const tasks = out.questions[0]!.options[0]!.tasks;
    expect(titles(tasks)).toEqual(["收集数据", ...[1, 2, 3].map((n) => `个人方案 ${n}：实现并评估一种分类方法`)]);
    expect(tasks.slice(1).map((t) => t.points)).toEqual([7, 7, 7]);
    expect(tasks[3]!.howto).toContain("另一步");
  });

  it("names a pitch the brief's way when the model copied the prompt's example title", () => {
    const out = plan([task("演示与答问：讲解自己的部分", { kind: "MEETING", part: "Student Pitching", points: 30 }), task("市场分析", { part: "Business Plan Report" })]);
    ensurePerMember(out, MPU_BRIEF, 4, "zh");
    const pitch = out.tasks.filter((t) => t.part === "Student Pitching");
    expect(titles(pitch)).toEqual([1, 2, 3, 4].map((i) => `路演与答问：介绍自己负责的部分（第 ${i} 份）`));
    expect(pitch[0]!.checklist).toContain("自己亲自上台讲和答问（别人不能代讲）");
  });

  it("adds on-the-spot coding to every member's presentation when the brief asks for it", () => {
    const brief = "EACH team member is required to present their own work and answer questions.\nPresentation & on-the-spot coding 10 marks";
    const out = plan([task("演示与答问", { kind: "MEETING", points: 10 })]);
    ensurePerMember(out, brief, 2, "zh");
    expect(out.tasks.map((t) => t.checklist.includes("能当场按要求改代码（on-the-spot coding）"))).toEqual([true, true]);
  });

  it("drops a question whose options are the members' own ideas, keeping the pick as a meeting", () => {
    const q = { ...method([option("绿色能源方案", [task("绿色能源调研")]), option("AI 服务方案", [task("AI 服务调研")])]), prompt: "团队必须从各组员在 CLO1 中提出的商业点子中选择一个" };
    const { out, notes } = checkBrief(plan([task("市场分析")], [q]), { locale: "zh", packageCount: 2, briefText: "写一份商业计划。", parts: null });
    expect(out.questions).toEqual([]);
    expect(out.tasks[0]).toMatchObject({ kind: "MEETING", title: "一起从各人的成果里选出要做的一个" });
    expect(notes.join("\n")).toMatch(/questions: dropped 1/);
    // A real choice from the brief's own list stays.
    const real = checkBrief(plan([task("市场分析")], [method([option("监督学习", [task("实现")]), option("推荐系统", [task("实现")])])]), { locale: "zh", packageCount: 2, briefText: "写一份报告。", parts: null });
    expect(real.out.questions).toHaveLength(1);
  });

  it("gives each member one task to sign both group forms (plagiarism statement and free-rider contract)", () => {
    const brief = "b.) Plagiarism Statement – Refer to Attachment 2a\nc.) Free-Rider Contract Form – Refer to Attachment 6";
    const out = plan([task("市场分析"), task("签署抄袭声明表", { estimateHours: 0.5, points: 2 })]);
    ensureCoverage(out, brief, "zh");
    expect(ensureSignatures(out, brief, 3, "zh")).toMatch(/1 signing task\(s\) → 3 \(plagiarism statement \+ contract\)/);
    const signs = out.tasks.filter((t) => t.title.startsWith("签署"));
    expect(titles(signs)).toEqual([1, 2, 3].map((n) => `签署抄袭声明和小组合约（第 ${n} 份）`));
    expect(signs.map((t) => t.feature)).toEqual(["组员 1", "组员 2", "组员 3"]);
    expect(signs[0]!.checklist).toContain("签名的是自己本人（别人不能代签）");
    // Only the contract: one copy each too.
    const only = plan([task("市场分析")]);
    ensureSignatures(only, "Free-Rider Contract Form", 2, "zh");
    expect(titles(only.tasks).slice(1)).toEqual(["签署小组合约（free-rider 表）（第 1 份）", "签署小组合约（free-rider 表）（第 2 份）"]);
  });

  it("replaces a guessed AI colour with a plain reminder when the brief colour-codes AI use", () => {
    const brief = "Executive summary (10 marks)\nGreen (AI-Supported): AI tools are encouraged\nRed (No AI): prohibited";
    const out = plan([task("执行摘要", { howto: ["根据学校AI政策（黄色级别），可用 AI 润色语言。", "写摘要"] })]);
    expect(groundAiColours(out, brief, "zh")).toBe(1);
    expect(out.tasks[0]!.howto).toEqual(["这份作业对用 AI 有规定：动手前先确认这一项准不准用 AI、能用到什么程度。", "写摘要"]);
    expect(groundAiColours(plan([task("x", { howto: ["黄色级别"] })]), "no legend here", "zh")).toBe(0);
  });
});

describe("meetingFirst, coverage, hours, count", () => {
  it("keeps the meeting only when code of different features waits for other code", () => {
    const login = task("登录 API", { kind: "CODE", feature: "登录" });
    const chat = task("聊天 API", { kind: "CODE", feature: "聊天", prereqTitle: "登录 API" });
    expect(meetingJustified(plan([login, chat]))).toBe(true);
    expect(meetingJustified(plan([login, { ...chat, prereqTitle: null }]))).toBe(false);
    expect(meetingJustified(plan([login, { ...chat, feature: "登录" }]))).toBe(false);
    // Individual solutions waiting for shared data prep don't need an interface meeting.
    expect(meetingJustified(plan([login, chat]), new Set([chat]))).toBe(false);
  });

  it("adds a small task for each required item nobody covers, in the project's language", () => {
    const out = plan([task("文档：引言", { points: 20 }), task("准备演示和问答", { kind: "MEETING", points: 10 })]);
    expect(ensureCoverage(out, AI_BRIEF, "zh")).toEqual(["plagiarism", "ai-disclosure"]);
    const [plagiarism, ai] = out.tasks.slice(2);
    expect(plagiarism).toMatchObject({ title: "填写并签署抄袭声明表", kind: "DOC", briefFrom: 11, briefTo: 11, suggestedDue: null });
    expect(plagiarism!.points).toBeCloseTo(0.3);
    expect(ai!.title).toBe("写 AI 使用声明");
    // A title or checklist item that names it counts; a passing mention in a step doesn't.
    const covered = plan([task("Conclusion and declarations", { checklist: ["Plagiarism form signed", "AI disclosure statement attached"] }), task("Demo", { howto: ["mention APA style"] })]);
    expect(ensureCoverage(covered, `${AI_BRIEF}\nReferences in APA style.`, "en")).toEqual(["references"]);
    expect(covered.tasks[2]!.title).toBe("Compile the references in the required citation style");
    expect(ensureCoverage(plan([]), null, "en")).toEqual([]);
  });

  it("clamps hours softly and counts tasks against packageCount × 2", () => {
    const out = plan([task("a", { estimateHours: 30 }), task("b", { estimateHours: 0 }), task("c", { estimateHours: 0.2 })]);
    expect(clampHours(out)).toBe(1);
    expect(out.tasks.map((t) => t.estimateHours)).toEqual([10, 2, 0.5]);
    expect(tooFewTasks(out, 3)).toEqual({ have: 3, want: 6 });
    expect(tooFewTasks(out, 1)).toBeNull();
  });

  it("takes the brief's numbering off option labels and unchains report sections", () => {
    const out = plan(
      [
        task("引言"),
        task("相关研究", { prereqTitle: "引言" }),
        task("方法", { prereqTitle: "相关研究" }),
        task("实现", { kind: "CODE" }),
        task("结果", { prereqTitle: "实现" }),
        task("采访提纲", { kind: "RESEARCH" }),
        task("采访", { kind: "RESEARCH", prereqTitle: "采访提纲" }),
      ],
      [method([option("1. 监督式机器学习", []), option("(b) 推荐系统", []), option("Agile（Scrum）", [])])],
    );
    expect(tidyOptionLabels(out)).toBe(2);
    expect(out.questions[0]!.options.map((o) => o.label)).toEqual(["监督式机器学习", "推荐系统", "Agile（Scrum）"]);
    expect(unchainSections(out)).toBe(2);
    // A chain of three document tasks runs in parallel; a single wait and a wait for code stay.
    expect(out.tasks.map((t) => t.prereqTitle)).toEqual([null, null, null, null, "实现", null, "采访提纲"]);
  });
});

describe("checkBrief on an answer shaped like the light model's for the TAR UMT brief", () => {
  it("drops the meeting, numbers the solutions, covers the forms and follows 40 / 60", () => {
    const answer = plan(
      [
        task("文档：引言", { part: "Documentation", points: 8 }),
        task("文档：方法", { part: "Documentation", points: 8 }),
        task("原型：演示与答辩", { kind: "MEETING", part: "Prototype development", points: 30 }),
      ],
      [
        method(
          ["监督式机器学习", "无监督式机器学习"].map((label, i) =>
            option(label, [task(`${label}：数据预处理`, { kind: "RESEARCH", part: "Prototype development", points: 0 }), task(`${label}：模型实现`, { kind: "CODE", part: "Prototype development", points: 0, prereqTitle: `${label}：数据预处理` })], { recommended: i === 0 }),
          ),
        ),
      ],
      { title: "一起定好接口", why: "要整合" },
    );
    const { out, notes } = checkBrief(answer, { locale: "zh", packageCount: 3, briefText: AI_BRIEF });
    expect(out.meetingFirst).toBeNull();
    expect(out.questions[0]!.options[0]!.tasks.filter((t) => t.title.startsWith("个人方案")).length).toBe(3);
    // Presenting and signing are done by each member personally: three copies each; the AI disclosure is one.
    expect(titles(out.tasks)).toEqual([
      "文档：引言",
      "文档：方法",
      "原型：演示与答辩（第 1 份）",
      "原型：演示与答辩（第 2 份）",
      "原型：演示与答辩（第 3 份）",
      "签署抄袭声明表（第 1 份）",
      "签署抄袭声明表（第 2 份）",
      "签署抄袭声明表（第 3 份）",
      "写 AI 使用声明",
    ]);
    // Copy n goes with individual solution n (one feature, one package).
    expect(out.tasks.slice(2, 8).map((t) => t.feature)).toEqual(["个人方案 1", "个人方案 2", "个人方案 3", "个人方案 1", "个人方案 2", "个人方案 3"]);
    expect(notes.join("\n")).toMatch(/per member: declaration added, presentation split → 3/);
    const ref = referenceTasks(out);
    const share = (part: string) => sum(ref.filter((t) => t.part === part)) / sum(ref);
    expect(share("Documentation")).toBeGreaterThan(0.38);
    expect(share("Documentation")).toBeLessThan(0.4);
    expect(share("Prototype development")).toBeGreaterThan(0.57);
    expect(notes.join("\n")).toMatch(/points: 4 task\(s\) without points/);
    // The answer itself is untouched.
    expect(answer.meetingFirst).not.toBeNull();
  });
});

describe("analyseBrief with a fake model", () => {
  const ctx = { locale: "zh" as const, today: "2026-09-23", deadline: "2026-11-20", timezone: "Asia/Kuala_Lumpur", teamSize: 3, packageCount: 3, projectName: "AI 作业" };
  type Seen = { purpose: string; tier: string; text: string };

  function fake(answers: Record<string, unknown[]>): { call: BriefCaller; seen: Seen[] } {
    const seen: Seen[] = [];
    const call = async <T,>(req: CallRequest<T>): Promise<CallOutcome<T>> => {
      seen.push({ purpose: req.purpose, tier: req.tier, text: req.parts.map((p) => ("text" in p ? p.text : "")).join("\n") });
      const next = answers[req.purpose]?.shift();
      if (next === undefined || next === "fail") return { kind: "fail", reason: "ERROR", retry: true, detail: "busy" };
      return { kind: "ok", data: req.schema.parse(next), model: req.tier === "light" ? "gemini-flash-lite-latest" : "gemini-3.7-flash", provider: "GEMINI", tier: req.tier };
    };
    return { call, seen };
  }

  it("asks once more when the split is far too coarse, and keeps the finer answer", async () => {
    const coarse = plan([task("写报告"), task("做原型", { kind: "CODE" })]);
    const fine = plan(["引言", "相关研究", "方法", "结果", "结论", "界面", "编程"].map((t) => task(t)));
    const { call, seen } = fake({ brief: [coarse, fine] });
    const res = await analyseBrief(call, { ctx, text: "1. 报告\n2. 原型", file: null });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(seen.map((s) => [s.purpose, s.tier])).toEqual([
      ["brief", "good"],
      ["brief", "good"],
    ]);
    expect(seen[1]!.text).toContain("你上一次只拆出 2 个任务");
    expect(seen[1]!.text).toContain("至少拆成 6 个");
    expect(res.data.tasks).toHaveLength(7);
    expect(res.notes.join("\n")).toMatch(/asked again, gemini-3.7-flash gave 7/);
  });

  it("keeps the first answer when the second try fails, and repairs English strings with one light call", async () => {
    const english = plan([task("Write the introduction"), task("写方法")]);
    const { call, seen } = fake({ brief: [english, "fail"], "brief-fix": [{ items: [{ id: "t0.title", text: "写引言" }] }] });
    const res = await analyseBrief(call, { ctx, text: "1. Introduction\n2. Method", file: null });
    expect(res.kind === "ok" && titles(res.data.tasks)).toEqual(["写引言", "写方法"]);
    expect(seen.map((s) => [s.purpose, s.tier])).toEqual([
      ["brief", "good"],
      ["brief", "good"],
      ["brief-fix", "light"],
    ]);
    // The strings go to the repair call fenced, as data.
    expect(seen[2]!.text).toMatch(/<<<STRINGS [\w-]+>>>/);
    expect(seen[2]!.text).toContain("Write the introduction");
  });

  it("fails like the model call when the first call fails; the graded parts go to the model", async () => {
    const { call, seen } = fake({ brief: ["fail"] });
    const res = await analyseBrief(call, { ctx, text: AI_BRIEF, file: null });
    expect(res).toMatchObject({ kind: "fail", retry: true });
    expect(seen[0]!.text).toMatch(/<<<GRADED PARTS [\w-]+>>>\nDocumentation = 40\nPrototype development = 60\n/);
  });
});
