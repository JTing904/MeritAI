import { describe, expect, it } from "vitest";
import { previewBalance } from "../../shared/planning";
import { equalParts, MAX_SPLIT_TASKS, partBase, partTitle, planSplit, splitRows } from "../src/lib/plan/split";

const free = (points: number[]) => points.map((p) => ({ points: p, group: null, splittable: true }));
const after = (points: number[], parts: number[]) => points.flatMap((p, i) => equalParts(p, parts[i]!)).map((p) => ({ points: p, group: null }));

describe("planSplit", () => {
  it("splits the 4 tasks of the mockup until 5 packages come out even", () => {
    const points = [368, 316, 211, 105];
    expect(previewBalance(after(points, [1, 1, 1, 1]), 5).balanced).toBe(false);
    const parts = planSplit(free(points), 5);
    expect(parts).toEqual([4, 3, 2, 1]);
    expect(previewBalance(after(points, parts), 5)).toMatchObject({ emptyPackages: 0, balanced: true });
  });

  it("leaves an even plan alone", () => {
    expect(planSplit(free([400, 300, 200, 100]), 2)).toEqual([1, 1, 1, 1]);
    expect(planSplit(free([200, 200, 200, 200, 200]), 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it("splits one big task into as many parts as packages", () => {
    expect(planSplit(free([1000]), 5)).toEqual([5]);
    expect(planSplit(free([10, 10, 980]), 8)).toEqual([1, 1, 8]);
  });

  it("never splits a started task", () => {
    const parts = planSplit([{ points: 800, group: null, splittable: false }, ...free([100, 100])], 4);
    expect(parts[0]).toBe(1);
  });

  it("stops at 60 tasks and keeps every part at least one tenth", () => {
    const parts = planSplit(free([3, 1, 1]), 8);
    expect(parts).toEqual([3, 1, 1]);
    const many = planSplit(free(Array.from({ length: 59 }, (_, i) => (i === 0 ? 5000 : 1))), 8);
    expect(many.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_SPLIT_TASKS);
  });
});

describe("part titles", () => {
  it("names parts in the project language", () => {
    expect(partTitle("书面报告", 1, 2, "zh")).toBe("书面报告（第 1/2 部分）");
    expect(partTitle("Written report", 2, 3, "en")).toBe("Written report (part 2/3)");
  });

  it("keeps titles within 120 characters", () => {
    expect(partTitle("字".repeat(120), 1, 2, "zh")).toHaveLength(120);
    expect(partTitle("x".repeat(120), 10, 12, "en").endsWith(" (part 10/12)")).toBe(true);
  });

  it("recovers the base title from a part label", () => {
    expect(partBase("书面报告（第 1/2 部分）")).toBe("书面报告");
    expect(partBase("书面报告(第1/2部分)")).toBe("书面报告");
    expect(partBase("Written report (part 3/4)")).toBe("Written report");
    expect(partBase("Written report")).toBeNull();
    expect(partBase("（第 1/2 部分）")).toBeNull();
  });
});

describe("splitRows", () => {
  const tasks = [
    { title: "书面报告", points: 368 },
    { title: "口头报告", points: 316 },
    { title: "问卷调查", points: 211 },
    { title: "小组会议记录", points: 105 },
  ];

  it("puts the parts where the task was, in equal points", () => {
    const rows = splitRows(tasks, [4, 3, 2, 1], "zh");
    expect(rows.map((r) => [r.source, r.first, r.title, r.points])).toEqual([
      [0, true, "书面报告（第 1/4 部分）", 92],
      [0, false, "书面报告（第 2/4 部分）", 92],
      [0, false, "书面报告（第 3/4 部分）", 92],
      [0, false, "书面报告（第 4/4 部分）", 92],
      [1, true, "口头报告（第 1/3 部分）", 106],
      [1, false, "口头报告（第 2/3 部分）", 105],
      [1, false, "口头报告（第 3/3 部分）", 105],
      [2, true, "问卷调查（第 1/2 部分）", 106],
      [2, false, "问卷调查（第 2/2 部分）", 105],
      [3, true, "小组会议记录", 105],
    ]);
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(1000);
  });

  it("numbers again across parts from an earlier split", () => {
    const rows = splitRows(
      [
        { title: "Report (part 1/2)", points: 500 },
        { title: "Slides", points: 100 },
        { title: "Report (part 2/2)", points: 500 },
      ],
      [2, 1, 2],
      "en",
    );
    expect(rows.map((r) => r.title)).toEqual([
      "Report (part 1/4)",
      "Report (part 2/4)",
      "Slides",
      "Report (part 3/4)",
      "Report (part 4/4)",
    ]);
    // Only the part that is split again changes; the other keeps its points but is renumbered.
    const once = splitRows(
      [
        { title: "报告（第 1/2 部分）", points: 500 },
        { title: "报告（第 2/2 部分）", points: 500 },
      ],
      [2, 1],
      "zh",
    );
    expect(once.map((r) => [r.title, r.points])).toEqual([
      ["报告（第 1/3 部分）", 250],
      ["报告（第 2/3 部分）", 250],
      ["报告（第 3/3 部分）", 500],
    ]);
  });
});
