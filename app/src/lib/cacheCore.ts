// The client-side data cache (hardening B1), free of React Native imports so it can be checked with plain
// Node. lib/cache.ts creates the app's one instance on AsyncStorage.
//
// Keyed by API path, one owner (user id) at a time: a different user never sees these entries. Entries
// live in memory and the persistable ones are also written to storage (namespaced by user), loaded on the
// next start so a screen shows the last data on its first frame and revalidates behind it.

/** The subset of AsyncStorage this cache uses. */
export type CacheStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
};

export type CacheEntry<T = unknown> = {
  data: T;
  /** The ETag the server sent with `data` (null: none, or the data came from a write's response). */
  etag: string | null;
  /** When the data was last confirmed by the server (a 200 or a 304). */
  at: number;
  /** A write may have changed it: the next show refetches even inside the fresh window. */
  stale: boolean;
  /** Last time a screen asked for it (the LRU order for persisting). */
  used: number;
};

/** A GET's outcome: new data, or 304 (the cached data is still right). */
export type Conditional<T> = { notModified: true; etag: string | null } | { notModified: false; data: T; etag: string | null };

export type Fetcher<T> = (etag: string | null) => Promise<Conditional<T>>;

export type FetchOutcome<T> = { data: T; fromNetwork: boolean };

export type CacheLimits = {
  /** A key fetched this recently (and not stale) is not fetched again on a mount or focus. */
  freshMs: number;
  /** Most entries written to storage (the most recently used ones). */
  maxPersisted: number;
  /** An entry bigger than this (JSON characters) stays in memory only. */
  maxEntryChars: number;
  /** All persisted entries together (web localStorage has about 5M characters for the whole origin). */
  maxTotalChars: number;
  /** Most entries kept in memory. */
  maxMemory: number;
  /** Wait this long after a change before writing, so a burst of changes is one write. */
  persistDelayMs: number;
};

export const DEFAULT_LIMITS: CacheLimits = {
  freshMs: 30_000,
  maxPersisted: 60,
  maxEntryChars: 200_000,
  maxTotalChars: 2_000_000,
  maxMemory: 200,
  persistDelayMs: 400,
};

/** Every storage key starts with this; prefs.clearUserPrefs (sign-out) removes all `meritai.*` user keys. */
export const CACHE_PREFIX = 'meritai.cache.';

type Stored = { d: unknown; e: string | null; t: number };
type IndexRow = [key: string, used: number];

/** Pick what to persist: most recently used first, within the count and size budgets. Pure (tested). */
export function choosePersisted(
  rows: { key: string; used: number; chars: number }[],
  limits: Pick<CacheLimits, 'maxPersisted' | 'maxEntryChars' | 'maxTotalChars'>,
): Set<string> {
  const keep = new Set<string>();
  let total = 0;
  for (const row of [...rows].sort((a, b) => b.used - a.used)) {
    if (keep.size >= limits.maxPersisted) break;
    if (row.chars > limits.maxEntryChars || total + row.chars > limits.maxTotalChars) continue;
    keep.add(row.key);
    total += row.chars;
  }
  return keep;
}

export class QueryCache {
  private owner: string | null = null;
  /** Bumped when the owner changes or the cache is wiped: late answers for the old owner are dropped. */
  private gen = 0;
  private entries = new Map<string, CacheEntry>();
  /** Bumped by set() and markStale(); `writes` only by set()/drop(). Used to spot a fetch that raced a write. */
  private versions = new Map<string, number>();
  private writes = new Map<string, number>();
  /** Bumped each time a request starts for the key: only the newest one may store its answer. */
  private seqs = new Map<string, number>();
  private inflight = new Map<string, { promise: Promise<FetchOutcome<unknown>>; version: number; writes: number; gen: number }>();
  private listeners = new Set<() => void>();
  private hydrating: Promise<void> = Promise.resolve();

  // Persistence bookkeeping for the current owner.
  private persistedChars = new Map<string, number>();
  private dirty = new Set<string>();
  private indexDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  private readonly storage: CacheStorage;
  /** Which keys may be written to storage (e.g. not a brief's full text). */
  private readonly persistable: (key: string) => boolean;
  private readonly limits: CacheLimits;
  private readonly now: () => number;

  constructor(
    storage: CacheStorage,
    persistable: (key: string) => boolean,
    limits: CacheLimits = DEFAULT_LIMITS,
    now: () => number = Date.now,
  ) {
    this.storage = storage;
    this.persistable = persistable;
    this.limits = limits;
    this.now = now;
  }

  // ── Owner ────────────────────────────────────────────────────────────────────────────────────

  get currentOwner(): string | null {
    return this.owner;
  }

  /**
   * Use the cache for this user: a different user than before starts from an empty memory (their own
   * storage is loaded). Resolves once the stored entries are in memory. Calling it again for the same
   * user returns the same load.
   */
  open(owner: string): Promise<void> {
    if (this.owner === owner) return this.hydrating;
    this.resetMemory();
    this.owner = owner;
    const gen = this.gen;
    this.hydrating = this.hydrate(owner, gen);
    this.emit();
    return this.hydrating;
  }

  /** Sign-out / account switch: forget everything in memory and remove this user's stored entries. */
  async wipe(): Promise<void> {
    const owner = this.owner;
    this.resetMemory();
    this.owner = null;
    this.emit();
    await this.writing.catch(() => {});
    if (owner) await this.removeStored(owner);
  }

  private resetMemory() {
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.entries.clear();
    this.inflight.clear();
    this.persistedChars.clear();
    this.dirty.clear();
    this.indexDirty = false;
    // versions/writes keep counting (never reset) so an old in-flight fetch can't match a new one.
  }

  private indexKey(owner: string) {
    return `${CACHE_PREFIX}${owner}`;
  }

  private entryKey(owner: string, key: string) {
    return `${CACHE_PREFIX}${owner}|${key}`;
  }

  private async hydrate(owner: string, gen: number): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.indexKey(owner));
      if (gen !== this.gen || !raw) return;
      const index = JSON.parse(raw) as IndexRow[];
      if (!Array.isArray(index)) return;
      const rows = index.filter((r): r is IndexRow => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'number');
      const pairs = await this.storage.multiGet(rows.map(([key]) => this.entryKey(owner, key)));
      if (gen !== this.gen) return;
      rows.forEach(([key, used], i) => {
        const value = pairs[i]?.[1];
        if (!value || this.entries.has(key)) return; // something newer arrived while loading
        try {
          const s = JSON.parse(value) as Stored;
          if (!s || typeof s !== 'object' || !('d' in s)) return;
          // Loaded from storage: show it, but always check with the server on the next show.
          this.entries.set(key, { data: s.d, etag: typeof s.e === 'string' ? s.e : null, at: s.t || 0, stale: true, used });
          this.persistedChars.set(key, value.length);
        } catch {
          // A corrupt entry is just not shown.
        }
      });
      this.emit();
    } catch {
      // Storage unavailable or corrupt index: start empty.
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────────────────────────────

  get<T>(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key) as CacheEntry<T> | undefined;
  }

  /** The data for `key`, if the cache has any (for the current user). */
  peek<T>(key: string): T | undefined {
    return this.get<T>(key)?.data;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Called on every change (set, drop, stale, owner switch). Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  // ── Writing ──────────────────────────────────────────────────────────────────────────────────

  private bump(map: Map<string, number>, key: string) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /** Put data in (a GET's answer or a write's response). Any fetch already running for it is ignored when it lands. */
  set<T>(key: string, data: T, etag: string | null = null) {
    if (!this.owner) return;
    const t = this.now();
    this.entries.set(key, { data, etag, at: t, stale: false, used: t });
    this.bump(this.versions, key);
    this.bump(this.writes, key);
    this.changed(key);
  }

  /** Change the cached data in place (keeps its ETag and time). Nothing happens when there is none. */
  update<T>(key: string, fn: (data: T) => T) {
    const e = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!e) return;
    this.entries.set(key, { ...e, data: fn(e.data) });
    this.bump(this.writes, key);
    this.changed(key);
  }

  /** Something changed on the server: the matching keys are fetched again the next time they show. */
  markStale(match: (key: string) => boolean) {
    let any = false;
    for (const [key, e] of this.entries) {
      if (!match(key)) continue;
      this.bump(this.versions, key);
      if (!e.stale) {
        e.stale = true;
        any = true;
      }
    }
    // Keys fetching right now with no entry yet: their answer may predate the write.
    for (const key of this.inflight.keys()) if (!this.entries.has(key) && match(key)) this.bump(this.versions, key);
    if (any) this.emit();
  }

  /** Gone on the server (404/403, left or deleted the project): remove from memory and storage. */
  drop(match: (key: string) => boolean) {
    let any = false;
    for (const key of [...this.entries.keys()]) {
      if (!match(key)) continue;
      this.entries.delete(key);
      this.bump(this.versions, key);
      this.bump(this.writes, key);
      this.dirty.delete(key);
      if (this.persistedChars.has(key)) this.indexDirty = true;
      any = true;
    }
    for (const key of this.inflight.keys()) if (match(key)) this.bump(this.writes, key);
    if (any) {
      this.schedulePersist();
      this.emit();
    }
  }

  private changed(key: string) {
    this.evictMemory();
    if (this.persistable(key)) {
      this.dirty.add(key);
      this.indexDirty = true;
      this.schedulePersist();
    }
    this.emit();
  }

  private evictMemory() {
    if (this.entries.size <= this.limits.maxMemory) return;
    const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used);
    for (const [key] of oldest.slice(0, this.entries.size - this.limits.maxMemory)) {
      this.entries.delete(key);
      if (this.persistedChars.has(key)) this.indexDirty = true;
    }
  }

  // ── Fetching ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Stale-while-revalidate: returns the cached data without a request when it was confirmed in the last
   * `freshMs` and nothing marked it stale (unless `force`: pull-to-refresh, 再试一次, after a write). A
   * request already running for the key is shared. Sends the stored ETag; a 304 keeps the data.
   * A fetch that raced a write never overwrites what the write put in.
   */
  fetch<T>(key: string, fetcher: Fetcher<T>, { force = false }: { force?: boolean } = {}): Promise<FetchOutcome<T>> {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    const t = this.now();
    if (entry) {
      entry.used = t;
      this.indexDirty = this.indexDirty || this.persistedChars.has(key);
    }
    if (!force && entry && !entry.stale && t - entry.at < this.limits.freshMs) {
      return Promise.resolve({ data: entry.data, fromNetwork: false });
    }
    const version = this.versions.get(key) ?? 0;
    const writes = this.writes.get(key) ?? 0;
    // Share a request already out, unless something changed since it was sent (its answer may be older).
    const running = this.inflight.get(key);
    if (running && running.gen === this.gen && running.version === version && running.writes === writes) {
      return running.promise as Promise<FetchOutcome<T>>;
    }

    const gen = this.gen;
    this.bump(this.seqs, key);
    const seq = this.seqs.get(key)!;
    const promise = this.run(key, fetcher, entry?.etag ?? null, { gen, version, writes, seq }).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { promise: promise as Promise<FetchOutcome<unknown>>, version, writes, gen });
    return promise;
  }

  private async run<T>(
    key: string,
    fetcher: Fetcher<T>,
    etag: string | null,
    { gen, version, writes, seq }: { gen: number; version: number; writes: number; seq: number },
  ): Promise<FetchOutcome<T>> {
    let res = await fetcher(etag);
    let current = this.entries.get(key) as CacheEntry<T> | undefined;
    if (res.notModified && !current && gen === this.gen) {
      // 304 but the entry was dropped meanwhile: ask again for the full answer.
      res = await fetcher(null);
      current = this.entries.get(key) as CacheEntry<T> | undefined;
    }
    if (gen !== this.gen) {
      // Signed out / someone else signed in while it ran: never store it.
      if (res.notModified) throw new Error('cache owner changed');
      return { data: res.data, fromNetwork: true };
    }
    // A write answered while this GET was out (its data is newer), or a newer GET was sent after it.
    const racedWrite = (this.writes.get(key) ?? 0) !== writes || this.seqs.get(key) !== seq;
    const staleNow = (this.versions.get(key) ?? 0) !== version;
    if (res.notModified) {
      if (!current) throw new Error('304 without cached data');
      if (!racedWrite) {
        current.at = this.now();
        current.stale = staleNow;
        if (res.etag) current.etag = res.etag;
        this.indexDirty = this.indexDirty || this.persistedChars.has(key);
        this.schedulePersist();
      }
      return { data: current.data, fromNetwork: true };
    }
    if (racedWrite) return { data: current ? current.data : res.data, fromNetwork: true };
    const t = this.now();
    this.entries.set(key, { data: res.data, etag: res.etag, at: t, stale: staleNow, used: t });
    this.changed(key);
    return { data: res.data, fromNetwork: true };
  }

  // ── Persisting ───────────────────────────────────────────────────────────────────────────────

  private schedulePersist() {
    if (this.timer || !this.owner) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writing = this.writing.then(() => this.persist()).catch(() => {});
    }, this.limits.persistDelayMs);
  }

  /** Write changed entries and the index now (tests; the app relies on the debounced write). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.writing = this.writing.then(() => this.persist()).catch(() => {});
    return this.writing;
  }

  private async persist() {
    const owner = this.owner;
    const gen = this.gen;
    if (!owner || (!this.dirty.size && !this.indexDirty)) return;
    await this.hydrating.catch(() => {});
    if (gen !== this.gen) return;

    const serialized = new Map<string, string>();
    const rows: { key: string; used: number; chars: number }[] = [];
    for (const [key, e] of this.entries) {
      if (!this.persistable(key)) continue;
      let chars = this.persistedChars.get(key);
      if (chars === undefined || this.dirty.has(key)) {
        const s = JSON.stringify({ d: e.data, e: e.etag, t: e.at } satisfies Stored);
        serialized.set(key, s);
        chars = s.length;
      }
      rows.push({ key, used: e.used, chars });
    }
    const keep = choosePersisted(rows, this.limits);
    const toWrite: [string, string][] = [];
    for (const key of keep) {
      const s = serialized.get(key);
      if (s !== undefined) toWrite.push([this.entryKey(owner, key), s]);
    }
    const toRemove = [...this.persistedChars.keys()].filter((key) => !keep.has(key));
    const index: IndexRow[] = rows.filter((r) => keep.has(r.key)).map((r) => [r.key, r.used]);
    this.dirty.clear();
    this.indexDirty = false;

    try {
      if (toRemove.length) await this.storage.multiRemove(toRemove.map((key) => this.entryKey(owner, key)));
      if (toWrite.length) await this.storage.multiSet(toWrite);
      if (gen !== this.gen) return; // wiped meanwhile: wipe() removes what was just written
      await this.storage.setItem(this.indexKey(owner), JSON.stringify(index));
      for (const key of toRemove) this.persistedChars.delete(key);
      for (const [k, s] of toWrite) this.persistedChars.set(k.slice(this.entryKey(owner, '').length), s.length);
    } catch {
      // Quota or storage failure: memory still works; the next change tries again.
    }
  }

  private async removeStored(owner: string) {
    try {
      const raw = await this.storage.getItem(this.indexKey(owner));
      const index = raw ? (JSON.parse(raw) as IndexRow[]) : [];
      const keys = Array.isArray(index) ? index.map((r) => this.entryKey(owner, String(r[0]))) : [];
      await this.storage.multiRemove([...keys, this.indexKey(owner)]);
    } catch {
      // clearUserPrefs removes every meritai.* user key anyway.
    }
  }
}
