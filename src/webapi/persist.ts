/*
 * Durable persistence for the in-WebView SQLite database and in-app backups.
 *
 * The mahallu database (mms.db bytes) lives in IndexedDB — durable across
 * app restarts and app updates, private to the app, and available in both
 * the Capacitor WebView and plain browser dev builds. Writes are debounced
 * and force-flushed on page hide / visibility change so a user switching
 * apps can never lose more than a second of data.
 */

const DB_NAME = "mms-web-store";
const DB_VERSION = 1;
const STORE = "kv";
const DB_KEY = "mms.db";
const BACKUPS_KEY = "mms.backups";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openStore();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB put aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadDatabaseBytes(): Promise<Uint8Array | null> {
  try {
    const rec = await idbGet<{ bytes: ArrayBuffer } | ArrayBuffer>(DB_KEY);
    if (!rec) return null;
    if (rec instanceof ArrayBuffer) return new Uint8Array(rec);
    return new Uint8Array(rec.bytes);
  } catch (err) {
    console.warn("[mms.db] could not load persisted database:", err);
    return null;
  }
}

let saveTimer: number | null = null;
let saving = false;
let dirtyAgain = false;

async function writeBytes(bytes: Uint8Array): Promise<void> {
  // Store a plain ArrayBuffer copy: structured clone of a view can detach.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  await idbSet(DB_KEY, { bytes: copy.buffer, savedAt: new Date().toISOString() });
}

/** Immediate synchronous-collection write (used on close / restore). */
export async function writeBytesNow(bytes: Uint8Array): Promise<void> {
  try {
    await writeBytes(bytes);
  } catch (err) {
    console.error("[mms.db] immediate persist failed:", err);
  }
}

/** Fire-and-forget save (single-flight; coalesces rapid mutations). */
export function scheduleSave(getBytes: () => Uint8Array, delay = 700): void {
  dirtyAgain = true;
  if (saveTimer !== null || saving) return;
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    await flushSave(getBytes);
  }, delay);
}

export async function flushSave(getBytes: () => Uint8Array): Promise<void> {
  if (saving) return;
  saving = true;
  dirtyAgain = false;
  try {
    await writeBytes(getBytes());
  } catch (err) {
    console.error("[mms.db] persist failed:", err);
  } finally {
    saving = false;
    if (dirtyAgain && saveTimer === null) scheduleSave(getBytes, 200);
  }
}

/** Install lifecycle hooks so switching/closing the app flushes the DB. */
export function installPersistenceHooks(getBytes: () => Uint8Array): void {
  const flush = () => { void flushSave(getBytes); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  // Belt-and-braces periodic flush for WebView kills without events.
  window.setInterval(flush, 20000);
}

// ---------------------------------------------------------------------------
// In-app backup vault (.mmbak-compatible metadata + db bytes)
// ---------------------------------------------------------------------------

export interface StoredBackup {
  name: string;
  time: string; // ISO
  size: number;
  sha256: string;
  source: "manual" | "auto";
  data: ArrayBuffer; // raw sqlite bytes; wrapper file built on export/verify
}

export async function listStoredBackups(): Promise<StoredBackup[]> {
  try {
    const list = (await idbGet<StoredBackup[]>(BACKUPS_KEY)) || [];
    return list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  } catch {
    return [];
  }
}

export async function putStoredBackup(entry: StoredBackup, keep = 30): Promise<void> {
  const list = await listStoredBackups();
  list.unshift(entry);
  list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  // Retention: keep only the newest N (auto backups pruned first, like desktop).
  const autos = list.filter((b) => b.source === "auto");
  if (autos.length > keep) {
    const doomed = new Set(autos.slice(keep).map((b) => b.name));
    for (const d of doomed) {
      const idx = list.findIndex((b) => b.name === d);
      if (idx >= 0) list.splice(idx, 1);
    }
  }
  await idbSet(BACKUPS_KEY, list.slice(0, 200));
}

export async function deleteStoredBackup(name: string): Promise<void> {
  const list = await listStoredBackups();
  await idbSet(BACKUPS_KEY, list.filter((b) => b.name !== name));
}

export async function getStoredBackup(name: string): Promise<StoredBackup | null> {
  const list = await listStoredBackups();
  return list.find((b) => b.name === name) || null;
}
