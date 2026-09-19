// A20: evidence files may use at most MAX_PROJECT_STORAGE_BYTES (20 MB) per project, and uploads stop
// for everyone before the hosting's storage runs out (Supabase free: 1 GB) at MAX_SITE_STORAGE_BYTES.
import type { Prisma } from "../generated/prisma/client";
import { AppError } from "./errors";
import { MAX_PROJECT_STORAGE_BYTES } from "./grading";

/** Default site-wide stop: 900 MB, leaving room below the 1 GB free tier for the database's own files. */
export const DEFAULT_SITE_STORAGE_BYTES = 900 * 1024 * 1024;

/** MAX_SITE_STORAGE_BYTES (bytes; a positive integer), else 900 MB. */
export function siteStorageCap(raw = process.env.MAX_SITE_STORAGE_BYTES): number {
  const n = Number(raw?.trim());
  return raw?.trim() && Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_SITE_STORAGE_BYTES;
}

const MB = 1024 * 1024;

/** Bytes of FILE evidence in the project and in the whole site, in one query. */
export async function fileBytesUsed(db: Prisma.TransactionClient, projectId: string): Promise<{ project: number; site: number }> {
  const [row] = await db.$queryRaw<{ project: bigint | number | null; site: bigint | number | null }[]>`
    SELECT COALESCE(SUM(e."sizeBytes") FILTER (WHERE t."projectId" = ${projectId}), 0)::bigint AS "project",
           COALESCE(SUM(e."sizeBytes"), 0)::bigint AS "site"
    FROM "Evidence" e JOIN "Task" t ON t."id" = e."taskId"
    WHERE e."kind" = 'FILE'`;
  return { project: Number(row?.project ?? 0), site: Number(row?.site ?? 0) };
}

/**
 * Refuses a new file of `bytes` when the project's files would pass 20 MB (409 PROJECT_STORAGE_FULL) or
 * the site's would pass its cap (507 STORAGE_FULL: nobody can upload until space is freed; links still work).
 */
export async function assertRoomForFile(db: Prisma.TransactionClient, projectId: string, bytes: number): Promise<void> {
  const used = await fileBytesUsed(db, projectId);
  if (used.project + bytes > MAX_PROJECT_STORAGE_BYTES) {
    throw new AppError(
      409,
      "PROJECT_STORAGE_FULL",
      `This project's file space is full (${MAX_PROJECT_STORAGE_BYTES / MB} MB in total)`,
      { usedBytes: used.project, capBytes: MAX_PROJECT_STORAGE_BYTES },
    );
  }
  if (used.site + bytes > siteStorageCap()) {
    console.warn(`storage: site-wide cap reached (${used.site} bytes used); uploads are refused`);
    throw new AppError(507, "STORAGE_FULL", "The server's file space is full. Paste a link instead for now");
  }
}
