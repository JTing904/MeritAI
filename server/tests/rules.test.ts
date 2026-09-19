import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TaskKind } from "../../shared/types";
import { canonicalTimeZone, endOfLocalDay, isValidTimeZone, localDate, spreadDueDates, toInstant, wallClock, zonedTime } from "../src/lib/plan/dates";
import { cleanTitle, guessKind, MAX_TITLE_CHARS, parseBriefWithRules, TYPED_PARAGRAPH_CHARS } from "../src/lib/plan/rules";

const FIXTURES = fileURLToPath(new URL("./fixtures/briefs/", import.meta.url));
const brief = (name: string) => readFileSync(FIXTURES + name, "utf8");

type Row = [title: string, weight: number, kind: TaskKind];
type Expected = { method: "SCORES" | "LIST"; tasks: Row[] } | { reason: "NO_STRUCTURE" | "EMPTY" };

const rows = (text: string) => {
  const r = parseBriefWithRules(text);
  return r.ok ? { method: r.method, tasks: r.tasks.map((t): Row => [t.title, t.weight, t.kind]) } : { reason: r.reason };
};

// What a leader should see for each realistic brief (Malaysian universities, English and Chinese).
const EXPECTED: Record<string, Expected> = {
  "en-utm-group-project.txt": {
    // "GROUP PROJECT (30%)" is the course weight; late penalty, Turnitin, grade scale and total are ignored.
    method: "SCORES",
    tasks: [
      ["Project Proposal", 10, "DOC"],
      ["System Analysis and Design Report", 25, "DOC"],
      ["Prototype Implementation", 35, "CODE"],
      ["Final Presentation and Demo", 20, "DESIGN"],
      ["Peer Evaluation", 10, "DOC"],
    ],
  },
  "zh-mkt201-marketing.txt": {
    // The mockup's example: 按「数字 + 分」找到 4 个评分项.
    method: "SCORES",
    tasks: [
      ["书面报告", 40, "DOC"],
      ["口头报告", 30, "DESIGN"],
      ["问卷调查", 20, "RESEARCH"],
      ["小组会议记录", 10, "MEETING"],
    ],
  },
  "en-taylors-marks-table.txt": {
    method: "SCORES",
    tasks: [
      ["Requirements analysis and UML diagrams", 15, "DOC"],
      ["Java application (source code and features)", 40, "CODE"],
      ["Testing report", 15, "DOC"],
      ["User manual", 10, "DOC"],
      ["Video demonstration (max 10 minutes)", 10, "DESIGN"],
      ["Group meetings log", 10, "MEETING"],
    ],
  },
  "en-mmu-list-no-scores.txt": {
    // The instructions list is admin; the nested i./ii. items belong to b).
    method: "LIST",
    tasks: [
      ["Conduct a literature review on numerical methods for solving non-linear equations", 1, "RESEARCH"],
      ["Implement the bisection, Newton-Raphson and secant methods in Python", 1, "CODE"],
      ["Compare the accuracy and speed of the three methods using at least five test functions", 1, "DOC"],
      ["Write a technical report of 2,000 to 2,500 words", 1, "DOC"],
      ["Prepare a 10-minute presentation with slides", 1, "DESIGN"],
      ["Keep minutes of every group meeting", 1, "MEETING"],
    ],
  },
  "zh-newera-list-sections.txt": {
    // 一、二、三 are section headings; the tasks are the items under 二、项目要求.
    method: "LIST",
    tasks: [
      ["访谈咖啡馆老板，整理出网站需要的功能", 1, "RESEARCH"],
      ["设计网站的页面草图和配色", 1, "DESIGN"],
      ["开发点餐网站，至少包含菜单、购物车和订单三个页面", 1, "CODE"],
      ["撰写项目报告，说明分工与开发过程", 1, "DOC"],
      ["制作演示文稿，期末课堂展示 15 分钟", 1, "DESIGN"],
    ],
  },
  "en-sunway-paragraphs.txt": { reason: "NO_STRUCTURE" },
  "zh-typed-paragraph.txt": { reason: "NO_STRUCTURE" },
  "en-ucsi-inline-scores.txt": {
    method: "SCORES",
    tasks: [
      ["Project proposal", 15, "DOC"],
      ["Written case study report", 45, "DOC"],
      ["Group presentation", 30, "DESIGN"],
      ["Reflective log", 10, "DOC"],
    ],
  },
  "en-apu-weightage-labels.txt": {
    method: "SCORES",
    tasks: [
      ["Project Proposal", 15, "DOC"],
      ["Requirements Specification", 25, "DOC"],
      ["System Design Document", 30, "DOC"],
      ["Presentation", 20, "DESIGN"],
      ["Peer Assessment", 10, "DOC"],
    ],
  },
  "en-um-nested-rubric.txt": {
    method: "SCORES",
    tasks: [
      ["Program", 60, "CODE"],
      ["Report", 25, "DOC"],
      ["Presentation", 15, "DESIGN"],
    ],
  },
  "zh-utar-zhan-percent.txt": {
    method: "SCORES",
    tasks: [
      ["选题策划书", 15, "DOC"],
      ["实地采访与资料整理", 25, "RESEARCH"],
      ["撰写三篇推文", 30, "DOC"],
      ["拍摄并剪辑一支 3 分钟短视频", 20, "DESIGN"],
      ["小组讨论记录与分工表", 10, "MEETING"],
    ],
  },
  "en-inti-duplicate-rubric.txt": {
    // The same four items appear again in the rubric table: counted once.
    method: "SCORES",
    tasks: [
      ["Wireframes and UI design", 20, "DESIGN"],
      ["Android app development", 50, "CODE"],
      ["Final presentation", 20, "DESIGN"],
      ["Meeting minutes", 10, "MEETING"],
    ],
  },
  "en-hackathon-points.txt": {
    method: "SCORES",
    tasks: [
      ["Innovation and originality", 30, "DOC"],
      ["Technical implementation", 30, "CODE"],
      ["Social impact", 20, "DOC"],
      ["Pitch presentation", 20, "DESIGN"],
    ],
  },
  "en-typed-bullets.txt": {
    method: "LIST",
    tasks: [
      ["Build the booking app prototype", 1, "CODE"],
      ["Design the pitch deck", 1, "DESIGN"],
      ["Interview 10 students about the problem", 1, "RESEARCH"],
      ["Record a 2-minute demo video", 1, "DESIGN"],
    ],
  },
  "zh-typed-inline-numbered.txt": {
    method: "LIST",
    tasks: [
      ["做一个订餐小程序", 1, "CODE"],
      ["写使用说明书", 1, "DOC"],
      ["做 PPT 上台展示", 1, "DESIGN"],
      ["每周开一次组会", 1, "MEETING"],
    ],
  },
  "blank.txt": { reason: "EMPTY" },
};

describe("parseBriefWithRules on realistic briefs", () => {
  it("has an expectation for every text fixture", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".txt"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))("%s", (file, expected) => {
    expect(rows(brief(file))).toEqual(expected);
  });

  it("reads Windows line endings and full-width digits the same way", () => {
    const text = brief("zh-mkt201-marketing.txt").replace(/\n/g, "\r\n").replace(/40 分/, "４０ 分");
    expect(rows(text)).toEqual(EXPECTED["zh-mkt201-marketing.txt"]);
  });
});

describe("method choice", () => {
  it("prefers SCORES over LIST when the scored items add up", () => {
    expect(rows("1. Report (60%)\n2. Poster (40%)").method).toBe("SCORES");
  });

  it("needs at least two scored items", () => {
    expect(rows("1. Report (100%)\n2. Poster\n3. Video")).toEqual({
      method: "LIST",
      tasks: [
        ["Report", 1, "DOC"],
        ["Poster", 1, "DESIGN"],
        ["Video", 1, "DESIGN"],
      ],
    });
  });

  it("accepts scored sums from 40 to 160 only when no total is stated", () => {
    expect(rows("1. Report (20 marks)\n2. Slides (20 marks)").method).toBe("SCORES");
    expect(rows("1. Report (80 marks)\n2. Slides (80 marks)").method).toBe("SCORES");
    expect(rows("1. Report (20 marks)\n2. Slides (19 marks)").method).toBe("LIST");
    expect(rows("1. Report (90%)\n2. Slides (80%)").method).toBe("LIST");
    expect(rows("Report (20 marks)\nSlides (19 marks)")).toEqual({ reason: "NO_STRUCTURE" });
  });

  it("keeps decimal weights as found", () => {
    expect(rows("1. Report 37.5%\n2. Video 62.5%").tasks).toEqual([
      ["Report", 37.5, "DOC"],
      ["Video", 62.5, "DESIGN"],
    ]);
  });

  it("returns EMPTY for blank text", () => {
    for (const t of ["", "   ", "\n\n\t \r\n", "\u3000\u200B"]) expect(parseBriefWithRules(t)).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("returns NO_STRUCTURE for paragraphs and single items", () => {
    expect(rows("Build an app for the campus cafe and present it at the end of the semester.")).toEqual({ reason: "NO_STRUCTURE" });
    expect(rows("1. Build an app for the campus cafe.")).toEqual({ reason: "NO_STRUCTURE" });
    expect(rows("Sales grew by 20% last year and 35% the year before.")).toEqual({ reason: "NO_STRUCTURE" });
  });

  it("ignores nested sub-items in a list", () => {
    expect(rows("1. Build the app\n   a) Login page\n   b) Menu page\n2. Write the report\n3. Present the demo").tasks?.map((t) => t[0])).toEqual([
      "Build the app",
      "Write the report",
      "Present the demo",
    ]);
  });

  it("takes the task list, not the instructions list", () => {
    const text = "Instructions:\n1. Form a group of 4 to 5 members.\n2. Submit through Moodle.\n\nTasks:\n1. Survey 30 students.\n2. Build the website.";
    expect(rows(text).tasks?.map((t) => t[0])).toEqual(["Survey 30 students", "Build the website"]);
  });

  it("treats 2.0 as a section heading over 2.1, 2.2", () => {
    const text = "1.0 Introduction\nThis project asks you to build an app.\n2.0 Tasks\n2.1 Interview five users\n2.2 Build the app\n2.3 Write the report\n3.0 Submission\n3.1 Submit through Moodle.";
    expect(rows(text).tasks?.map((t) => t[0])).toEqual(["Interview five users", "Build the app", "Write the report"]);
  });

  it("caps a very long list at 50 tasks", () => {
    const text = Array.from({ length: 80 }, (_, i) => `- Task ${i + 1}`).join("\n");
    expect(rows(text).tasks).toHaveLength(50);
  });
});

describe("typed descriptions (「打字描述」)", () => {
  const typed = (text: string) => {
    const r = parseBriefWithRules(text, { typed: true });
    return r.ok ? { method: r.method, tasks: r.tasks.map((t): Row => [t.title, t.weight, t.kind]) } : { reason: r.reason };
  };

  it("makes every typed line a task, numbered or not", () => {
    expect(typed("做一个订餐网站\n写使用说明书\n  做 PPT 上台展示  \n\n每周开一次组会")).toEqual({
      method: "LIST",
      tasks: [
        ["做一个订餐网站", 1, "CODE"],
        ["写使用说明书", 1, "DOC"],
        ["做 PPT 上台展示", 1, "DESIGN"],
        ["每周开一次组会", 1, "MEETING"],
      ],
    });
    expect(typed("Build the booking app\r\nInterview 10 students\r\nRecord the demo video").tasks?.map((t) => t[0])).toEqual([
      "Build the booking app",
      "Interview 10 students",
      "Record the demo video",
    ]);
  });

  it("does the same only for typed text, not for uploaded files", () => {
    expect(rows("做一个订餐网站\n写使用说明书\n做 PPT 上台展示")).toEqual({ reason: "NO_STRUCTURE" });
  });

  it("counts only real line breaks: a long line the screen wraps is still one task", () => {
    const long = "Build a booking app for the campus cafe with a menu page, a cart and an order history page for students";
    expect(typed(`${long}\nWrite the report`).tasks?.map((t) => t[0])).toEqual([long, "Write the report"]);
  });

  it("names the task after the first sentence of its line", () => {
    expect(typed("Build the app. It needs a login page.\nWrite the report").tasks?.map((t) => t[0])).toEqual(["Build the app", "Write the report"]);
  });

  it("skips paragraph-long lines and needs two tasks", () => {
    const paragraph = "我们要写一份市场营销报告，".repeat(20);
    expect(paragraph.length).toBeGreaterThan(TYPED_PARAGRAPH_CHARS);
    expect(typed(`${paragraph}\n做问卷\n写报告`).tasks?.map((t) => t[0])).toEqual(["做问卷", "写报告"]);
    expect(typed(`${paragraph}\n做问卷`)).toEqual({ reason: "NO_STRUCTURE" });
    expect(typed("做一个订餐网站")).toEqual({ reason: "NO_STRUCTURE" });
    expect(typed("  \n\n ")).toEqual({ reason: "EMPTY" });
  });

  it("keeps every typed line, even next to a numbered or bulleted list", () => {
    const titles = (text: string) => typed(text).tasks?.map((t) => t[0]);
    expect(titles("1. 做网站\n2. 写报告\n做PPT")).toEqual(["做网站", "写报告", "做PPT"]);
    expect(titles("做网站\n写报告\n- 做PPT\n- 做海报")).toEqual(["做网站", "写报告", "做PPT", "做海报"]);
    expect(titles("a) website\nb) report\nposter")).toEqual(["Website", "Report", "Poster"]);
    // Enter starts a new task even in the middle of a sentence.
    expect(titles("1. Build the website and\nwrite the user guide\n2. Make slides")).toEqual([
      "Build the website and",
      "Write the user guide",
      "Make slides",
    ]);
  });

  it("skips lead-in lines and lines with no name", () => {
    const titles = (text: string) => typed(text).tasks?.map((t) => t[0]);
    const fixtureTitles = (name: string) => (EXPECTED[name] as { tasks: Row[] }).tasks.map((t) => t[0]);
    expect(titles("要做的事：\n做网站\n写报告")).toEqual(["做网站", "写报告"]);
    expect(titles(brief("en-typed-bullets.txt"))).toEqual(fixtureTitles("en-typed-bullets.txt"));
    expect(titles("3.\n做网站\n•\n写报告\n-\n20%")).toEqual(["做网站", "写报告"]);
    // A single typed line with numbers in it is still read as a list.
    expect(titles(brief("zh-typed-inline-numbered.txt"))).toEqual(fixtureTitles("zh-typed-inline-numbered.txt"));
  });

  it("still prefers scores when the text has them", () => {
    expect(typed("书面报告 40%\n口头报告 30%\n问卷调查 30%").method).toBe("SCORES");
    expect(typed("要做的事：\n1. 做网站\n2. 写报告").tasks?.map((t) => t[0])).toEqual(["做网站", "写报告"]);
    // Scores that don't make a mark sheet are dropped from the names; every line weighs the same.
    expect(typed("Report (20 marks)\nSlides (19 marks)")).toEqual({
      method: "LIST",
      tasks: [
        ["Report", 1, "DOC"],
        ["Slides", 1, "DESIGN"],
      ],
    });
  });

  it("caps a very long typed list at 50 tasks", () => {
    expect(typed(Array.from({ length: 70 }, (_, i) => `Task ${i + 1}`).join("\n")).tasks).toHaveLength(50);
  });
});

describe("what is not a scored item", () => {
  it("ignores late penalties, grade scales and totals (en)", () => {
    const text = [
      "1. Report (50%)",
      "2. Poster (50%)",
      "Late submission: 10% will be deducted per day.",
      "Turnitin similarity must be below 25%.",
      "A: 80% - 100%",
      "B: 65 - 79%",
      "Distinction for 85% and above",
      "Total 100%",
    ].join("\n");
    expect(rows(text).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Report", 50],
      ["Poster", 50],
    ]);
  });

  it("ignores late penalties, grade scales and totals (zh)", () => {
    const text = "1. 报告（60 分）\n2. 海报（40 分）\n迟交每天扣 5 分\n查重率不得高于 20%\nA 80–100 分\n85 分以上为优秀\n合计 100 分";
    expect(rows(text).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["报告", 60],
      ["海报", 40],
    ]);
  });

  it("does not read minutes or grouping as points", () => {
    expect(rows("1、口头报告 10 分钟\n2、分组讨论\n3、写报告").method).toBe("LIST");
  });

  it("reads a mark sheet that adds up exactly to the stated total, whatever the total", () => {
    const sheet = (text: string) => rows(text).tasks?.map((t) => [t[0], t[1]]);
    expect(rows("1. Report (20 marks)\n2. Slides (10 marks)\nTotal 30 marks").method).toBe("SCORES");
    expect(sheet("1. Report (20 marks)\n2. Slides (10 marks)\nTotal 30 marks")).toEqual([
      ["Report", 20],
      ["Slides", 10],
    ]);
    expect(sheet("Report 20 marks\nSlides 10 marks\nTotal: 30 marks")).toEqual([
      ["Report", 20],
      ["Slides", 10],
    ]);
    expect(sheet("1. 报告（20 分）\n2. 演示（10 分）\n合计 30 分")).toEqual([
      ["报告", 20],
      ["演示", 10],
    ]);
    expect(sheet("报告 18 分\n海报 12 分\n总分 30 分")).toEqual([
      ["报告", 18],
      ["海报", 12],
    ]);
    // Up to 160 without a total was already fine; a stated total of 200 is too.
    expect(sheet("Proposal 50 marks\nApp 120 marks\nDemo 30 marks\nTotal 200 marks")).toEqual([
      ["Proposal", 50],
      ["App", 120],
      ["Demo", 30],
    ]);
  });

  it("reads a total stated in a sentence or a heading, whatever the total", () => {
    const sheet = (text: string) => rows(text).tasks?.map((t) => [t[0], t[1]]);
    expect(sheet("本作业满分 30 分：\n1. 报告 20 分\n2. 演示 10 分")).toEqual([
      ["报告", 20],
      ["演示", 10],
    ]);
    expect(sheet("This assignment carries 30 marks.\n1. Report (20 marks)\n2. Slides (10 marks)")).toEqual([
      ["Report", 20],
      ["Slides", 10],
    ]);
    expect(sheet("1. Group project (30%)\n   a) Proposal 5%\n   b) Report 15%\n   c) Slides 10%")).toEqual([
      ["Proposal", 5],
      ["Report", 15],
      ["Slides", 10],
    ]);
    // A first item that equals the rest only by chance is one of them.
    expect(sheet("1. Report 20 marks\n2. Slides 10 marks\n3. Video 10 marks")).toEqual([
      ["Report", 20],
      ["Slides", 10],
      ["Video", 10],
    ]);
    // A course weight that part of the sheet happens to add up to doesn't cut the sheet.
    expect(sheet("This project is worth 30% of your final grade.\n1. Report 20%\n2. Slides 10%\n3. Video 50%")).toEqual([
      ["Report", 20],
      ["Slides", 10],
      ["Video", 50],
    ]);
  });

  it("still ignores penalties and grade scales next to a small stated total", () => {
    const en = "1. Report (20 marks)\n2. Slides (10 marks)\nLate submission: 5 marks deducted per day.\nA: 25-30 marks\nPass mark 15 marks\nTotal 30 marks";
    expect(rows(en).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Report", 20],
      ["Slides", 10],
    ]);
    const zh = "1. 报告（20 分）\n2. 演示（10 分）\n迟交每天扣 2 分\n优秀：27 分\n良好：24 分\n合计 30 分";
    expect(rows(zh).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["报告", 20],
      ["演示", 10],
    ]);
  });

  it("needs the items to hit a small stated total exactly", () => {
    expect(rows("1. Report (20 marks)\n2. Slides (5 marks)\nTotal 30 marks").method).toBe("LIST");
    // "Group Project (30%)" is the course weight, not a stated total; "Total 30%" is.
    expect(rows("Group Project (30%)\n1. Proposal (5%)\n2. Report (15%)\n3. Presentation (10%)\nTotal 30%").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Proposal", 5],
      ["Report", 15],
      ["Presentation", 10],
    ]);
  });

  it("does not take a subtotal for the total", () => {
    const text = "Part A\n1. Content (10 marks)\n2. Format (5 marks)\nSubtotal 15 marks\nPart B\n3. Code (60 marks)\n4. Demo (25 marks)\nTotal 100 marks";
    expect(rows(text).tasks?.map((t) => t[1])).toEqual([10, 5, 60, 25]);
  });

  it("drops a course-weight heading that equals its own breakdown", () => {
    // The heading states the total: 5 + 15 + 10 = 30 counts even though it is outside 40–160.
    expect(rows("Group Project (30%)\n1. Proposal (5%)\n2. Report (15%)\n3. Presentation (10%)")).toEqual({
      method: "SCORES",
      tasks: [
        ["Proposal", 5, "DOC"],
        ["Report", 15, "DOC"],
        ["Presentation", 10, "DESIGN"],
      ],
    });
  });

  const TASKS_EN = "Tasks:\n1. Build the mobile app\n2. Write the final report\n3. Give a presentation\n\n";
  it.each([
    ["letter grades", "Grading:\nA 80%\nB 70%\nC 60%\nD 50%"],
    ["pass marks", "Pass mark 50%\nDistinction 75%"],
    ["a schedule", "Week 6: 50%\nWeek 12: 100%"],
    ["survey results", "Survey results:\nYes 55%\nNo 45%"],
    ["a budget", "Budget:\nPrinting 40%\nTransport 60%"],
    ["quality criteria", "Marking criteria:\nContent 40%\nOrganisation 30%\nLanguage 30%"],
  ])("keeps the task list over %s (en)", (_, extra) => {
    expect(rows(TASKS_EN + extra)).toEqual({
      method: "LIST",
      tasks: [
        ["Build the mobile app", 1, "CODE"],
        ["Write the final report", 1, "DOC"],
        ["Give a presentation", 1, "DESIGN"],
      ],
    });
  });

  it.each([
    ["on separate lines", "任务：\n1. 开发小程序\n2. 撰写报告\n3. 上台汇报\n\n成绩评定：\n优秀：85分\n良好：75分\n及格：60分"],
    ["typed on one line", "任务：1. 开发小程序 2. 撰写报告 3. 上台汇报\n成绩评定：优秀：85分 / 良好：75分 / 及格：60分"],
    ["under a grade heading", "任务：\n1. 开发小程序\n2. 撰写报告\n3. 上台汇报\n\n三、成绩等级\n最高档 85 分\n中间档 70 分"],
  ])("keeps the task list over a grade scale (zh, %s)", (_, text) => {
    expect(rows(text)).toEqual({
      method: "LIST",
      tasks: [
        ["开发小程序", 1, "CODE"],
        ["撰写报告", 1, "DOC"],
        ["上台汇报", 1, "DESIGN"],
      ],
    });
  });

  it("does not read a grade scale on its own as a mark sheet", () => {
    expect(rows("A+ 90%\nA 80%\nB 70%")).toEqual({ reason: "NO_STRUCTURE" });
    expect(rows("Grade boundaries:\nHigh achievement 80%\nSound achievement 60%")).toEqual({ reason: "NO_STRUCTURE" });
    expect(rows("成绩等级：最高档 85 分，中间档 70 分")).toEqual({ reason: "NO_STRUCTURE" });
  });

  it("still reads real mark sheets next to a task list", () => {
    // Bare "Grading" also heads real mark sheets.
    expect(rows("Grading:\nReport 60%\nPresentation 40%").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Report", 60],
      ["Presentation", 40],
    ]);
    expect(rows(`${TASKS_EN}Marking scheme:\nApp 60 marks\nReport 40 marks`).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["App", 60],
      ["Report", 40],
    ]);
    // Weights that don't reach 100 but name the listed items.
    expect(rows("Deliverables:\n- Report\n- Poster\n\nWeightage:\nReport 60 marks\nPoster 30 marks").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Report", 60],
      ["Poster", 30],
    ]);
  });

  it("prefers the deliverables over a report rubric that also adds up", () => {
    const text = "Deliverables:\n1. Report (60%)\n2. Presentation (40%)\n\nReport rubric:\nContent 40%\nOrganisation 30%\nLanguage 30%";
    expect(rows(text).tasks?.map((t) => t[0])).toEqual(["Report", "Presentation"]);
  });
});

describe("scored item formats", () => {
  it.each([
    ["a table with a Weightage (%) column", "| No | Component | Weightage (%) | CLO |\n| 1 | Proposal | 20 | CLO1 |\n| 2 | Prototype | 50 | CLO2 |\n| 3 | Demo | 30 | CLO3 |\n| | Total | 100 | |"],
    ["label lines under headings", "Proposal\nMarks: 20\n\nPrototype\nWeightage: 50%\n\nDemo\n(30 marks)"],
    ["inline, in one sentence", "The project has three parts: a proposal (20 marks); a prototype (50 marks); and a demo (30 marks)."],
    ["weights first", "20% Proposal\n50% Prototype\n30% Demo"],
    ["markdown", "## Deliverables\n1. **Proposal** (20%)\n2. **Prototype** (50%)\n3. **Demo** (30%)"],
    ["Part A / B / C", "Part A: Proposal (20 marks)\nPart B – Prototype [50 marks]\nPart C. Demo (30 marks)"],
    ["dot leaders", "Proposal ........ 20 marks\nPrototype ....... 50 marks\nDemo ............ 30 marks"],
    ["worth / weightage words", "- Proposal, worth 20%\n- Prototype – weightage 50%\n- Demo (Weightage: 30%)"],
  ])("%s", (_, text) => {
    expect(rows(text).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Proposal", 20],
      ["Prototype", 50],
      ["Demo", 30],
    ]);
  });

  it.each([
    ["占 N 分", "1. 需求分析，占 20 分\n2. 系统实现，占 50 分\n3. 答辩，占 30 分"],
    ["（N 分）", "一、需求分析（20 分）\n二、系统实现（50 分）\n三、答辩（30 分）"],
    ["第N部分", "第一部分：需求分析（20分）\n第二部分：系统实现（50分）\n第三部分：答辩（30分）"],
    ["typed on one line", "需求分析 20 分，系统实现 50 分，答辩 30 分"],
    ["占比 %", "1、需求分析 占比 20%\n2、系统实现 占比 50%\n3、答辩 占比 30%"],
  ])("zh: %s", (_, text) => {
    expect(rows(text).tasks).toEqual([
      ["需求分析", 20, "DOC"],
      ["系统实现", 50, "CODE"],
      ["答辩", 30, "DESIGN"],
    ]);
  });

  it.each([
    ["、", "报告 40%、演示 30%、同伴互评 30%"],
    ["、 and 和", "评分：报告 40%、演示 30% 和 同伴互评 30%"],
  ])("zh: items typed on one line separated by %s", (_, text) => {
    expect(rows(text).tasks).toEqual([
      ["报告", 40, "DOC"],
      ["演示", 30, "DESIGN"],
      ["同伴互评", 30, "DOC"],
    ]);
  });

  it("splits one-line sheets joined by 'and' / 和 / '/'", () => {
    expect(rows("Report 40%, presentation 30% and peer review 30%.").tasks).toEqual([
      ["Report", 40, "DOC"],
      ["Presentation", 30, "DESIGN"],
      ["Peer review", 30, "DOC"],
    ]);
    expect(rows("报告40分，演示30分和会议记录30分。").tasks).toEqual([
      ["报告", 40, "DOC"],
      ["演示", 30, "DESIGN"],
      ["会议记录", 30, "MEETING"],
    ]);
    expect(rows("Proposal 20% / Prototype 50% / Demo 30%").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Proposal", 20],
      ["Prototype", 50],
      ["Demo", 30],
    ]);
    expect(rows("The group report is worth 60% and the presentation is worth 40%.").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Group report", 60],
      ["Presentation", 40],
    ]);
  });

  it("drops schedules in front of the names", () => {
    expect(rows("Week 5 - Proposal (10%)\nWeek 9 - Prototype demo (30%)\nWeek 14 - Final report (60%)").tasks?.map((t) => t[0])).toEqual([
      "Proposal",
      "Prototype demo",
      "Final report",
    ]);
    expect(rows("Timeline:\n1. 15 Oct 2026 - Proposal\n2. 30 Oct 2026 - Prototype\n3. 20 Nov 2026 - Final report").tasks?.map((t) => t[0])).toEqual([
      "Proposal",
      "Prototype",
      "Final report",
    ]);
    expect(rows("第5周：提交选题报告（20分）\n第10周：完成系统（50分）\n第14周：答辩（30分）").tasks?.map((t) => t[0])).toEqual([
      "提交选题报告",
      "完成系统",
      "答辩",
    ]);
  });

  it("reads 'score out of weight' as the weight", () => {
    expect(rows("Part A: 20/40 marks\nPart B: 30/60 marks").tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Part A", 40],
      ["Part B", 60],
    ]);
  });

  it("names a bare 'Question 1 (20 marks)' after what it asks", () => {
    const text = "Question 1 (20 marks)\nExplain the 4Ps of marketing.\nQuestion 2 (30 marks)\nAnalyse a local brand.\nQuestion 3 (50 marks)";
    expect(rows(text).tasks?.map((t) => [t[0], t[1]])).toEqual([
      ["Question 1: Explain the 4Ps of marketing", 20],
      ["Question 2: Analyse a local brand", 30],
      ["Question 3", 50],
    ]);
    expect(rows("第一题（40分）\n分析一个本地品牌。\n第二题（60分）\n设计一个推广活动。").tasks?.map((t) => t[0])).toEqual([
      "第一题：分析一个本地品牌",
      "第二题：设计一个推广活动",
    ]);
  });

  it("keeps the item and drops its sub-criteria", () => {
    const text = "一、书面报告（40 分）\n1. 内容完整（20 分）\n2. 格式规范（10 分）\n3. 语言表达（10 分）\n二、口头报告（30 分）\n三、问卷调查（30 分）";
    expect(rows(text).tasks?.map((t) => t[0])).toEqual(["书面报告", "口头报告", "问卷调查"]);
  });

  it("joins a weight that a PDF wrapped onto the next line", () => {
    const text = "a) System Analysis and Design Report, including use case diagrams and\n   class diagrams (25%)\nb) Prototype (45%)\nc) Presentation (30%)";
    expect(rows(text).tasks?.[0]).toEqual(["System Analysis and Design Report, including use case diagrams and class diagrams", 25, "DOC"]);
  });
});

describe("cleanTitle", () => {
  it.each([
    ["a) Project Proposal (10%) – due Week 4", "Project Proposal"],
    ["1. 书面报告（占 40 分）", "书面报告"],
    ["Written report – worth 40 marks", "Written report"],
    ["• Poster [Weightage: 20%]", "Poster"],
    ["(iii) Final report (Due: Week 14)", "Final report"],
    ["第一部分：需求分析", "需求分析"],
    ["**Demo video** ....... 30 marks", "Demo video"],
    ["1、选题策划书，占 15%，第 4 周提交。", "选题策划书"],
    ["Task 2: build the prototype.", "Build the prototype"],
    ["Credit score analysis", "Credit score analysis"],
    ["Report (3000 words)", "Report (3000 words)"],
    ["Week 5 - Proposal", "Proposal"],
    ["Weeks 1-4: Literature review", "Literature review"],
    ["15 Oct 2026 - Proposal", "Proposal"],
    ["2026-10-15: Prototype", "Prototype"],
    ["Done by Week 4: Proposal (20%)", "Proposal"],
    ["10月15日 - 提案", "提案"],
    ["Week 5 reflection", "Week 5 reflection"],
  ])("%s → %s", (input, output) => {
    expect(cleanTitle(input)).toBe(output);
  });

  it("cuts titles to 120 characters", () => {
    const long = `1. ${"Develop the booking module ".repeat(12)}(30%)`;
    expect([...cleanTitle(long)].length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    const r = parseBriefWithRules(`- ${"字".repeat(300)}\n- 写报告`);
    expect(r.ok && [...r.tasks[0]!.title].length).toBe(MAX_TITLE_CHARS);
  });
});

describe("guessKind", () => {
  const cases: [TaskKind, string[]][] = [
    ["CODE", ["写代码", "编程练习", "程序", "系统", "开发", "网站", "App", "应用", "数据库", "Implement the login", "Develop the backend", "Code review fixes", "Program", "System", "Website", "Mobile app", "REST API", "Database", "Prototype"]],
    ["RESEARCH", ["市场调研", "调查", "问卷", "访谈", "研究", "文献", "收集资料", "Research", "Survey", "Interview", "Literature", "Questionnaire", "Data collection"]],
    ["DESIGN", ["设计", "海报", "PPT", "幻灯片", "演示文稿", "视频", "UI", "Poster", "Design", "Slides", "Video", "Mockup"]],
    ["MEETING", ["会议", "开会", "组会", "小组讨论", "Meeting", "Meeting minutes"]],
    ["DESIGN", ["演示", "口头报告", "Pitch", "Presentation", "Oral presentation (20 minutes)"]],
    ["DOC", ["书面报告", "Final report", "Peer evaluation", "", "结果与讨论"]],
  ];
  for (const [kind, titles] of cases) {
    it.each(titles)(`%s → ${kind}`, (title) => expect(guessKind(title)).toBe(kind));
  }

  it.each([
    ["System Analysis and Design Report", "DOC"],
    ["问卷设计与分析", "RESEARCH"],
    ["Survey report", "RESEARCH"],
    ["Write a report on the survey results", "DOC"],
    ["Design and develop a website", "CODE"],
    ["网站的用户界面设计", "DESIGN"],
    ["Prepare a 10-minute presentation with slides", "DESIGN"],
    ["Keep minutes of every group meeting", "MEETING"],
    ["Develop the website using PHP and MySQL", "CODE"],
  ] as [string, TaskKind][])("%s → %s", (title, kind) => expect(guessKind(title)).toBe(kind));
});

describe("robustness", () => {
  // Small deterministic PRNG so failures reproduce.
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const parts = ["1.", "a)", "(i)", "一、", "•", "-", "%", "分", "分钟", "marks", "40", "100", "12.5", "(", ")", "（", "）", "\n", "\n\n", "  ", "\t", "|", "Total", "合计", "late", "迟交", "Report", "报告", "🎉", "\u0000", "\uF0B7", "第", "部分", ":", "：", "80-100", "A+", "Q1", "Part B", "占"];

  it("never throws and always returns a well-formed result", () => {
    const next = rng(42);
    for (let n = 0; n < 400; n++) {
      const text = Array.from({ length: Math.floor(next() * 60) }, () => parts[Math.floor(next() * parts.length)]).join(" ");
      const r = parseBriefWithRules(text);
      if (r.ok) {
        expect(r.tasks.length).toBeGreaterThanOrEqual(2);
        for (const t of r.tasks) {
          expect(t.title.trim()).not.toBe("");
          expect([...t.title].length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
          expect(t.weight).toBeGreaterThan(0);
        }
      } else expect(["NO_STRUCTURE", "EMPTY"]).toContain(r.reason);
    }
  });

  it("handles odd input types and very large input", () => {
    expect(parseBriefWithRules(undefined as unknown as string)).toEqual({ ok: false, reason: "EMPTY" });
    const huge = `${"Lorem ipsum 12% dolor sit amet. ".repeat(40_000)}\n1. Report (50%)\n2. Poster (50%)`;
    const started = Date.now();
    const r = parseBriefWithRules(huge);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(["NO_STRUCTURE", "EMPTY"].includes((r as { reason?: string }).reason ?? "") || r.ok).toBe(true);
    const manyWeights = Array.from({ length: 2000 }, (_, i) => `Item ${i} (${(i % 9) + 1}%)`).join("\n");
    expect(() => parseBriefWithRules(manyWeights)).not.toThrow();
  });
});

describe("dates", () => {
  const KL = "Asia/Kuala_Lumpur";

  it("validates time zones", () => {
    expect(isValidTimeZone(KL)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    // Intl takes offsets too, but they are not IANA zones (and Postgres reads their sign the other way).
    for (const offset of ["+08:00", "-0500", "UTC+8"]) expect(isValidTimeZone(offset), offset).toBe(false);
  });

  it("stores zone names in their IANA spelling", () => {
    expect(canonicalTimeZone("asia/kuala_lumpur")).toBe(KL);
    expect(canonicalTimeZone("utc")).toBe("UTC");
    expect(canonicalTimeZone(KL)).toBe(KL);
    expect(canonicalTimeZone("Asia/Calcutta")).toBe("Asia/Calcutta");
    expect(canonicalTimeZone("Etc/GMT+8")).toBe("Etc/GMT+8");
    expect(canonicalTimeZone("+08:00")).toBeNull();
  });

  it("converts wall-clock times in a zone", () => {
    expect(zonedTime(2026, 10, 1, 23, 59, KL).toISOString()).toBe("2026-10-01T15:59:00.000Z");
    expect(endOfLocalDay("2026-10-01", KL).toISOString()).toBe("2026-10-01T15:59:00.000Z");
    expect(localDate(new Date("2026-09-30T16:30:00Z"), KL)).toBe("2026-10-01");
    expect(localDate(new Date("2026-09-30T15:30:00Z"), KL)).toBe("2026-09-30");
  });

  it("handles daylight saving time", () => {
    const NY = "America/New_York";
    expect(endOfLocalDay("2026-03-08", NY).toISOString()).toBe("2026-03-09T03:59:00.000Z");
    expect(endOfLocalDay("2026-11-01", NY).toISOString()).toBe("2026-11-02T04:59:00.000Z");
    expect(endOfLocalDay("2026-07-01", NY).toISOString()).toBe("2026-07-02T03:59:00.000Z");
    // 02:30 does not exist on 8 March 2026 in New York: it lands just after the gap.
    expect(wallClock(zonedTime(2026, 3, 8, 2, 30, NY), NY)).toMatchObject({ hour: 3, minute: 30 });
  });

  it("reads date-only inputs as 23:59 in the zone", () => {
    expect(toInstant("2026-10-01", KL).toISOString()).toBe("2026-10-01T15:59:00.000Z");
    expect(toInstant("2026-10-01T10:00:00.000Z", KL).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("spreads due dates evenly to 23:59 local, the last one at the deadline", () => {
    const start = new Date("2026-09-30T16:00:00Z"); // 1 Oct 00:00 in KL
    const deadline = new Date("2026-10-11T15:59:00Z"); // 11 Oct 23:59 in KL
    expect(spreadDueDates(2, start, deadline, KL).map((d) => d.toISOString())).toEqual(["2026-10-06T15:59:00.000Z", deadline.toISOString()]);

    const dues = spreadDueDates(7, new Date("2026-09-19T02:00:00Z"), new Date("2026-11-06T10:00:00Z"), KL);
    expect(dues).toHaveLength(7);
    expect(dues[6]!.toISOString()).toBe("2026-11-06T10:00:00.000Z");
    for (let i = 0; i < 6; i++) {
      expect(wallClock(dues[i]!, KL)).toMatchObject({ hour: 23, minute: 59 });
      expect(dues[i]!.getTime()).toBeLessThanOrEqual(dues[i + 1]!.getTime());
    }
  });

  it("never puts a due date after the deadline", () => {
    const start = new Date("2026-10-01T16:00:00Z"); // 2 Oct 00:00 in KL
    const deadline = new Date("2026-10-02T04:00:00Z"); // 2 Oct 12:00 in KL
    expect(spreadDueDates(3, start, deadline, KL)).toEqual([deadline, deadline, deadline]);
    expect(spreadDueDates(2, deadline, start, KL)).toEqual([start, start]);
    expect(spreadDueDates(1, start, deadline, KL)).toEqual([deadline]);
    expect(spreadDueDates(0, start, deadline, KL)).toEqual([]);
  });
});
