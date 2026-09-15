/*
 * Web DB layer for the MMS Android port (Capacitor WebView).
 *
 * Implements the better-sqlite3 surface the Electron service modules use
 * (prepare/get/all/run/iterate, exec, pragma, transaction, close) on top of
 * sql.js (SQLite compiled to WebAssembly), plus the connection helpers the
 * services import from electron/db/connection.js:
 *
 *     getDB, closeDB, all, one, run, scalar
 *
 * A Vite build plugin redirects every `.../db/connection.js` import to THIS
 * module during the Android web build, so the REAL service code runs
 * unmodified inside the WebView against a durable in-app database.
 *
 * Bootstrap mirrors the desktop initializeSchema(): schema.sql, runtime
 * schema reconciliation, V*.sql migrations, device fingerprint + QR signing
 * key provisioning, certificate/receipt verification codes — but NEVER the
 * demo seed (production installs start empty, first run = admin setup).
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { Buffer } from "buffer";
import schemaSql from "../../resources/sql/schema.sql?raw";
import { ensureRuntimeSchema } from "../../electron/db/runtime-schema.js";
import { provisionDemoReceiptVerificationCodes, provisionCertificateVerificationCodes } from "../../electron/services/demo-renumber.service.js";
import { loadDatabaseBytes, scheduleSave, writeBytesNow, installPersistenceHooks } from "./persist";

// Migrations are bundled at build time (sorted lexicographically like fs.readdirSync).
const MIGRATIONS: Array<{ file: string; sql: string }> = Object.entries(
  import.meta.glob("../../resources/sql/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>
)
  .map(([path, sql]) => ({ file: path.split("/").pop() as string, sql }))
  .filter(({ file }) => /^V\d+.*\.sql$/i.test(file))
  .sort((a, b) => a.file.localeCompare(b.file));

/* ------------------------------------------------------------------ */
/* better-sqlite3-shaped wrapper over sql.js                           */
/* ------------------------------------------------------------------ */

function cleanParam(p: unknown): unknown {
  if (p === undefined) return null;
  if (typeof p === "boolean") return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString();
  return p;
}

function cleanParams(params: unknown[]): unknown[] {
  return params.map(cleanParam);
}

class WebStatement {
  constructor(private db: WebDatabase, private sql: string) {}

  get(...params: unknown[]): any {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(cleanParams(params) as any);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      try { stmt.free(); } catch { /* already freed */ }
    }
  }

  all(...params: unknown[]): any[] {
    const stmt = this.db.raw.prepare(this.sql);
    const rows: any[] = [];
    try {
      stmt.bind(cleanParams(params) as any);
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      try { stmt.free(); } catch { /* already freed */ }
    }
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    this.db.raw.run(this.sql, cleanParams(params) as any);
    this.db.persistSoon();
    const changes = this.db.raw.getRowsModified();
    const idRes = this.db.raw.exec("SELECT last_insert_rowid() AS id");
    const lastInsertRowid = Number(idRes?.[0]?.values?.[0]?.[0] ?? 0);
    return { changes, lastInsertRowid };
  }

  *iterate(...params: unknown[]): Generator<any> {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(cleanParams(params) as any);
      while (stmt.step()) yield stmt.getAsObject();
    } finally {
      try { stmt.free(); } catch { /* already freed */ }
    }
  }
}

export class WebDatabase {
  raw: SqlJsDatabase;
  private dirty = false;

  constructor(raw: SqlJsDatabase) {
    this.raw = raw;
  }

  prepare(sql: string): WebStatement {
    return new WebStatement(this, sql);
  }

  exec(sql: string): this {
    this.raw.exec(sql);
    this.persistSoon();
    return this;
  }

  /** Debounced persistence to IndexedDB after any mutation. */
  persistSoon(): void {
    scheduleSave(() => this.raw.export());
  }

  pragma(sql: string): any {
    const cleaned = String(sql).replace(/^PRAGMA\s+/i, "").trim();
    if (/^journal_mode/i.test(cleaned) || /^wal/i.test(cleaned)) return []; // in-memory DB: no-op
    try {
      return this.raw.exec(`PRAGMA ${cleaned}`).flatMap((r: any) =>
        r.values.map((row: any[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, row[i]])))
      );
    } catch {
      return [];
    }
  }

  /** better-sqlite3 transaction(): BEGIN/COMMIT with rollback on throw. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      this.raw.exec("BEGIN");
      try {
        const out = fn(...args);
        this.raw.exec("COMMIT");
        this.persistSoon();
        return out;
      } catch (err) {
        try { this.raw.exec("ROLLBACK"); } catch { /* already rolled back */ }
        throw err;
      }
    };
  }

  close(): void {
    try { this.raw.close(); } catch { /* already closed */ }
  }

  markDirty(): void {
    this.dirty = true;
  }

  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }
}

/* ------------------------------------------------------------------ */
/* Connection singleton — mirrors electron/db/connection.ts helpers    */
/* ------------------------------------------------------------------ */

let db: WebDatabase | null = null;
let initPromise: Promise<WebDatabase> | null = null;

export type DB = WebDatabase;

export function getDB(): WebDatabase {
  if (!db) throw new Error("Database not ready — boot the web bridge first");
  return db;
}

export function closeDB(): void {
  if (db) {
    try {
      const bytes = db.raw.export();
      void writeBytesNow(bytes);
    } catch { /* best effort */ }
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

export function all<T = any>(sql: string, params: unknown[] = []): T[] {
  return getDB().prepare(sql).all(...params) as T[];
}

export function one<T = any>(sql: string, params: unknown[] = []): T | undefined {
  return getDB().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): { id: number; changes: number } {
  const info = getDB().prepare(sql).run(...params);
  return { id: Number(info.lastInsertRowid), changes: info.changes };
}

export function scalar<T = any>(sql: string, params: unknown[] = []): T {
  const row = one(sql, params) as Record<string, any> | undefined;
  return (row ? (Object.values(row)[0] ?? 0) : 0) as T;
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

function tableExists(database: WebDatabase, name: string): boolean {
  return !!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function applyMigrations(database: WebDatabase): void {
  let current = Number((database.prepare("SELECT MAX(version) AS v FROM schema_version").get() as any)?.v ?? 0);
  for (const { file, sql } of MIGRATIONS) {
    const match = file.match(/^V(\d+)/);
    if (!match) continue;
    const version = Number(match[1]);
    if (version <= current) continue;
    try {
      database.exec("BEGIN");
      database.exec(sql);
      database.prepare("INSERT OR IGNORE INTO schema_version(version,description) VALUES(?,?)").run(version, file);
      database.exec("COMMIT");
      current = version;
    } catch (err) {
      try { database.exec("ROLLBACK"); } catch { /* already rolled back */ }
      const msg = String(err);
      if (/duplicate column|already exists/i.test(msg)) {
        database.prepare("INSERT OR IGNORE INTO schema_version(version,description) VALUES(?,?)").run(version, `${file} (compatibility-reconciled)`);
        current = version;
        continue;
      }
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function provisionStartupValues(database: WebDatabase): void {
  // Device fingerprint — a stable random value (desktop hashes machine IDs;
  // on a phone there is exactly one install per device anyway).
  try {
    const row = database.prepare("SELECT device_fingerprint FROM settings WHERE id = 1").get() as { device_fingerprint?: string | null } | undefined;
    if (!row || !row.device_fingerprint) {
      database.prepare("UPDATE settings SET device_fingerprint = ? WHERE id = 1").run(randomHex(16));
    }
  } catch (err) { console.warn("[db.web] fingerprint provisioning skipped:", err); }
  // QR signing key — 32 random bytes hex, provisioned once, never printed.
  try {
    const row = database.prepare("SELECT qr_signing_key FROM settings WHERE id = 1").get() as { qr_signing_key?: string | null } | undefined;
    if (!row || !row.qr_signing_key) {
      database.prepare("UPDATE settings SET qr_signing_key = ? WHERE id = 1").run(randomHex(32));
    }
  } catch (err) { console.warn("[db.web] qr key provisioning skipped:", err); }
  // Verification codes for pre-anti-forgery rows (idempotent, additive).
  try { provisionCertificateVerificationCodes(database as any); } catch (err) { console.warn("[db.web] certificate code provisioning skipped:", err); }
  try { provisionDemoReceiptVerificationCodes(database as any); } catch (err) { console.warn("[db.web] receipt code provisioning skipped:", err); }
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Buffer.from(b).toString("hex");
}

/**
 * Open (or create) the mahallu database. MUST be awaited before any service
 * call — the api boot sequence guarantees this by installing window.mms only
 * after this promise resolves.
 */
export async function initWebDb(): Promise<WebDatabase> {
  if (db) return db;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const persisted = await loadDatabaseBytes();
    const raw = persisted && persisted.length > 0 ? new SQL.Database(persisted) : new SQL.Database();
    const database = new WebDatabase(raw);

    const hasSchema = tableExists(database, "schema_version");
    if (!hasSchema) {
      // Fresh production install: schema only. The desktop's demo seed
      // (seed.sql) is deliberately NOT applied on Android.
      database.exec(schemaSql);
    }
    ensureRuntimeSchema(database as any);
    applyMigrations(database);
    ensureRuntimeSchema(database as any);
    provisionStartupValues(database);
    // Referential integrity must hold for the live connection.
    database.exec("PRAGMA foreign_keys = ON;");
    db = database;
    installPersistenceHooks(() => raw.export());
    // Persist the freshly-created database immediately so a crash right
    // after first boot cannot lose the schema.
    await writeBytesNow(raw.export());
    return database;
  })();
  return initPromise;
}

/** Called after every API-level write so changes reach IndexedDB. */
export function persistSoon(): void {
  const database = db;
  if (!database) return;
  scheduleSave(() => database.raw.export());
}
