/**
 * Persistent cache for cacheable map data (DEM / HRDEM / optional live OSM).
 *
 * Browser default: IndexedDB. A native disk backend can be installed later by
 * exposing window.mapCache (get/put/stats/clear) — same row shape as nig-drives.
 *
 * Do NOT store Bing / Cesium ion / Esri imagery tiles here (HTTP cache only).
 */
export const CACHE_PREFIX = 'v0315:';
const DB_NAME = 'wwtp-na-map';
const STORE = 'responses';
/** Soft cap: 16 GiB, or 80% of the browser quota if that is smaller. */
const CAP_BYTES = 16 * 1024 ** 3;
const QUOTA_FRACTION = 0.8;
const DEM_REFRESH_MS = 30 * 86400_000;

export let cacheNotice = '';
/** true when the browser granted persistent storage; null = not known yet. */
export let storagePersisted: boolean | null = null;

export interface CacheRow {
  key: string;
  t: number;
  data: unknown;
}

export interface DiskCache {
  get(key: string): Promise<CacheRow | null>;
  put(row: CacheRow): Promise<void>;
  stats(): Promise<{ count: number; bytes: number }>;
  clear(): Promise<void>;
}

declare global {
  interface Window {
    mapCache?: DiskCache;
  }
}

const disk = (): DiskCache | undefined => (typeof window !== 'undefined' ? window.mapCache : undefined);

export interface CacheCounters {
  memoryHits: number;
  cacheHits: number;
  networkFetches: number;
  networkTerrarium: number;
  networkHirdem: number;
  puts: number;
  evicted: number;
}

export const cacheCounters: CacheCounters = {
  memoryHits: 0,
  cacheHits: 0,
  networkFetches: 0,
  networkTerrarium: 0,
  networkHirdem: 0,
  puts: 0,
  evicted: 0,
};

export function resetCacheCounters(): void {
  cacheCounters.memoryHits = 0;
  cacheCounters.cacheHits = 0;
  cacheCounters.networkFetches = 0;
  cacheCounters.networkTerrarium = 0;
  cacheCounters.networkHirdem = 0;
  cacheCounters.puts = 0;
  cacheCounters.evicted = 0;
}

async function askPersist(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist || disk()) return;
    storagePersisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    if (!storagePersisted) cacheNotice = 'Browser may clear the map cache (persistent storage not granted)';
  } catch {
    storagePersisted = false;
  }
}
void askPersist();
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      if (!storagePersisted) void askPersist();
    },
    { once: true },
  );
}

let dbP: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbP) return dbP;
  dbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('t', 't');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbP;
}

export async function cacheGet<T>(key: string): Promise<{ data: T; ageMs: number } | null> {
  const native = disk();
  if (native) {
    try {
      const r = await native.get(key);
      if (!r) return null;
      cacheCounters.cacheHits++;
      return { data: r.data as T, ageMs: Date.now() - r.t };
    } catch {
      cacheNotice = 'Map disk unavailable';
      return null;
    }
  }
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as CacheRow | undefined;
        if (!row) return resolve(null);
        cacheCounters.cacheHits++;
        resolve({ data: row.data as T, ageMs: Date.now() - row.t });
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function quotaCap(): Promise<number> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota) return Math.min(CAP_BYTES, QUOTA_FRACTION * estimate.quota);
  } catch {
    /* ignore */
  }
  return CAP_BYTES;
}

async function evictOldest(db: IDBDatabase, targetFree: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const cursor = store.index('t').openCursor(null, 'next');
    let freed = 0;
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c || freed >= targetFree) return;
      const size = new Blob([JSON.stringify(c.value)]).size;
      store.delete(c.primaryKey);
      freed += size;
      cacheCounters.evicted++;
      c.continue();
    };
    tx.oncomplete = () => {
      if (cacheCounters.evicted > 0) cacheNotice = 'Map storage trimmed (oldest tiles)';
      resolve();
    };
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export async function cachePut(key: string, data: unknown): Promise<void> {
  const row: CacheRow = { key, t: Date.now(), data };
  try {
    const native = disk();
    if (native) {
      await native.put(row);
      cacheCounters.puts++;
      return;
    }
    const db = await openDb();
    if (!db) {
      cacheNotice = 'Map storage unavailable';
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(row);
      tx.oncomplete = () => {
        cacheCounters.puts++;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // LRU trim if over cap (oldest-first).
    try {
      const estimate = await navigator.storage?.estimate?.();
      const cap = await quotaCap();
      const usage = estimate?.usage ?? 0;
      if (usage > cap) {
        await evictOldest(db, usage - cap * 0.95);
      }
    } catch {
      /* ignore trim errors */
    }
  } catch {
    cacheNotice = 'Map storage full or unavailable — existing tiles kept';
  }
}

export async function cacheStats(): Promise<{
  count: number;
  bytes: number;
  notice: string;
  persisted: boolean | null;
}> {
  const native = disk();
  if (native) return { ...(await native.stats()), notice: cacheNotice, persisted: true };
  const db = await openDb();
  let count = 0;
  let bytes = 0;
  if (db) {
    await new Promise<void>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) {
          resolve();
          return;
        }
        count++;
        bytes += new Blob([JSON.stringify(c.value)]).size;
        c.continue();
      };
      req.onerror = () => resolve();
    });
  }
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && (estimate.usage ?? 0) / estimate.quota > 0.85) {
    cacheNotice = 'Map storage near browser quota';
  }
  return { count, bytes, notice: cacheNotice, persisted: storagePersisted };
}

export async function clearMapCache(): Promise<void> {
  const native = disk();
  if (native) await native.clear();
  else {
    const db = await openDb();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }
  cacheNotice = '';
  resetCacheCounters();
}

function toB64(bytes: Uint8Array): string {
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 32 * 1024) {
    const chunk = bytes.subarray(i, i + 32 * 1024);
    b64 += String.fromCharCode(...chunk);
  }
  return btoa(b64);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const refreshing = new Set<string>();

function classifyDemUrl(url: string): 'hirdem' | 'terrarium' | 'other' {
  if (url.includes('/dem/') || url.includes('dem/')) return 'hirdem';
  if (url.includes('elevation-tiles-prod') || url.includes('terrarium')) return 'terrarium';
  return 'other';
}

/**
 * Cache-first DEM tile fetch. Soft-refreshes after 30 days when online.
 * Imagery (Bing / Esri) must not use this.
 */
export async function cachedDem(url: string, signal: AbortSignal): Promise<Blob> {
  const key = `dem:${url}`;
  const old = await cacheGet<unknown>(key);
  const kind = classifyDemUrl(url);
  const download = async () => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`DEM ${res.status}`);
    const blob = await res.blob();
    cacheCounters.networkFetches++;
    if (kind === 'terrarium') cacheCounters.networkTerrarium++;
    else if (kind === 'hirdem') cacheCounters.networkHirdem++;
    await cachePut(key, { fmt: 'png64', b64: toB64(new Uint8Array(await blob.arrayBuffer())) });
    return blob;
  };
  if (!old) return download();
  let bytes: Uint8Array;
  if (Array.isArray(old.data)) {
    bytes = new Uint8Array(old.data);
    void cachePut(key, { fmt: 'png64', b64: toB64(bytes) }).catch(() => undefined);
  } else if (
    old.data &&
    typeof old.data === 'object' &&
    'fmt' in old.data &&
    (old.data as { fmt?: string }).fmt === 'png64' &&
    'b64' in old.data
  ) {
    bytes = fromB64((old.data as { b64: string }).b64);
  } else {
    return download();
  }
  if (old.ageMs > DEM_REFRESH_MS && typeof navigator !== 'undefined' && navigator.onLine && !refreshing.has(key)) {
    refreshing.add(key);
    void download()
      .catch(() => undefined)
      .finally(() => refreshing.delete(key));
  }
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

export function formatCacheBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
