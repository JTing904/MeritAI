import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { EvidenceLink, TaskDetail } from "../../../shared/types";
import type { AppEnv } from "../app";
import { requireUser } from "../lib/auth";
import { readBody } from "../lib/body";
import { AppError } from "../lib/errors";
import { detectEvidenceType, SNIFF_BYTES } from "../lib/evidence-types";
import { safeFileName } from "../lib/file-name";
import { MAX_EVIDENCE_FILE_BYTES } from "../lib/grading";
import { fail, ok } from "../lib/http";
import { idempotent } from "../lib/idempotency";
import { consumeRate, RATE_RULES } from "../lib/rate-limit";
import { getStorage, newFileId, TooLargeError } from "../lib/storage";
import { meetingDone, submitAttempt, undoStart, withdrawAttempt } from "../services/attempts";
import {
  addFileEvidence,
  addLinkEvidence,
  deleteEvidence,
  evidenceLink,
  precheckFileEvidence,
  signedFileResponse,
} from "../services/evidence";
import { gradeAttempt, gradeOutside, overrideGrade, undoOverride } from "../services/grading-service";
import { GradeInputSchema, GradeOutsideSchema, LinkSchema, MeetingDoneSchema, OverrideSchema } from "../services/schemas";
import { loadTaskDetailFor } from "../services/task-views";

// Attempts and evidence of one task (M4 spec §6). Three routers, one per base path (a router mounted at
// several paths would answer all of them): evidenceRoutes → /projects, evidenceLinkRoutes → /evidence,
// fileRoutes → /files. The routes don't check the membership themselves: every service checks it under
// the project lock (404 / 403), and the detail they answer with is read together with it (A14).
export const evidenceRoutes = new Hono<AppEnv>();
export const evidenceLinkRoutes = new Hono<AppEnv>();
export const fileRoutes = new Hono<AppEnv>();

type Ctx = Parameters<typeof requireUser>[0];

/** The caller and the route's ids. Member / leader rights are the services' to check (see above). */
async function asMember(c: Ctx) {
  const user = await requireUser(c);
  return { user, projectId: c.req.param("id")!, taskId: c.req.param("taskId")! };
}

const asLeader = asMember;

const tooLarge = () => new AppError(413, "FILE_TOO_LARGE", "Each file can be at most 10 MB");

evidenceRoutes.post("/:id/tasks/:taskId/undo-start", async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  await undoStart(c.var.db, projectId, taskId, user.id);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

// Vercel caveat (lib/storage.ts): in production this multipart route is over the 4.5 MB function cap for
// anything but small files; the intended path there is a direct upload to Supabase (not built in M4).
evidenceRoutes.post(
  "/:id/tasks/:taskId/evidence/file",
  // Before the body limit: a replayed upload isn't read (or stored) again.
  idempotent,
  // Refuse oversized uploads without reading them; the multipart envelope needs a little room.
  bodyLimit({
    maxSize: MAX_EVIDENCE_FILE_BYTES + 256 * 1024,
    onError: (c) => fail(c, 413, "FILE_TOO_LARGE", "Each file can be at most 10 MB"),
  }),
  async (c) => {
    const { user, projectId, taskId } = await asMember(c);
    await consumeRate(c.var.db, [{ rule: RATE_RULES.evidenceUser, subject: user.id }]);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new AppError(400, "VALIDATION", 'Send the file as the multipart field "file"');
    if (file.size > MAX_EVIDENCE_FILE_BYTES) throw tooLarge();
    const name = safeFileName(form.fileName, file.name, "file");
    const type = detectEvidenceType(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()), name);
    if (!type) throw new AppError(400, "FILE_TYPE_UNSUPPORTED", "Only Word, PDF, PowerPoint, image, Excel and CSV files");

    // Outside any lock, so nobody can make the server write 10 MB per request only to throw it away;
    // addFileEvidence re-checks everything under the lock.
    await precheckFileEvidence(c.var.db, projectId, taskId, user.id, file.size);
    const storage = getStorage();
    const key = `${projectId}/${taskId}/${newFileId()}.${type.ext}`;
    let sizeBytes: number;
    try {
      ({ sizeBytes } = await storage.put(key, file.stream(), { mimeType: type.mimeType, maxBytes: MAX_EVIDENCE_FILE_BYTES }));
    } catch (err) {
      // The provider already removed the partial object.
      if (err instanceof TooLargeError) throw tooLarge();
      throw err;
    }
    try {
      await addFileEvidence(c.var.db, projectId, taskId, user.id, { key, name, sizeBytes, mimeType: type.mimeType });
    } catch (err) {
      await storage.delete(key).catch((e) => console.error("evidence upload: could not remove the refused file", e));
      throw err;
    }
    return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id), 201);
  },
);

evidenceRoutes.post("/:id/tasks/:taskId/evidence/link", idempotent, async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  const { url } = await readBody(c, LinkSchema);
  await addLinkEvidence(c.var.db, projectId, taskId, user.id, url);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id), 201);
});

evidenceRoutes.delete("/:id/tasks/:taskId/evidence/:evidenceId", async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  const { storageKey } = await deleteEvidence(c.var.db, projectId, taskId, user.id, c.req.param("evidenceId"));
  // After the commit, best effort: an orphaned file is swept later (M5).
  if (storageKey) await getStorage().delete(storageKey).catch((e) => console.error("evidence: could not delete a file", e));
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/submit", async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  await submitAttempt(c.var.db, projectId, taskId, user.id);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/withdraw", async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  await withdrawAttempt(c.var.db, projectId, taskId, user.id);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/grade", async (c) => {
  const { user, projectId, taskId } = await asLeader(c);
  const input = await readBody(c, GradeInputSchema);
  await gradeAttempt(c.var.db, projectId, taskId, user.id, input);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/grade-outside", async (c) => {
  const { user, projectId, taskId } = await asLeader(c);
  const input = await readBody(c, GradeOutsideSchema);
  await gradeOutside(c.var.db, projectId, taskId, user.id, input);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/override", async (c) => {
  const { user, projectId, taskId } = await asLeader(c);
  const input = await readBody(c, OverrideSchema);
  await overrideGrade(c.var.db, projectId, taskId, user.id, input);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/undo-override", async (c) => {
  const { user, projectId, taskId } = await asLeader(c);
  await undoOverride(c.var.db, projectId, taskId, user.id);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceRoutes.post("/:id/tasks/:taskId/meeting-done", async (c) => {
  const { user, projectId, taskId } = await asMember(c);
  const input = await readBody(c, MeetingDoneSchema);
  await meetingDone(c.var.db, projectId, taskId, user.id, input);
  return ok<TaskDetail>(c, await loadTaskDetailFor(c.var.db, projectId, taskId, user.id));
});

evidenceLinkRoutes.get("/:evidenceId/link", async (c) => {
  const user = await requireUser(c);
  return ok<EvidenceLink>(c, await evidenceLink(c.var.db, c.req.param("evidenceId"), user.id));
});

// No bearer token: the signed URL is the permission (the app opens it in the browser). Hono answers HEAD
// through this GET handler and drops the body.
fileRoutes.get("/*", async (c) => {
  // Keys are plain [a-z0-9./] (isStorageKey), so the raw path is the key; anything else is simply not found.
  const key = c.req.path.replace(/^\/api\/files\//, "");
  const res = await signedFileResponse(c.var.db, key, { exp: c.req.query("exp"), sig: c.req.query("sig") });
  // HEAD: close the file now instead of leaving an unread stream (and its file handle) to the garbage collector.
  if (c.req.method === "HEAD") {
    await res.body?.cancel();
    return new Response(null, { status: res.status, headers: res.headers });
  }
  return res;
});
