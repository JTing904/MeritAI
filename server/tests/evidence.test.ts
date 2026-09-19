// Evidence files and links (M4 spec §2, §5, §13): uploads (sniffing, limits, the project's 20 MB), links,
// deleting, and the signed links that open files.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EVIDENCE_FILE_BYTES } from "../../shared/constants";
import type { EvidenceLink, NotificationPayload } from "../../shared/types";
import type { ActivityType } from "../src/generated/prisma/client";
import { getStorage, signFileUrl } from "../src/lib/storage";
import { call, testApp, testDb } from "./helpers";
import {
  fakeFile,
  freshDb,
  gradeAs,
  linkEvidence,
  person,
  startAs,
  submitAs,
  taskOf,
  uploadDir,
  uploadEvidence,
  viewAs,
  withPackages,
} from "./project-fixtures";

beforeEach(freshDb);
afterEach(() => vi.restoreAllMocks());
afterAll(() => testDb.$disconnect());

const HOUR = 60 * 60 * 1000;

const memberRow = (projectId: string, userId: string) =>
  testDb.member.findFirstOrThrow({ where: { projectId, userId }, include: { user: true } });
const taskRow = (id: string) => testDb.task.findUniqueOrThrow({ where: { id } });
const version = async (projectId: string) => (await testDb.project.findUniqueOrThrow({ where: { id: projectId } })).packagesVersion;
const eventsOf = (projectId: string, type: ActivityType) =>
  testDb.activityEvent.findMany({ where: { projectId, type }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const notificationsOf = (userId: string, type?: NotificationPayload["type"]) =>
  testDb.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const evidenceOf = (taskId: string) => testDb.evidence.findMany({ where: { taskId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** Every file under UPLOAD_DIR (relative paths, "/" separated); [] when the folder doesn't exist yet. */
async function filesOnDisk(): Promise<string[]> {
  const root = uploadDir();
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
  } catch {
    return [];
  }
}

const onDisk = (key: string) => readFile(path.join(uploadDir(), ...key.split("/")));

/**
 * Three people, everyone with a package: the leader 「任务包 1」, A 「任务包 2」, B 「任务包 3」.
 */
async function team() {
  const t = await withPackages(3);
  const [a, b] = t.members;
  const rows = {
    leader: await memberRow(t.projectId, t.leader.user.id),
    a: await memberRow(t.projectId, a!.user.id),
    b: await memberRow(t.projectId, b!.user.id),
  };
  return {
    ...t,
    a: a!,
    b: b!,
    rows,
    aTask: taskOf(t.view, 0, 2),
    aTask2: taskOf(t.view, 1, 2),
    bTask: taskOf(t.view, 0, 3),
    leaderTask: taskOf(t.view, 0, 1),
  };
}

function pendingSwap(projectId: string, requesterId: string, targetId: string, from: string, to: string) {
  const now = Date.now();
  return testDb.swapRequest.create({
    data: {
      projectId,
      requesterId,
      targetId,
      requesterPackageId: from,
      targetPackageId: to,
      createdAt: new Date(now - HOUR),
      expiresAt: new Date(now + 71 * HOUR),
    },
  });
}

describe("POST /api/projects/:id/tasks/:taskId/evidence/file", () => {
  it("stores the first file in a new draft attempt and starts the task as its owner", async () => {
    const t = await team();
    const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
    const swap = await pendingSwap(t.projectId, t.rows.b.id, t.rows.a.id, pkgs[2]!.id, pkgs[1]!.id);
    const before = await version(t.projectId);

    const res = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("市场调研.pdf", "pdf", 2048));
    expect(res.status).toBe(201);
    const [attempt] = await testDb.attempt.findMany({ where: { taskId: t.aTask.id } });
    expect(attempt).toMatchObject({ no: 1, status: "DRAFT", submittedAt: null });
    const [ev] = await evidenceOf(t.aTask.id);
    expect(ev).toMatchObject({
      attemptId: attempt!.id,
      kind: "FILE",
      name: "市场调研.pdf",
      sizeBytes: 2048,
      mimeType: "application/pdf",
      addedById: t.rows.a.id,
      url: null,
    });
    expect(ev!.storageKey).toMatch(new RegExp(`^${t.projectId}/${t.aTask.id}/[0-9a-f]{24}\\.pdf$`));
    expect((await onDisk(ev!.storageKey!)).byteLength).toBe(2048);
    expect(await filesOnDisk()).toEqual([ev!.storageKey]);

    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DOING", startedById: t.rows.a.id });
    expect((await taskRow(t.aTask.id)).startedAt).not.toBeNull();
    const started = await eventsOf(t.projectId, "TASK_STARTED");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ actorId: t.rows.a.id, payload: { taskId: t.aTask.id } });
    expect(await testDb.swapRequest.findUniqueOrThrow({ where: { id: swap.id } })).toMatchObject({ status: "VOID", voidReason: "STARTED" });
    expect(await version(t.projectId)).toBe(before + 1);

    // A second file goes into the same attempt and doesn't start anything again.
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("photo.png", "png"))).status).toBe(201);
    expect(await testDb.attempt.count({ where: { taskId: t.aTask.id } })).toBe(1);
    expect((await evidenceOf(t.aTask.id)).map((e) => e.mimeType)).toEqual(["application/pdf", "image/png"]);
    expect(await eventsOf(t.projectId, "TASK_STARTED")).toHaveLength(1);
  });

  it("makes a moved-in task someone else started the new owner's start (upload or 开始做)", async () => {
    for (const via of ["upload", "start"] as const) {
      await freshDb();
      const t = await team();
      const pkgs = await testDb.package.findMany({ where: { projectId: t.projectId }, orderBy: { index: "asc" } });
      expect((await startAs(t.b.token, t.projectId, t.bTask.id)).status).toBe(200);
      const startedAt = (await taskRow(t.bTask.id)).startedAt;
      const moved = await call(`/api/projects/${t.projectId}/tasks/${t.bTask.id}/move`, {
        method: "POST",
        token: t.leader.token,
        body: { packageId: pkgs[1]!.id },
      });
      expect(moved.status).toBe(200);
      expect((await viewAs(t.a.token, t.projectId)).packages.find((p) => p.index === 2)!.started).toBe(false);

      const res =
        via === "upload"
          ? await uploadEvidence(t.a.token, t.projectId, t.bTask.id, fakeFile("a.pdf", "pdf"))
          : await startAs(t.a.token, t.projectId, t.bTask.id);
      expect(res.status).toBe(via === "upload" ? 201 : 200);
      expect(await taskRow(t.bTask.id)).toMatchObject({ ownerId: t.rows.a.id, startedById: t.rows.a.id, startedAt });
      expect((await viewAs(t.a.token, t.projectId)).packages.find((p) => p.index === 2)!.started).toBe(true);
      const swap = await call(`/api/projects/${t.projectId}/swaps`, { method: "POST", token: t.a.token, body: { packageId: pkgs[2]!.id } });
      expect([swap.status, swap.error?.code]).toEqual([409, "PACKAGE_STARTED"]);
      const started = await eventsOf(t.projectId, "TASK_STARTED");
      expect(started.map((e) => e.actorId)).toEqual([t.rows.b.id, t.rows.a.id]);
    }
  });

  it("only takes files from the task's owner; the pre-check refuses before anything is written", async () => {
    const t = await team();
    const other = await uploadEvidence(t.b.token, t.projectId, t.aTask.id, fakeFile("x.pdf", "pdf"));
    expect([other.status, other.error?.code]).toEqual([403, "FORBIDDEN"]);
    const leader = await uploadEvidence(t.leader.token, t.projectId, t.aTask.id, fakeFile("x.pdf", "pdf"));
    expect(leader.status).toBe(403);
    const stranger = await person(4);
    expect((await uploadEvidence(stranger.token, t.projectId, t.aTask.id, fakeFile("x.pdf", "pdf"))).status).toBe(404);
    expect((await uploadEvidence(t.a.token, t.projectId, "nope", fakeFile("x.pdf", "pdf"))).status).toBe(404);
    const noFile = await call(`/api/projects/${t.projectId}/tasks/${t.aTask.id}/evidence/file`, {
      method: "POST",
      token: t.a.token,
      body: { url: "x" },
    });
    expect(noFile.status).toBe(400);
    expect(await filesOnDisk()).toEqual([]);
    expect(await testDb.attempt.count()).toBe(0);
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "TODO", startedAt: null });
  });

  it("refuses a sixth item in the current attempt (EVIDENCE_LIMIT)", async () => {
    const t = await team();
    for (let i = 0; i < 4; i++) expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, `https://example.com/${i}`)).status).toBe(201);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("five.pdf", "pdf"))).status).toBe(201);
    const file = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("six.pdf", "pdf"));
    expect([file.status, file.error?.code]).toEqual([409, "EVIDENCE_LIMIT"]);
    const link = await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com/6");
    expect([link.status, link.error?.code]).toEqual([409, "EVIDENCE_LIMIT"]);
    expect(await evidenceOf(t.aTask.id)).toHaveLength(5);
    expect(await filesOnDisk()).toHaveLength(1);
  });

  it("refuses files over 10 MB with FILE_TOO_LARGE and leaves nothing on disk", async () => {
    const t = await team();
    // Just over the cap: inside the body limit, refused by the size check before the pre-check.
    const over = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("big.pdf", "pdf", MAX_EVIDENCE_FILE_BYTES + 1));
    expect([over.status, over.error?.code]).toEqual([413, "FILE_TOO_LARGE"]);
    // Well over: the body limit stops it without reading it.
    const huge = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("huge.pdf", "pdf", MAX_EVIDENCE_FILE_BYTES + 512 * 1024));
    expect([huge.status, huge.error?.code]).toEqual([413, "FILE_TOO_LARGE"]);
    // The stream turns out larger than allowed while it is written: the provider removes the partial file.
    const storage = getStorage();
    const put = storage.put.bind(storage);
    vi.spyOn(storage, "put").mockImplementation(async (key, body, opts) => {
      // Two chunks, the second one past the (lowered) cap.
      const all = new Uint8Array(await new Response(body).arrayBuffer());
      const chunks = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(all.subarray(0, 50));
          controller.enqueue(all.subarray(50));
          controller.close();
        },
      });
      return put(key, chunks, { ...opts, maxBytes: 60 });
    });
    const streamed = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("small.pdf", "pdf", 100));
    expect([streamed.status, streamed.error?.code]).toEqual([413, "FILE_TOO_LARGE"]);
    expect(await filesOnDisk()).toEqual([]);
    expect(await testDb.evidence.count()).toBe(0);
    // Exactly 10 MB is fine.
    vi.restoreAllMocks();
    const max = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("max.pdf", "pdf", MAX_EVIDENCE_FILE_BYTES));
    expect(max.status).toBe(201);
    expect((await evidenceOf(t.aTask.id))[0]!.sizeBytes).toBe(MAX_EVIDENCE_FILE_BYTES);
  });

  it("sniffs the bytes: renamed programs and binary 'csv' files are refused, Office and text files accepted", async () => {
    const t = await team();
    const refused = [
      fakeFile("report.pdf", "exe", 512),
      fakeFile("scores.csv", Uint8Array.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x10]), 64),
      // A zip is only accepted as an Office file.
      fakeFile("archive.zip", "docx", 64),
      fakeFile("notes.txt", "csv"),
    ];
    for (const file of refused) {
      const res = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, file);
      expect([file.name, res.status, res.error?.code]).toEqual([file.name, 400, "FILE_TYPE_UNSUPPORTED"]);
    }
    const utf16 = Uint8Array.from([0xff, 0xfe, ...[..."name,score\n"].flatMap((ch) => [ch.charCodeAt(0), 0])]);
    const accepted = [
      fakeFile("报告.docx", "docx", 300),
      fakeFile("预算.xls", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 300),
      fakeFile("问卷.csv", "csv", 200),
      fakeFile("export.csv", utf16),
    ];
    for (const file of accepted) {
      const res = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, file);
      expect([file.name, res.status]).toEqual([file.name, 201]);
    }
    const rows = await evidenceOf(t.aTask.id);
    expect(rows.map((e) => [e.name, e.mimeType, e.storageKey!.split(".").pop()])).toEqual([
      ["报告.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
      ["预算.xls", "application/vnd.ms-excel", "xls"],
      ["问卷.csv", "text/csv", "csv"],
      ["export.csv", "text/csv", "csv"],
    ]);
    expect(await filesOnDisk()).toHaveLength(4);
  });

  it("caps the project's files at 20 MB in total, old attempts included", async () => {
    const t = await team();
    const ten = (name: string) => fakeFile(name, "pdf", MAX_EVIDENCE_FILE_BYTES);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, ten("a1.pdf"))).status).toBe(201);
    // Attempt 1 of task A is handed in and graded: its files still count.
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "FAIL", "少了附录")).status).toBe(200);
    // Exactly 20 MB fits.
    expect((await uploadEvidence(t.b.token, t.projectId, t.bTask.id, ten("b1.pdf"))).status).toBe(201);

    const tiny = () => fakeFile("tiny.csv", Uint8Array.from([0x61]));
    const full = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, tiny());
    expect([full.status, full.error?.code]).toEqual([409, "PROJECT_STORAGE_FULL"]);
    expect(await filesOnDisk()).toHaveLength(2);
    // Links don't take space.
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);

    const [bFile] = await evidenceOf(t.bTask.id);
    const del = await call(`/api/projects/${t.projectId}/tasks/${t.bTask.id}/evidence/${bFile!.id}`, { method: "DELETE", token: t.b.token });
    expect(del.status).toBe(200);
    const ok = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, tiny());
    expect(ok.status).toBe(201);
    expect(await testDb.attempt.findMany({ where: { taskId: t.aTask.id }, orderBy: { no: "asc" }, select: { no: true, status: true } })).toEqual([
      { no: 1, status: "GRADED" },
      { no: 2, status: "DRAFT" },
    ]);
  });

  it("refuses evidence for a task with full points (TASK_DONE) or one waiting for review (ALREADY_REVIEWING)", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    const waiting = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("b.pdf", "pdf"));
    expect([waiting.status, waiting.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
    const waitingLink = await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com");
    expect([waitingLink.status, waitingLink.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "PASS")).status).toBe(200);
    const done = await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("c.pdf", "pdf"));
    expect([done.status, done.error?.code]).toEqual([409, "TASK_DONE"]);
    const doneLink = await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com");
    expect([doneLink.status, doneLink.error?.code]).toEqual([409, "TASK_DONE"]);
    expect(await filesOnDisk()).toHaveLength(1);
  });
});

describe("POST /api/projects/:id/tasks/:taskId/evidence/link", () => {
  it("takes http(s) links up to 2000 characters and names them without the scheme", async () => {
    const t = await team();
    for (const url of ["ftp://example.com/file", "javascript:alert(1)", "example.com", "https://", `https://example.com/${"a".repeat(1990)}`]) {
      const res = await linkEvidence(t.a.token, t.projectId, t.aTask.id, url);
      expect([url.slice(0, 30), res.status, res.error?.code]).toEqual([url.slice(0, 30), 400, "INVALID_LINK"]);
    }
    expect(await testDb.attempt.count()).toBe(0);

    const res = await linkEvidence(t.a.token, t.projectId, t.aTask.id, "  https://forms.gle/abc123  ");
    expect(res.status).toBe(201);
    const long = `http://github.com/cs302/${"x".repeat(1900)}`;
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, long)).status).toBe(201);
    const rows = await evidenceOf(t.aTask.id);
    expect(rows.map((e) => ({ kind: e.kind, name: e.name, url: e.url, storageKey: e.storageKey }))).toEqual([
      { kind: "LINK", name: "forms.gle/abc123", url: "https://forms.gle/abc123", storageKey: null },
      { kind: "LINK", name: `${long.slice(7, 66)}…`, url: long, storageKey: null },
    ]);
    expect(rows[1]!.name).toHaveLength(60);
    // Adding a link starts the task too.
    expect(await taskRow(t.aTask.id)).toMatchObject({ status: "DOING", startedById: t.rows.a.id });
    const other = await linkEvidence(t.b.token, t.projectId, t.aTask.id, "https://example.com");
    expect(other.status).toBe(403);
  });
});

describe("DELETE /api/projects/:id/tasks/:taskId/evidence/:evidenceId", () => {
  it("removes evidence from the draft only, and the file from disk", async () => {
    const t = await team();
    const del = (token: string, taskId: string, evidenceId: string) =>
      call(`/api/projects/${t.projectId}/tasks/${taskId}/evidence/${evidenceId}`, { method: "DELETE", token });
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("b.png", "png"))).status).toBe(201);
    const [a, b] = await evidenceOf(t.aTask.id);

    expect((await del(t.b.token, t.aTask.id, a!.id)).status).toBe(403);
    expect((await del(t.a.token, t.aTask.id, "nope")).status).toBe(404);
    // Evidence of another task isn't reachable through this one.
    expect((await del(t.a.token, t.aTask2.id, a!.id)).status).toBe(404);

    const res = await del(t.a.token, t.aTask.id, a!.id);
    expect(res.status).toBe(200);
    expect(await evidenceOf(t.aTask.id)).toHaveLength(1);
    await expect(onDisk(a!.storageKey!)).rejects.toThrow();
    expect(await filesOnDisk()).toEqual([b!.storageKey]);

    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    const pending = await del(t.a.token, t.aTask.id, b!.id);
    expect([pending.status, pending.error?.code]).toEqual([409, "ALREADY_REVIEWING"]);
    expect((await gradeAs(t.leader.token, t.projectId, t.aTask.id, "HALF", "少了图表")).status).toBe(200);
    const graded = await del(t.a.token, t.aTask.id, b!.id);
    expect([graded.status, graded.error?.code]).toEqual([409, "CONFLICT"]);
    expect(await filesOnDisk()).toEqual([b!.storageKey]);

    // A draft left empty stays: it is the current attempt.
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    const [, link] = await evidenceOf(t.aTask.id);
    expect((await del(t.a.token, t.aTask.id, link!.id)).status).toBe(200);
    expect(await testDb.attempt.findMany({ where: { taskId: t.aTask.id }, orderBy: { no: "asc" }, select: { no: true, status: true } })).toEqual([
      { no: 1, status: "GRADED" },
      { no: 2, status: "DRAFT" },
    ]);
  });
});

describe("opening evidence: GET /api/evidence/:id/link and /api/files/*", () => {
  async function withFiles() {
    const t = await team();
    const pdf = fakeFile("报告 (final).pdf", "pdf", 1500);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, pdf)).status).toBe(201);
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("plan.docx", "docx", 700))).status).toBe(201);
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://forms.gle/abc")).status).toBe(201);
    const [pdfRow, docxRow, linkRow] = await evidenceOf(t.aTask.id);
    return { ...t, pdf, pdfRow: pdfRow!, docxRow: docxRow!, linkRow: linkRow! };
  }
  const linkAs = (token: string, evidenceId: string) => call<EvidenceLink>(`/api/evidence/${evidenceId}/link`, { token });
  const pathOf = (url: string) => url.replace(/^http:\/\/test\.local/, "");

  it("gives every member a 10-minute signed URL that opens the file without a bearer token", async () => {
    const t = await withFiles();
    const before = Date.now();
    // Any member may open it (files are visible to the whole group).
    const res = await linkAs(t.b.token, t.pdfRow.id);
    expect(res.status).toBe(200);
    expect(res.data.url).toMatch(new RegExp(`^http://test\\.local/api/files/${t.pdfRow.storageKey}\\?exp=\\d+&sig=[A-Za-z0-9_-]+$`));
    const expiresAt = new Date(res.data.expiresAt).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);

    const file = await testApp.request(pathOf(res.data.url));
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(await t.pdf.arrayBuffer()));
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-length")).toBe("1500");
    expect(file.headers.get("content-disposition")).toBe(
      `inline; filename="__ (final).pdf"; filename*=UTF-8''${encodeURIComponent("报告")}%20%28final%29.pdf`,
    );
    expect(file.headers.get("cache-control")).toBe("private, max-age=0");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("accept-ranges")).toBe("none");

    // HEAD: the headers without the body. Range: ignored, the whole file.
    const head = await testApp.request(pathOf(res.data.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("application/pdf");
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const ranged = await testApp.request(pathOf(res.data.url), { headers: { Range: "bytes=0-3" } });
    expect(ranged.status).toBe(200);
    expect((await ranged.arrayBuffer()).byteLength).toBe(1500);

    // Office files download instead of opening in place.
    const docx = await linkAs(t.a.token, t.docxRow.id);
    const docxFile = await testApp.request(pathOf(docx.data.url));
    expect(docxFile.status).toBe(200);
    expect(docxFile.headers.get("content-disposition")).toBe(`attachment; filename="plan.docx"; filename*=UTF-8''plan.docx`);
    await docxFile.arrayBuffer();

    // A link is its own URL.
    expect((await linkAs(t.leader.token, t.linkRow.id)).data.url).toBe("https://forms.gle/abc");
  });

  it("answers 404 to non-members, bad signatures, expired links and deleted files", async () => {
    const t = await withFiles();
    const stranger = await person(4);
    expect((await linkAs(stranger.token, t.pdfRow.id)).status).toBe(404);
    expect((await linkAs(t.a.token, "nope")).status).toBe(404);
    expect((await call(`/api/evidence/${t.pdfRow.id}/link`)).status).toBe(401);

    const { url } = (await linkAs(t.a.token, t.pdfRow.id)).data;
    const key = t.pdfRow.storageKey!;
    const exp = Number(new URL(url).searchParams.get("exp"));
    const get = async (p: string) => {
      const res = await testApp.request(p);
      await res.arrayBuffer();
      return res.status;
    };
    expect(await get(pathOf(url))).toBe(200);
    expect(await get(pathOf(url).replace(/sig=[^&]+/, "sig=AAAA"))).toBe(404);
    expect(await get(`/api/files/${key}?exp=${exp}`)).toBe(404);
    // A signature for the other disposition doesn't open it either.
    expect(await get(`/api/files/${key}?exp=${exp}&sig=${signFileUrl("test-secret", key, exp, false)}`)).toBe(404);
    // Changing the expiry breaks the signature; a correctly signed but past expiry is refused too.
    expect(await get(pathOf(url).replace(`exp=${exp}`, `exp=${exp + 60}`))).toBe(404);
    const past = Math.floor(Date.now() / 1000) - 5;
    expect(await get(`/api/files/${key}?exp=${past}&sig=${signFileUrl("test-secret", key, past, true)}`)).toBe(404);
    expect(await get(`/api/files/../../etc/passwd?exp=${exp}&sig=x`)).toBe(404);

    const del = await call(`/api/projects/${t.projectId}/tasks/${t.aTask.id}/evidence/${t.pdfRow.id}`, { method: "DELETE", token: t.a.token });
    expect(del.status).toBe(200);
    expect(await get(pathOf(url))).toBe(404);
    expect((await linkAs(t.a.token, t.pdfRow.id)).status).toBe(404);
  });
});

describe("SUBMITTED for mixed evidence", () => {
  it("says whether everything handed in is a file", async () => {
    const t = await team();
    expect((await uploadEvidence(t.a.token, t.projectId, t.aTask.id, fakeFile("a.pdf", "pdf"))).status).toBe(201);
    expect((await linkEvidence(t.a.token, t.projectId, t.aTask.id, "https://example.com")).status).toBe(201);
    expect((await submitAs(t.a.token, t.projectId, t.aTask.id)).status).toBe(200);
    const [n] = await notificationsOf(t.leader.user.id, "SUBMITTED");
    expect(n!.payload).toMatchObject({ evidenceCount: 2, allFiles: false });
  });
});
