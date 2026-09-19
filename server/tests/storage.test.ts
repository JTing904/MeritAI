// Where evidence files live and what they are (M4 spec §5): the local-disk provider, signed file URLs,
// sniffing, and the storage settings. No database.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectEvidenceType, isInlineType } from "../src/lib/evidence-types";
import { fileExtension, safeFileName } from "../src/lib/file-name";
import {
  getStorage,
  isStorageKey,
  LocalDiskStorage,
  newFileId,
  resetStorageForTests,
  signFileUrl,
  TooLargeError,
  verifyFileSignature,
} from "../src/lib/storage";

let root: string;
let storage: LocalDiskStorage;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "meritai-storage-"));
  storage = new LocalDiskStorage(root, "secret", "http://api.test");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetStorageForTests();
  await rm(root, { recursive: true, force: true });
});

const KEY = "proj1/task1/0123456789abcdef01234567.pdf";

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function allFiles(): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (s: string) => new TextEncoder().encode(s);

describe("LocalDiskStorage", () => {
  it("puts, gets and deletes objects by key", async () => {
    const body = text("%PDF-1.7 hello");
    expect(await storage.put(KEY, streamOf(body.subarray(0, 5), body.subarray(5)), { mimeType: "application/pdf", maxBytes: 100 })).toEqual({
      key: KEY,
      sizeBytes: body.byteLength,
    });
    expect(await readFile(path.join(root, "proj1", "task1", "0123456789abcdef01234567.pdf"))).toEqual(Buffer.from(body));
    const got = await storage.get(KEY);
    expect(got!.sizeBytes).toBe(body.byteLength);
    expect(new Uint8Array(await new Response(got!.body).arrayBuffer())).toEqual(body);

    // A Uint8Array body works too.
    const other = "proj1/task2/aaaaaaaaaaaaaaaaaaaaaaaa.png";
    await storage.put(other, bytes(1, 2, 3), { mimeType: "image/png", maxBytes: 3 });
    expect((await storage.get(other))!.sizeBytes).toBe(3);

    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeNull();
    // Missing: no-op.
    await storage.delete(KEY);
    await storage.deletePrefix("proj1");
    expect(await allFiles()).toEqual([]);
  });

  it("stops past maxBytes with TooLargeError and removes the partial file", async () => {
    await expect(storage.put(KEY, streamOf(text("12345"), text("67890")), { mimeType: "text/csv", maxBytes: 7 })).rejects.toBeInstanceOf(TooLargeError);
    expect(await allFiles()).toEqual([]);
    expect(await storage.get(KEY)).toBeNull();
  });

  // The write stream opens its file asynchronously: put() must wait for it to close before unlinking.
  it("removes the partial file when the first chunk is already too large", async () => {
    await expect(storage.put(KEY, text("123456789"), { mimeType: "text/csv", maxBytes: 8 })).rejects.toBeInstanceOf(TooLargeError);
    expect(await allFiles()).toEqual([]);
  });

  it("refuses keys and prefixes that could leave its folder", async () => {
    for (const key of ["../x/y.pdf", "/abs/key/file.pdf", "a/b/c/d.pdf", "a/b/C.pdf", "a/b/file", "a\\b\\c.pdf", "a/../b.pdf"]) {
      expect(isStorageKey(key)).toBe(false);
      await expect(storage.put(key, bytes(1), { mimeType: "application/pdf", maxBytes: 10 })).rejects.toThrow(/Invalid storage key/);
      await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
    }
    await expect(storage.deletePrefix("..")).rejects.toThrow(/Invalid storage prefix/);
    await expect(storage.deletePrefix("")).rejects.toThrow(/Invalid storage prefix/);
    expect(isStorageKey(`p/t/${newFileId()}.docx`)).toBe(true);
    expect(newFileId()).toMatch(/^[0-9a-f]{24}$/);
    expect(await storage.createDirectUpload()).toBeNull();
  });

  it("signs URLs over the key, the expiry and the disposition", async () => {
    const now = Date.now();
    const url = new URL(await storage.signedUrl(KEY, { expiresInSec: 600, fileName: "a.pdf", mimeType: "application/pdf", inline: true }));
    expect(`${url.origin}${url.pathname}`).toBe(`http://api.test/api/files/${KEY}`);
    const exp = Number(url.searchParams.get("exp"));
    expect(exp * 1000).toBeGreaterThanOrEqual(now + 599_000);
    const sig = url.searchParams.get("sig")!;
    expect(sig).toBe(signFileUrl("secret", KEY, exp, true));
    expect(verifyFileSignature("secret", KEY, exp, true, sig)).toBe(true);
    expect(verifyFileSignature("secret", KEY, exp, false, sig)).toBe(false);
    expect(verifyFileSignature("secret", KEY, exp + 1, true, sig)).toBe(false);
    expect(verifyFileSignature("other", KEY, exp, true, sig)).toBe(false);
    expect(verifyFileSignature("secret", KEY.replace("task1", "task2"), exp, true, sig)).toBe(false);
    expect(verifyFileSignature("secret", KEY, exp, true, "short")).toBe(false);
  });
});

describe("getStorage", () => {
  it("builds the local provider from the environment once", () => {
    vi.stubEnv("UPLOAD_DIR", root);
    vi.stubEnv("PUBLIC_API_URL", "http://192.168.1.5:3000/");
    resetStorageForTests();
    const s = getStorage();
    expect(s).toBeInstanceOf(LocalDiskStorage);
    expect((s as LocalDiskStorage).root).toBe(path.resolve(root));
    expect(getStorage()).toBe(s);
  });

  it("refuses to run without AUTH_SECRET, on Vercel, or with a driver that doesn't exist", () => {
    vi.stubEnv("AUTH_SECRET", "");
    resetStorageForTests();
    expect(() => getStorage()).toThrow(/AUTH_SECRET/);
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("VERCEL", "1");
    resetStorageForTests();
    expect(() => getStorage()).toThrow(/Vercel/);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("STORAGE_DRIVER", "supabase");
    resetStorageForTests();
    expect(() => getStorage()).toThrow(/not built yet/);
    vi.stubEnv("STORAGE_DRIVER", "s3");
    expect(() => getStorage()).toThrow(/Unknown STORAGE_DRIVER/);
  });
});

describe("detectEvidenceType", () => {
  const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
  const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

  it("knows PDF and images by their signature, whatever the name", () => {
    expect(detectEvidenceType(text("%PDF-1.4\n..."), "scan.png")).toMatchObject({ ext: "pdf", mimeType: "application/pdf", label: "PDF" });
    expect(detectEvidenceType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "x")).toMatchObject({ ext: "png", mimeType: "image/png" });
    expect(detectEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0), "photo.jpeg")).toMatchObject({ ext: "jpg", mimeType: "image/jpeg" });
    expect(detectEvidenceType(text("RIFF\0\0\0\0WEBPVP8 "), "a.webp")).toMatchObject({ ext: "webp", mimeType: "image/webp" });
    expect(detectEvidenceType(text("\0\0\0\x18ftypheic\0\0"), "IMG_1.HEIC")).toMatchObject({ ext: "heic", mimeType: "image/heic" });
  });

  it("tells Office files apart by container plus extension", () => {
    expect(detectEvidenceType(zip, "报告.docx")).toMatchObject({ ext: "docx", label: "Word" });
    expect(detectEvidenceType(zip, "slides.PPTX")).toMatchObject({ ext: "pptx", label: "PowerPoint" });
    expect(detectEvidenceType(zip, "data.xlsx")).toMatchObject({ ext: "xlsx", label: "Excel" });
    expect(detectEvidenceType(zip, "archive.zip")).toBeNull();
    expect(detectEvidenceType(zip, "report.doc")).toBeNull();
    expect(detectEvidenceType(ole, "old.doc")).toMatchObject({ ext: "doc", mimeType: "application/msword" });
    expect(detectEvidenceType(ole, "old.ppt")).toMatchObject({ ext: "ppt" });
    expect(detectEvidenceType(ole, "预算.xls")).toMatchObject({ ext: "xls", mimeType: "application/vnd.ms-excel" });
    expect(detectEvidenceType(ole, "old.msi")).toBeNull();
    // A program named like a document.
    expect(detectEvidenceType(bytes(0x4d, 0x5a, 0x90, 0x00), "report.pdf")).toBeNull();
    expect(detectEvidenceType(bytes(0x4d, 0x5a, 0x90, 0x00), "report.docx")).toBeNull();
  });

  it("accepts CSV text in UTF-8, UTF-16 with a BOM and GBK, not binary", () => {
    expect(detectEvidenceType(text("姓名,分数\n王子杰,90\n"), "scores.csv")).toMatchObject({ ext: "csv", mimeType: "text/csv", label: "CSV" });
    expect(detectEvidenceType(bytes(0xff, 0xfe, 0x6e, 0x00, 0x61, 0x00), "export.csv")).toMatchObject({ ext: "csv" });
    expect(detectEvidenceType(bytes(0xfe, 0xff, 0x00, 0x6e, 0x00, 0x61), "export.csv")).toMatchObject({ ext: "csv" });
    // 「王子杰」 in GBK: not valid UTF-8, decodes as GB18030.
    expect(detectEvidenceType(bytes(0xcd, 0xf5, 0xd7, 0xd3, 0xbd, 0xdc, 0x2c, 0x39, 0x30), "gbk.csv")).toMatchObject({ ext: "csv" });
    expect(detectEvidenceType(bytes(0x61, 0x00, 0x62), "nul.csv")).toBeNull();
    expect(detectEvidenceType(bytes(), "empty.csv")).toBeNull();
    // Text is only CSV when it is called .csv.
    expect(detectEvidenceType(text("hello"), "notes.txt")).toBeNull();
  });

  it("opens only PDF and images in place", () => {
    expect(isInlineType("application/pdf")).toBe(true);
    expect(isInlineType("image/png")).toBe(true);
    expect(isInlineType("text/csv")).toBe(false);
    expect(isInlineType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });
});

describe("safeFileName", () => {
  it("prefers the fileName field, decodes percent-encoded names and drops control characters", () => {
    expect(safeFileName("市场调研.pdf", "ignored.pdf", "file")).toBe("市场调研.pdf");
    expect(safeFileName(undefined, "%E4%BD%9C%E4%B8%9A.pdf", "file")).toBe("作业.pdf");
    expect(safeFileName("", "a b.pdf", "file")).toBe("ab.pdf");
    expect(safeFileName(undefined, "", "file")).toBe("file");
    expect(safeFileName("x".repeat(300), "", "file")).toHaveLength(255);
    expect(fileExtension("报告.DOCX ")).toBe("docx");
    expect(fileExtension("README")).toBe("");
  });
});
