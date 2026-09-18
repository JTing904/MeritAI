import "dotenv/config";
import { createDb, type Db } from "../src/lib/db";

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

// Run directly by `prisma db seed`.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  const db = createDb(process.env.DATABASE_URL!);
  seed(db)
    .then(() => console.log(`Seeded ${DEV_PEOPLE.length} dev people`))
    .finally(() => db.$disconnect());
}
