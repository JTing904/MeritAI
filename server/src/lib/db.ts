import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export type Db = PrismaClient;

/** Prisma 7 needs a driver adapter; the connection string comes from the environment. */
export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForDb = globalThis as unknown as { meritaiDb?: Db };

/** Process-wide client, reused across hot reloads in development. */
export function getDb(): Db {
  if (!globalForDb.meritaiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.meritaiDb = createDb(url);
  }
  return globalForDb.meritaiDb;
}
