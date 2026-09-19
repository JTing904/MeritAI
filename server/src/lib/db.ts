import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export type Db = PrismaClient;

/**
 * Columns no query loads unless it asks for them (A12): the brief's full text (up to 200 KB) and each
 * task's quoted brief lines. Every project write locks and re-reads the project row, and every list reads
 * all of a project's tasks, so loading these by default made up most of the database egress.
 *
 * Read them with `select: { briefText: true }` or `omit: { briefExcerpt: false }`. The generated types
 * still list them on Project and Task, so a query that didn't ask gets `undefined` at run time: use
 * Project.briefBytes to tell whether a brief exists.
 */
export const OMIT = { project: { briefText: true }, task: { briefExcerpt: true } } as const;

/** Prisma 7 needs a driver adapter; the connection string comes from the environment. */
export function createDb(connectionString: string): Db {
  // The omit option narrows the client's result types; Db keeps the plain type so the transaction
  // client (Prisma.TransactionClient, which ignores omit options) and the client stay interchangeable.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), omit: OMIT }) as unknown as Db;
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
