// Evidence files and links (M4 spec §2, §5): add, delete, and the signed links that open files.
import type { EvidenceLink } from "../../../shared/types";
import type { Member, Task } from "../generated/prisma/client";
import { assertActive, requireActiveMember } from "../lib/access";
import type { Db } from "../lib/db";
import { AppError, conflict, notFound } from "../lib/errors";
import { isInlineType } from "../lib/evidence-types";
import { MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_ITEMS, MAX_LINK_CHARS } from "../lib/grading";
import { fileUrlSecret, getStorage, isStorageKey, verifyFileSignature } from "../lib/storage";
import { assertRoomForFile } from "../lib/storage-quota";
import { alreadyReviewing, assertOwner, nextAttemptNo, taskDone, taskUnderLock } from "./attempts";
import { bumpPackages } from "./notify";
import { startUnderLock } from "./packages";
import { lockAsMember, TX_OPTIONS, type Tx } from "./tx";
import { clock } from "../lib/clock";

/** A file already written to storage (key = "<projectId>/<taskId>/<newFileId()>.<ext>"); mimeType = the sniffed canonical type. */
export type StoredEvidenceFile = { key: string; name: string; sizeBytes: number; mimeType: string };

/** How long a link that opens a file stays valid. */
const LINK_TTL_SEC = 10 * 60;
/** Longest display name of a link (the URL without its scheme). */
const LINK_NAME_CHARS = 60;

const OWNER_ONLY = "Only the task's owner can hand in evidence";
const tooLarge = () => new AppError(413, "FILE_TOO_LARGE", "Each file can be at most 10 MB");
const invalidLink = () => new AppError(400, "INVALID_LINK", "The link must start with http:// or https://");

type Reader = Db | Tx;

/**
 * The rules every new piece of evidence passes (the same codes before and under the lock): the owner,
 * not DONE, nothing waiting for review, fewer than 5 items in the current attempt, and for a file room
 * in the project's 20 MB and the site's cap (lib/storage-quota.ts). Returns the DRAFT attempt to add to
 * (null: a new one is needed).
 */
async function checkNewEvidence(
  db: Reader,
  task: Pick<Task, "id" | "projectId" | "ownerId" | "status">,
  member: Pick<Member, "id">,
  fileBytes: number | null,
): Promise<{ draftId: string | null }> {
  assertOwner(task, member, OWNER_ONLY);
  if (task.status === "DONE") throw taskDone();
  const open = await db.attempt.findFirst({ where: { taskId: task.id, status: { in: ["DRAFT", "PENDING"] } }, orderBy: { no: "desc" } });
  if (open?.status === "PENDING") throw alreadyReviewing();
  if (open && (await db.evidence.count({ where: { attemptId: open.id } })) >= MAX_EVIDENCE_ITEMS) {
    throw new AppError(409, "EVIDENCE_LIMIT", "Up to 5 pieces of evidence. Remove one first");
  }
  if (fileBytes !== null) {
    if (fileBytes > MAX_EVIDENCE_FILE_BYTES) throw tooLarge();
    await assertRoomForFile(db, task.projectId, fileBytes);
  }
  return { draftId: open?.id ?? null };
}

/**
 * Cheap checks before a file is written to storage, outside any lock (the member is the task's owner,
 * status ≠ DONE, no PENDING attempt, < 5 items in the current attempt, the project's FILE bytes plus
 * `sizeBytes` ≤ 20 MB, the site below its cap), with the same error codes as addFileEvidence, which re-checks under the lock.
 */
export async function precheckFileEvidence(db: Db, projectId: string, taskId: string, userId: string, sizeBytes: number): Promise<void> {
  const { project, member } = await requireActiveMember(db, projectId, userId);
  assertActive(project);
  const task = await db.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) throw notFound("Task");
  await checkNewEvidence(db, task, member, sizeBytes);
}

/** Adds one piece of evidence under the lock: the checks again, the DRAFT attempt (created if needed), the start. */
async function addEvidence(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  row: { kind: "FILE" | "LINK"; name: string; url?: string; storageKey?: string; sizeBytes?: number; mimeType?: string },
  now: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    const { draftId } = await checkNewEvidence(tx, task, member, row.kind === "FILE" ? (row.sizeBytes ?? 0) : null);
    const attemptId =
      draftId ?? (await tx.attempt.create({ data: { taskId: task.id, no: await nextAttemptNo(tx, task.id) }, select: { id: true } })).id;
    await tx.evidence.create({ data: { ...row, attemptId, taskId: task.id, addedById: member.id, createdAt: now } });
    // Handing in work counts as starting it (and makes a moved-in task the new owner's start).
    await startUnderLock(tx, task, member, now);
    await bumpPackages(tx, projectId);
  }, TX_OPTIONS);
}

/** Adds a stored file to the current DRAFT attempt (created when there is none); starts the task (startUnderLock). */
export async function addFileEvidence(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  file: StoredEvidenceFile,
  now = clock.now(),
): Promise<void> {
  await addEvidence(
    db,
    projectId,
    taskId,
    userId,
    { kind: "FILE", name: file.name, storageKey: file.key, sizeBytes: file.sizeBytes, mimeType: file.mimeType },
    now,
  );
}

/**
 * A link's display name: host and path, cut to 60 characters with 「…」. The host is the parsed one, so
 * an international name shows as punycode (xn--…) and a look-alike of a real site can't pass for it.
 */
export function linkName(url: URL): string {
  const bare = url.host + (url.pathname === "/" ? "" : url.pathname);
  return bare.length > LINK_NAME_CHARS ? `${bare.slice(0, LINK_NAME_CHARS - 1)}…` : bare;
}

/**
 * An http(s) URL of at most 2000 characters that parses, with a host (INVALID_LINK otherwise) and no
 * username or password (LINK_CREDENTIALS: "https://docs.google.com@evil.example" is not Google).
 */
function checkLink(raw: string): { url: string; parsed: URL } {
  const url = raw.trim();
  if (url.length > MAX_LINK_CHARS || !/^https?:\/\//i.test(url)) throw invalidLink();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidLink();
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) throw invalidLink();
  if (parsed.username || parsed.password) {
    throw new AppError(400, "LINK_CREDENTIALS", "Links can't contain a username or password");
  }
  return { url, parsed };
}

/** Adds a link (http/https, ≤ 2000 chars; INVALID_LINK otherwise) to the current DRAFT attempt. */
export async function addLinkEvidence(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  url: string,
  now = clock.now(),
): Promise<void> {
  const link = checkLink(url);
  await addEvidence(db, projectId, taskId, userId, { kind: "LINK", name: linkName(link.parsed), url: link.url }, now);
}

/**
 * Removes evidence from the DRAFT attempt (PENDING → ALREADY_REVIEWING, GRADED → CONFLICT). The attempt
 * stays even when empty. Returns the file's key; the caller deletes it from storage after commit.
 */
export async function deleteEvidence(
  db: Db,
  projectId: string,
  taskId: string,
  userId: string,
  evidenceId: string,
  _now = clock.now(),
): Promise<{ storageKey: string | null }> {
  return db.$transaction(async (tx) => {
    const { member } = await lockAsMember(tx, projectId, userId);
    const task = await taskUnderLock(tx, projectId, taskId);
    assertOwner(task, member, "Only the task's owner can remove evidence");
    const evidence = await tx.evidence.findFirst({ where: { id: evidenceId, taskId: task.id }, include: { attempt: true } });
    if (!evidence) throw notFound("Evidence");
    if (evidence.attempt.status === "PENDING") throw alreadyReviewing();
    if (evidence.attempt.status === "GRADED") throw conflict("Graded evidence is kept");
    await tx.evidence.delete({ where: { id: evidence.id } });
    return { storageKey: evidence.storageKey };
  }, TX_OPTIONS);
}

/**
 * GET /api/evidence/:id/link: a member of the evidence's project (404 otherwise) gets a 10-minute signed URL.
 * Real time, not the time machine's clock (lib/clock.ts): the storage signs `exp` with real time.
 */
export async function evidenceLink(db: Db, evidenceId: string, userId: string, now = new Date()): Promise<EvidenceLink> {
  const evidence = await db.evidence.findUnique({ where: { id: evidenceId }, include: { task: { select: { projectId: true } } } });
  if (!evidence) throw notFound("Evidence");
  await requireActiveMember(db, evidence.task.projectId, userId);
  const expiresAt = new Date(now.getTime() + LINK_TTL_SEC * 1000).toISOString();
  // A link is its own URL (the app opens those directly; this keeps the endpoint total).
  if (evidence.kind === "LINK" || !evidence.storageKey) {
    // Checked again on the way out: only an http(s) link is ever handed to a browser.
    if (!evidence.url || !/^https?:\/\//i.test(evidence.url)) throw notFound("Evidence");
    return { url: evidence.url, expiresAt };
  }
  const mimeType = evidence.mimeType ?? "application/octet-stream";
  const url = await getStorage().signedUrl(evidence.storageKey, {
    expiresInSec: LINK_TTL_SEC,
    fileName: evidence.name,
    mimeType,
    inline: isInlineType(mimeType),
  });
  return { url, expiresAt };
}

/** RFC 5987 `filename*` value (encodeURIComponent leaves a few characters the header grammar forbids). */
function encodeFileName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Plain-ASCII fallback `filename` for clients that ignore `filename*`. */
function asciiFileName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
  return ascii || "file";
}

/**
 * GET /api/files/<key>?exp=&sig= (no bearer): checks the expiry and the signature (404 otherwise), looks
 * the file up by its storage key (a deleted row → 404) and streams it with Content-Type,
 * Content-Length, Content-Disposition, Cache-Control, nosniff and Accept-Ranges: none.
 */
export async function signedFileResponse(
  db: Db,
  key: string,
  query: { exp?: string; sig?: string },
  // Real time: the link's `exp` was signed with real time (lib/storage.ts), not the time machine's clock.
  now = new Date(),
): Promise<Response> {
  const missing = () => notFound("File");
  if (!isStorageKey(key) || !query.sig || !query.exp || !/^\d{1,12}$/.test(query.exp)) throw missing();
  const exp = Number(query.exp);
  if (exp * 1000 <= now.getTime()) throw missing();
  const evidence = await db.evidence.findUnique({ where: { storageKey: key } });
  if (!evidence) throw missing();
  // The signature covers the disposition; it follows from the stored (sniffed) type, never the query.
  const mimeType = evidence.mimeType ?? "application/octet-stream";
  const inline = isInlineType(mimeType);
  if (!verifyFileSignature(fileUrlSecret(), key, exp, inline, query.sig)) throw missing();
  const object = await getStorage().get(key);
  if (!object) throw missing();
  const disposition = `${inline ? "inline" : "attachment"}; filename="${asciiFileName(evidence.name)}"; filename*=UTF-8''${encodeFileName(evidence.name)}`;
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(object.sizeBytes),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // Whatever a file holds, it runs no script with this API's origin and can't be framed (Chrome still
      // shows PDFs and images under it). The rest of the API gets the same via apiSecurityHeaders.
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      // Range requests are ignored (always the full body), so tell clients not to resume.
      "Accept-Ranges": "none",
    },
  });
}
