// A11: an active project's points always add up to exactly 1000 (100 分), whatever the leader adds or edits.
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectView } from "../../shared/types";
import { AppError } from "../src/lib/errors";
import { assertPointsTotal, TOTAL_POINTS } from "../src/services/tx";
import { call, testDb } from "./helpers";
import { createActive, freshDb, login } from "./project-fixtures";

const total = async (projectId: string) =>
  (await testDb.task.aggregate({ where: { projectId }, _sum: { points: true } }))._sum.points ?? 0;

/** A small deterministic PRNG (mulberry32), so a failing sequence can be replayed from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("points always sum to 1000", () => {
  let token: string;
  beforeEach(async () => {
    await freshDb();
    token = (await login(0)).token;
  });

  it("refuses a points edit on a project's only task (ONLY_TASK_POINTS) and keeps its 100 分", async () => {
    const view = await createActive(token, { teamSize: 2, tasks: [{ title: "唯一的任务", kind: "DOC", points: 100 }] });
    const only = view.tasks[0]!;
    expect(only.points).toBe(1000);
    const res = await call(`/api/projects/${view.basics.id}/tasks/${only.id}`, { method: "PATCH", token, body: { points: 400 } });
    expect([res.status, res.error?.code]).toEqual([409, "ONLY_TASK_POINTS"]);
    expect(await total(view.basics.id)).toBe(1000);
    // Other edits of the only task still work.
    const renamed = await call(`/api/projects/${view.basics.id}/tasks/${only.id}`, { method: "PATCH", token, body: { title: "改名" } });
    expect(renamed.status).toBe(200);
  });

  it("keeps 1000 through random sequences of adds and points edits", async () => {
    for (const seed of [1, 2, 3]) {
      const random = rng(seed);
      const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
      const start = Array.from({ length: int(1, 4) }, (_, i) => ({ title: `任务 ${i + 1}`, kind: "DOC" as const, points: int(1, 500) }));
      const view = await createActive(token, { teamSize: 3, tasks: start });
      const projectId = view.basics.id;
      expect(await total(projectId)).toBe(TOTAL_POINTS);

      for (let step = 0; step < 12; step++) {
        const tasks = (await call<ProjectView>(`/api/projects/${projectId}`, { token })).data.tasks;
        if (tasks.length < 2 || random() < 0.4) {
          const res = await call(`/api/projects/${projectId}/tasks`, {
            method: "POST",
            token,
            body: { title: `加的任务 ${step}`, kind: "CODE", points: int(1, 999) },
          });
          expect(res.status, `seed ${seed} step ${step} add`).toBe(201);
        } else {
          const target = tasks[int(0, tasks.length - 1)]!;
          const res = await call(`/api/projects/${projectId}/tasks/${target.id}`, {
            method: "PATCH",
            token,
            body: { points: int(1, 999) },
          });
          expect(res.status, `seed ${seed} step ${step} edit`).toBe(200);
        }
        expect(await total(projectId), `seed ${seed} step ${step}`).toBe(TOTAL_POINTS);
      }
    }
  });

  it("rolls a write back when the total would be wrong (assertPointsTotal)", async () => {
    const view = await createActive(token, { teamSize: 2 });
    const projectId = view.basics.id;
    const first = view.tasks[0]!;
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.task.update({ where: { id: first.id }, data: { points: first.points + 1 } });
        await assertPointsTotal(tx, projectId);
      }),
    ).rejects.toMatchObject({ status: 500, code: "INTERNAL" } satisfies Partial<AppError>);
    // Nothing was saved.
    expect((await testDb.task.findUniqueOrThrow({ where: { id: first.id } })).points).toBe(first.points);
    expect(await total(projectId)).toBe(TOTAL_POINTS);
  });
});
