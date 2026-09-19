// The pure M3 package rules (spec §2) that every service shares.
import { describe, expect, it } from "vitest";
import type { Grade, TaskStatus } from "../../shared/types";
import {
  earnedPoints,
  isFinished,
  isLocked,
  isOverdue,
  lightestPackage,
  needsPackage,
  packageStarted,
  releaseTaskData,
  resplitRange,
} from "../src/lib/package-state";

type TaskRow = {
  packageId: string | null;
  ownerId: string | null;
  status: TaskStatus;
  grade: Grade | null;
  startedAt: Date | null;
  startedById: string | null;
  points: number;
};

const active = { leftAt: null, removed: false };
const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  packageId: "p1",
  ownerId: null,
  status: "TODO",
  grade: null,
  startedAt: null,
  startedById: null,
  points: 100,
  ...over,
});

describe("task state", () => {
  it("counts DONE and HALF as finished, and any task whose grade isn't FAIL (M4)", () => {
    const all: TaskStatus[] = ["TODO", "DOING", "REVIEWING", "DONE", "HALF", "FAIL"];
    expect(all.filter((status) => isFinished({ status, grade: null }))).toEqual(["DONE", "HALF"]);
    // A HALF task resubmitted shows REVIEWING but keeps its HALF grade: still finished.
    expect(isFinished({ status: "REVIEWING", grade: "HALF" })).toBe(true);
    expect(isFinished({ status: "REVIEWING", grade: "FAIL" })).toBe(false);
    expect(isFinished({ status: "REVIEWING", grade: null })).toBe(false);
    expect(isFinished({ status: "DONE", grade: "SELF" })).toBe(true);
  });

  it("locks a task once it left TODO or was started", () => {
    expect(isLocked(task())).toBe(false);
    expect(isLocked(task({ startedAt: new Date() }))).toBe(true);
    expect(isLocked(task({ status: "REVIEWING" }))).toBe(true);
    expect(isLocked(task({ status: "DONE" }))).toBe(true);
  });

  it("earns by grade: all for a full grade, half (rounded) for HALF, nothing otherwise", () => {
    for (const grade of ["EXCELLENT", "PASS", "SELF"] as const) expect(earnedPoints({ grade, points: 125 })).toBe(125);
    expect(earnedPoints({ grade: "HALF", points: 125 })).toBe(63);
    expect(earnedPoints({ grade: "HALF", points: 124 })).toBe(62);
    expect(earnedPoints({ grade: "FAIL", points: 125 })).toBe(0);
    expect(earnedPoints({ grade: null, points: 125 })).toBe(0);
  });

  it("is overdue when unfinished past its due date, or past the deadline without one", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const project = { deadline: new Date("2026-10-09T00:00:00Z") };
    const later = { deadline: new Date("2026-12-01T00:00:00Z") };
    const past = new Date("2026-10-01T00:00:00Z");
    expect(isOverdue({ status: "TODO", grade: null, dueAt: null }, project, now)).toBe(true);
    expect(isOverdue({ status: "TODO", grade: null, dueAt: null }, later, now)).toBe(false);
    expect(isOverdue({ status: "DOING", grade: null, dueAt: past }, later, now)).toBe(true);
    expect(isOverdue({ status: "HALF", grade: "HALF", dueAt: past }, later, now)).toBe(false);
    expect(isOverdue({ status: "FAIL", grade: "FAIL", dueAt: past }, later, now)).toBe(true);
    expect(isOverdue({ status: "TODO", grade: null, dueAt: now }, later, now)).toBe(false);
    // 等组长审核 is never on the overdue list (M4).
    expect(isOverdue({ status: "REVIEWING", grade: null, dueAt: past }, later, now)).toBe(false);
  });

  it("releases a task: no owner, not started, DOING back to TODO, REVIEWING/FAIL kept", () => {
    expect(releaseTaskData({ status: "DOING" })).toEqual({ ownerId: null, startedAt: null, startedById: null, status: "TODO" });
    expect(releaseTaskData({ status: "REVIEWING" })).toEqual({ ownerId: null, startedAt: null, startedById: null });
    expect(releaseTaskData({ status: "FAIL" })).toEqual({ ownerId: null, startedAt: null, startedById: null });
  });
});

describe("packages", () => {
  it("is started only through its owner's own start", () => {
    const pkg = { id: "p1", ownerId: "m1" };
    expect(packageStarted(pkg, [task()])).toBe(false);
    expect(packageStarted(pkg, [task({ startedAt: new Date(), startedById: "m1", status: "DOING" })])).toBe(true);
    expect(packageStarted(pkg, [task({ status: "DONE", startedById: "m1" })])).toBe(true);
    // Someone else started it (moved in, or left in a free package): not started for m1.
    expect(packageStarted(pkg, [task({ startedAt: new Date(), startedById: "m2", status: "DOING" })])).toBe(false);
    // Another package's task doesn't count; a free package is never started.
    expect(packageStarted(pkg, [task({ packageId: "p2", startedById: "m1", status: "DOING" })])).toBe(false);
    expect(packageStarted({ id: "p1", ownerId: null }, [task({ startedById: null, status: "DOING" })])).toBe(false);
  });

  it("is started when its owner holds a finished task, whoever started it (finishing counts as starting)", () => {
    const pkg = { id: "p1", ownerId: "m1" };
    const startedByM2 = { startedAt: new Date(), startedById: "m2" };
    expect(packageStarted(pkg, [task({ ownerId: "m1", status: "DONE", ...startedByM2 })])).toBe(true);
    expect(packageStarted(pkg, [task({ ownerId: "m1", status: "HALF", ...startedByM2 })])).toBe(true);
    expect(packageStarted(pkg, [task({ ownerId: "m1", status: "DONE" })])).toBe(true);
    // Unfinished work someone else started still isn't the owner's start, even in review.
    expect(packageStarted(pkg, [task({ ownerId: "m1", status: "REVIEWING", ...startedByM2 })])).toBe(false);
    expect(packageStarted(pkg, [task({ ownerId: "m1", status: "FAIL", ...startedByM2 })])).toBe(false);
    // Someone else's finished work, or the owner's finished work in another package, doesn't count.
    expect(packageStarted(pkg, [task({ ownerId: "m2", status: "DONE", ...startedByM2 })])).toBe(false);
    expect(packageStarted(pkg, [task({ packageId: "p2", ownerId: "m1", status: "DONE", ...startedByM2 })])).toBe(false);
  });

  it("picks the lightest package, lowest number on a tie", () => {
    const packages = [
      { id: "a", index: 1 },
      { id: "b", index: 2 },
      { id: "c", index: 3 },
    ];
    const tasks = [task({ packageId: "a", points: 300 }), task({ packageId: "b", points: 200 }), task({ packageId: "c", points: 200 })];
    expect(lightestPackage(packages, tasks)?.id).toBe("b");
    expect(lightestPackage([...packages].reverse(), tasks)?.id).toBe("b");
    expect(lightestPackage(packages, [...tasks, task({ packageId: null, points: 1 })])?.id).toBe("b");
    expect(lightestPackage([...packages, { id: "d", index: 4 }], tasks)?.id).toBe("d");
    expect(lightestPackage([], tasks)).toBeNull();
  });
});

describe("members", () => {
  it("needs a package when active, without one, and not a leader who only manages", () => {
    const member = { role: "MEMBER" as const, ...active };
    const leader = { role: "LEADER" as const, ...active };
    expect(needsPackage(member, { leaderManages: false }, false)).toBe(true);
    expect(needsPackage(member, { leaderManages: false }, true)).toBe(false);
    expect(needsPackage({ ...member, leftAt: new Date() }, { leaderManages: false }, false)).toBe(false);
    expect(needsPackage({ ...member, removed: true }, { leaderManages: false }, false)).toBe(false);
    expect(needsPackage(leader, { leaderManages: false }, false)).toBe(true);
    expect(needsPackage(leader, { leaderManages: true }, false)).toBe(false);
    expect(needsPackage(member, { leaderManages: true }, false)).toBe(true);
  });
});

describe("resplitRange", () => {
  const people = (n: number) => [
    { role: "LEADER" as const, ...active },
    ...Array.from({ length: n - 1 }, () => ({ role: "MEMBER" as const, ...active })),
  ];

  it("needs one package per member who should hold one; at most 8", () => {
    expect(resplitRange({ project: { leaderManages: false }, members: people(3), packages: [], tasks: [] })).toEqual({ min: 3, max: 8 });
    const gone = [...people(3), { role: "MEMBER" as const, leftAt: new Date(), removed: false }];
    expect(resplitRange({ project: { leaderManages: false }, members: gone, packages: [], tasks: [] })).toEqual({ min: 3, max: 8 });
  });

  it("leaves the leader who only manages out; at most 7", () => {
    expect(resplitRange({ project: { leaderManages: true }, members: people(3), packages: [], tasks: [] })).toEqual({ min: 2, max: 7 });
    expect(resplitRange({ project: { leaderManages: true }, members: people(1), packages: [], tasks: [] })).toEqual({ min: 1, max: 7 });
  });

  it("keeps every owned package and every package holding a locked task", () => {
    const packages = [
      { id: "p1", ownerId: "m1" },
      { id: "p2", ownerId: null },
      { id: "p3", ownerId: null },
      { id: "p4", ownerId: null },
    ];
    const tasks = [task({ packageId: "p2", status: "REVIEWING" }), task({ packageId: "p3" })];
    expect(resplitRange({ project: { leaderManages: false }, members: people(1), packages, tasks })).toEqual({ min: 2, max: 8 });
  });
});
