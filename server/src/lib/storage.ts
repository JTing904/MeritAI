// Where evidence files live (M4 spec §5). Only the local-disk provider exists in M4; a Supabase Storage
// provider implements the same interface later.
//
// Vercel caveat: a Vercel function caps request AND response bodies at 4.5 MB (streamed responses are
// exempt) and its filesystem is read-only, so in production uploads must not go through the API. The
// intended production path is createDirectUpload (a Supabase signed upload URL: POST …/evidence/file/prepare
// → the app uploads → POST …/evidence/file/done), not built in M4. With Supabase, signedUrl returns
// Supabase's own signed URL and /api/files/* is unused.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export type PutOptions = { mimeType: string; maxBytes: number };
export type StoredObject = { key: string; sizeBytes: number };

/** More bytes than PutOptions.maxBytes arrived; the partial object is already removed. */
export class TooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`The file is larger than ${maxBytes} bytes`);
    this.name = "TooLargeError";
  }
}

export interface StorageProvider {
  /** Streams `body` into the object. More than `maxBytes` → throws TooLargeError and removes the partial object. */
  put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, opts: PutOptions): Promise<StoredObject>;
  /** Opens the object for streaming (null when missing). */
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; sizeBytes: number } | null>;
  /** Missing → no-op. */
  delete(key: string): Promise<void>;
  /** Everything under a prefix, e.g. a project's folder (M5 project deletion). */
  deletePrefix(prefix: string): Promise<void>;
  /** A URL a browser opens WITHOUT our bearer token, valid for expiresInSec. */
  signedUrl(key: string, opts: { expiresInSec: number; fileName: string; mimeType: string; inline: boolean }): Promise<string>;
  /** Supabase later: where the app uploads directly (signed upload URL, fixed 2 h). null = upload through the API (local). */
  createDirectUpload(key: string, opts: PutOptions): Promise<{ url: string; headers: Record<string, string>; expiresAt: string } | null>;
}

/** "<projectId>/<taskId>/<file id>.<ext>": no "..", no leading slash, nothing a path could escape with. */
export const isStorageKey = (k: string): boolean => /^[a-z0-9]+\/[a-z0-9]+\/[a-z0-9]+\.[a-z0-9]{2,5}$/.test(k);

/** The key's file part: 24 hex characters (no cuid library on the server, and randomUUID has hyphens). */
export const newFileId = (): string => randomBytes(12).toString("hex");

/** A project's folder ("<projectId>") or a task's ("<projectId>/<taskId>"). */
const isStoragePrefix = (p: string): boolean => /^[a-z0-9]+(\/[a-z0-9]+)?$/.test(p);

function assertKey(key: string): void {
  if (!isStorageKey(key)) throw new Error(`Invalid storage key: ${key}`);
}

/** HMAC over the key, the expiry (unix seconds) and the disposition, base64url. */
export function signFileUrl(secret: string, key: string, exp: number, inline: boolean): string {
  return createHmac("sha256", secret).update(`${key}\n${exp}\n${inline ? 1 : 0}`).digest("base64url");
}

/** Constant-time check of a signature from a /api/files URL. */
export function verifyFileSignature(secret: string, key: string, exp: number, inline: boolean, sig: string): boolean {
  const expected = Buffer.from(signFileUrl(secret, key, exp, inline));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Files under `root`, one folder per project and task; `.part` files while an upload is being written. */
export class LocalDiskStorage implements StorageProvider {
  constructor(
    readonly root: string,
    private readonly secret: string,
    private readonly publicApiUrl: string,
  ) {}

  private pathOf(key: string): string {
    assertKey(key);
    return path.join(this.root, ...key.split("/"));
  }

  async put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, opts: PutOptions): Promise<StoredObject> {
    const file = this.pathOf(key);
    const part = `${file}.part`;
    await mkdir(path.dirname(file), { recursive: true });
    const out = createWriteStream(part);
    let sizeBytes = 0;
    try {
      const chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> =
        body instanceof Uint8Array ? [body] : Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
      for await (const chunk of chunks) {
        sizeBytes += chunk.byteLength;
        if (sizeBytes > opts.maxBytes) throw new TooLargeError(opts.maxBytes);
        if (!out.write(chunk)) await new Promise<void>((resolve, reject) => out.once("drain", resolve).once("error", reject));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      await rename(part, file);
    } catch (err) {
      // The stream opens its file asynchronously: unlink only once it has closed, or a first chunk that is
      // already too large removes nothing and the stream creates the .part file afterwards.
      await new Promise<void>((resolve) => {
        if (out.closed) return resolve();
        out.once("close", () => resolve());
        out.destroy();
      });
      await unlink(part).catch(() => {});
      throw err;
    }
    return { key, sizeBytes };
  }

  async get(key: string): Promise<{ body: ReadableStream<Uint8Array>; sizeBytes: number } | null> {
    const file = this.pathOf(key);
    let sizeBytes: number;
    try {
      sizeBytes = (await stat(file)).size;
    } catch {
      return null;
    }
    const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
    return { body, sizeBytes };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!isStoragePrefix(prefix)) throw new Error(`Invalid storage prefix: ${prefix}`);
    await rm(path.join(this.root, ...prefix.split("/")), { recursive: true, force: true });
  }

  async signedUrl(key: string, opts: { expiresInSec: number; fileName: string; mimeType: string; inline: boolean }): Promise<string> {
    assertKey(key);
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSec;
    const sig = signFileUrl(this.secret, key, exp, opts.inline);
    return `${this.publicApiUrl}/api/files/${key}?exp=${exp}&sig=${sig}`;
  }

  async createDirectUpload(): Promise<null> {
    return null;
  }
}

/** <server>/uploads (gitignored), unless UPLOAD_DIR says otherwise (relative paths resolve from the working directory). */
function uploadRoot(): string {
  const dir = process.env.UPLOAD_DIR?.trim();
  if (dir) return path.resolve(dir);
  return fileURLToPath(new URL("../../uploads", import.meta.url));
}

let storage: StorageProvider | null = null;
let secret: string | null = null;

/** The secret that signs /api/files URLs (AUTH_SECRET, read once). Throws a clear error when it is missing. */
export function fileUrlSecret(): string {
  if (secret === null) {
    const value = process.env.AUTH_SECRET?.trim();
    if (!value) throw new Error("AUTH_SECRET is not set: it signs the links that open evidence files (see .env.example)");
    secret = value;
  }
  return secret;
}

/** STORAGE_DRIVER=local (default) | supabase (not built yet). Created on first use and reused. */
export function getStorage(): StorageProvider {
  if (storage) return storage;
  const driver = (process.env.STORAGE_DRIVER ?? "local").trim() || "local";
  if (driver === "supabase") throw new Error("STORAGE_DRIVER=supabase is not built yet (M4 only has the local driver)");
  if (driver !== "local") throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  // Vercel's filesystem is read-only (and a function can't take the upload anyway): see the caveat above.
  if (process.env.VERCEL) throw new Error("STORAGE_DRIVER=local can't run on Vercel; evidence uploads need the Supabase driver");
  const publicApiUrl = (process.env.PUBLIC_API_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  storage = new LocalDiskStorage(uploadRoot(), fileUrlSecret(), publicApiUrl);
  return storage;
}

/** Tests: forget the provider so the next getStorage() reads the environment again. */
export function resetStorageForTests(): void {
  storage = null;
  secret = null;
}
