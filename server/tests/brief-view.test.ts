// 作业要求 page data (M4 spec §2, §6): GET /api/projects/:id/brief.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { BriefResult, BriefView, ProjectView, TaskDetail } from "../../shared/types";
import { normalizeBrief } from "../src/lib/plan/rules";
import { call, testDb } from "./helpers";
import { activeWith, createDraft, freshDb, person, upload } from "./project-fixtures";

beforeEach(freshDb);
afterAll(() => testDb.$disconnect());

const FIXTURES = fileURLToPath(new URL("./fixtures/briefs/", import.meta.url));
const brief = (token: string, projectId: string) => call<BriefView>(`/api/projects/${projectId}/brief`, { token });

/** A confirmed project whose plan came from the uploaded brief file `fixture`. */
async function fromFile(fixture: string, teamSize = 3) {
  const leader = await person(0);
  const draft = await createDraft(leader.token, { teamSize });
  const bytes = readFileSync(FIXTURES + fixture);
  const res = await upload(`/api/projects/${draft.basics.id}/brief`, leader.token, new File([bytes], fixture, { type: "text/plain" }));
  if (!(res.data as BriefResult).ok) throw new Error(`brief failed: ${JSON.stringify(res)}`);
  const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token: leader.token })).data;
  return { leader, view, raw: bytes.toString("utf8") };
}

describe("GET /api/projects/:id/brief", () => {
  it("returns the normalized text and, per task, the line range of its item", async () => {
    const { leader, view, raw } = await fromFile("zh-newera-list-sections.txt");
    const res = await brief(leader.token, view.basics.id);
    expect(res.status).toBe(200);
    const b = res.data;
    // The extractor trims the file's last newline.
    expect(b.text).toBe(normalizeBrief(raw).trimEnd());
    expect(b.fileName).toBe("zh-newera-list-sections.txt");
    expect(b.items.map((i) => i.taskId)).toEqual(view.tasks.map((t) => t.id));
    expect(b.items.map((i) => [i.title, i.ownerMemberId])).toEqual(view.tasks.map((t) => [t.title, t.ownerMemberId]));

    const lines = b.text.split("\n");
    const slice = (i: BriefView["items"][number]) => lines.slice(i.from, i.to);
    expect(b.items.map((i) => [i.from, i.to])).toEqual([
      [8, 9],
      [9, 10],
      [10, 13],
      [13, 14],
      [14, 15],
    ]);
    // Each range starts with the item's own line; the nested (1)(2) lines belong to 3.
    expect(slice(b.items[2]!)).toEqual([
      "3. 开发点餐网站，至少包含菜单、购物车和订单三个页面。",
      "  （1）使用 HTML、CSS 和 JavaScript。",
      "  （2）订单资料存入数据库。",
    ]);
    for (const item of b.items) expect(slice(item)[0]).toContain(item.title);
    // The task page quotes the same lines without their markers (the project's task list leaves them out).
    expect(view.tasks[2]!.briefExcerpt).toBeNull();
    const page = await call<TaskDetail>(`/api/projects/${view.basics.id}/tasks/${view.tasks[2]!.id}`, { token: leader.token });
    expect(page.data.task.briefExcerpt).toBe("开发点餐网站，至少包含菜单、购物车和订单三个页面。\n使用 HTML、CSS 和 JavaScript。\n订单资料存入数据库。");
  });

  it("is open to every member, not to outsiders", async () => {
    const { view } = await fromFile("zh-mkt201-marketing.txt");
    const lin = await person(1);
    await call(`/api/join/${encodeURIComponent(view.inviteCode!)}`, { method: "POST", token: lin.token });
    const res = await brief(lin.token, view.basics.id);
    expect(res.status).toBe(200);
    expect(res.data.items.map((i) => [i.title, i.from, i.to])).toEqual([
      ["书面报告", 11, 12],
      ["口头报告", 12, 13],
      ["问卷调查", 13, 14],
      ["小组会议记录", 14, 15],
    ]);
    const outsider = await person(5);
    expect((await brief(outsider.token, view.basics.id)).status).toBe(404);
  });

  it("answers NO_BRIEF (404) for a project planned by hand; a typed brief has text but no ranges", async () => {
    const t = await activeWith(2);
    const none = await brief(t.leader.token, t.projectId);
    expect([none.status, none.error?.code]).toEqual([404, "NO_BRIEF"]);
    expect(t.view.briefAvailable).toBe(false);

    const leader = t.leader;
    const draft = await createDraft(leader.token, { teamSize: 2 });
    const text = "我们要做：1. 做一个订餐小程序 2. 写使用说明书";
    await call<BriefResult>(`/api/projects/${draft.basics.id}/brief`, { method: "POST", token: leader.token, body: { text } });
    const view = (await call<ProjectView>(`/api/projects/${draft.basics.id}/confirm`, { method: "POST", token: leader.token })).data;
    expect(view).toMatchObject({ briefAvailable: true, briefFileName: null });
    expect(view.tasks.map((x) => x.briefExcerpt)).toEqual([null, null]);
    const typed = await brief(leader.token, draft.basics.id);
    expect(typed.data).toEqual({ text, fileName: null, items: [] });
  });
});
