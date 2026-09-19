import "dotenv/config";
import { createDb, type Db } from "../src/lib/db";
import { joinProject } from "../src/services/join";
import { confirmPlan, createDraft } from "../src/services/projects";

// Test people for the developer one-tap login, matching the prototype's sample team.
export const DEV_PEOPLE = [
  { name: "陈思远", email: "siyuan@dev.meritai.test", githubUsername: "siyuan-dev" },
  { name: "林晓雯", email: "xiaowen@dev.meritai.test", githubUsername: "xiaowen-dev" },
  { name: "王子杰", email: "zijie@dev.meritai.test", githubUsername: "zijie-dev" },
  { name: "张博文", email: "bowen@dev.meritai.test", githubUsername: "bowen-dev" },
  { name: "李嘉欣", email: "jiaxin@dev.meritai.test", githubUsername: "jiaxin-dev" },
  { name: "Ahmad Faizal", email: "ahmad@dev.meritai.test", githubUsername: "ahmad-dev" },
] as const;

export async function seed(db: Db) {
  for (const p of DEV_PEOPLE) {
    await db.user.upsert({ where: { email: p.email }, update: { name: p.name }, create: { ...p } });
  }
}

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);
const DEMO_NAME = "校园二手市场 App";

/**
 * Optional demo data (SEED_DEMO=true): the prototype's CS302 project led by 陈思远 with two members
 * and a pending invite for 张博文, plus a half-finished draft. Skipped when it already exists.
 */
export async function seedDemo(db: Db) {
  const [siyuan, xiaowen, zijie, bowen] = await Promise.all(
    DEV_PEOPLE.slice(0, 4).map((p) => db.user.findUniqueOrThrow({ where: { email: p.email } })),
  );
  if (await db.project.findFirst({ where: { createdById: siyuan!.id, name: DEMO_NAME } })) return false;

  const id = await createDraft(db, siyuan!, {
    name: DEMO_NAME,
    shortCode: "CS302",
    courseName: "软件工程",
    groupLabel: "第 7 组",
    deadline: inDays(48).toISOString(),
    timezone: "Asia/Kuala_Lumpur",
    teamSize: 5,
    leaderManages: false,
    repoFullName: null,
  });
  // The Plan mockup: four features plus common work, 20.0 分 each.
  const plan: [string, [string, "CODE" | "DOC" | "DESIGN" | "MEETING", number, number | null][]][] = [
    ["注册与登录", [["注册与登录页面", "CODE", 120, 20], ["测试：注册与登录", "CODE", 30, 23], ["报告：注册与登录章节", "DOC", 50, 41]]],
    ["商品发布", [["商品发布与编辑", "CODE", 125, 20], ["测试：商品发布", "CODE", 30, 23], ["报告：商品发布章节", "DOC", 45, 41]]],
    ["买卖双方聊天", [["聊天模块", "CODE", 115, 34], ["测试：聊天", "CODE", 35, 37], ["报告：聊天章节", "DOC", 50, 41]]],
    ["搜索与筛选", [["搜索与筛选", "CODE", 110, 34], ["测试：搜索与筛选", "CODE", 40, 37], ["报告：搜索与筛选章节", "DOC", 50, 41]]],
    ["全组共同", [["需求分析文档", "DOC", 80, 11], ["数据库设计", "DOC", 60, 13], ["期末演示 PPT", "DESIGN", 40, 47], ["每周组会（5 次）", "MEETING", 20, null]]],
  ];
  let number = 0;
  for (const [order, [name, tasks]] of plan.entries()) {
    const feature = await db.feature.create({ data: { projectId: id, name, order } });
    for (const [title, kind, points, dueDays] of tasks) {
      number++;
      const dueAt = dueDays === null ? null : inDays(dueDays);
      await db.task.create({
        data: { projectId: id, number, order: number - 1, title, kind, points, dueAt, suggestedDueAt: dueAt, featureId: feature.id },
      });
    }
  }
  await db.project.update({ where: { id }, data: { planSource: "MANUAL" } });
  await confirmPlan(db, id);
  for (const user of [xiaowen!, zijie!]) await db.$transaction((tx) => joinProject(tx, id, user));
  await db.invite.create({ data: { projectId: id, invitedById: siyuan!.id, email: bowen!.email } });

  const draftId = await createDraft(db, siyuan!, {
    name: "市场营销报告",
    shortCode: "MKT201",
    courseName: "市场营销原理",
    groupLabel: null,
    deadline: inDays(30).toISOString(),
    timezone: "Asia/Kuala_Lumpur",
    teamSize: 4,
    leaderManages: false,
    repoFullName: null,
  });
  const draftTasks: [string, "DOC" | "DESIGN" | "RESEARCH" | "MEETING", number][] = [
    ["书面报告", "DOC", 400],
    ["口头报告", "DESIGN", 300],
    ["问卷调查", "RESEARCH", 200],
    ["小组会议记录", "MEETING", 100],
  ];
  await db.task.createMany({
    data: draftTasks.map(([title, kind, points], i) => ({ projectId: draftId, number: i + 1, order: i, title, kind, points })),
  });
  await db.project.update({ where: { id: draftId }, data: { planSource: "MANUAL", draftStep: 5 } });
  return true;
}

// Run directly by `prisma db seed`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  const db = createDb(process.env.DATABASE_URL!);
  seed(db)
    .then(async () => {
      console.log(`Seeded ${DEV_PEOPLE.length} dev people`);
      if (process.env.SEED_DEMO === "true") {
        console.log((await seedDemo(db)) ? "Seeded the demo projects" : "Demo projects already exist");
      }
    })
    .finally(() => db.$disconnect());
}
