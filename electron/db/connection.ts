/* Single SQLite connection and compatibility layer for MMS. */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app, dialog } from "electron";
import { fileURLToPath } from "node:url";
import { computeDeviceFingerprint } from "../services/device-fingerprint.js";
import { installTokenDateGuard } from "./token-guard.js";
import { ensureRuntimeSchema } from "./runtime-schema.js";
import { renumberDemoDocuments, provisionDemoReceiptVerificationCodes, provisionCertificateVerificationCodes } from "../services/demo-renumber.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export type DB = Database.Database;
let db: DB | null = null;

function resourcesDir(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "resources"), process.resourcesPath]
    : [path.join(__dirname, "..", "resources"), path.join(process.cwd(), "resources"), path.join(app.getAppPath(), "resources")];
  for (const c of candidates) if (fs.existsSync(path.join(c, "sql", "schema.sql"))) return c;
  throw new Error(`Could not find SQL resources. Checked: ${candidates.join(", ")}`);
}
function userDataDir(): string { const d = app.getPath("userData"); fs.mkdirSync(d, { recursive: true }); return d; }
function dbPath(): string { return path.join(userDataDir(), "mms.db"); }
function moveDbSet(base: string, target: string) { for (const suffix of ["", "-wal", "-shm"]) { const s = base + suffix; if (fs.existsSync(s)) fs.renameSync(s, target + suffix); } }
function backupDb(): string | null { const p = dbPath(); if (!fs.existsSync(p)) return null; const b = `${p}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`; try { moveDbSet(p, b); return b; } catch (e) { console.error("[db] Could not preserve database:", e); return null; } }

function recoverEmptyDatabase(database: DB): DB {
  try {
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='families'").get()) return database;
    const count = Number((database.prepare("SELECT COUNT(*) AS c FROM families").get() as {c:number}).c);
    if (count > 0) return database;
    const candidates = fs.readdirSync(userDataDir()).filter(n => /^mms\.db\.corrupt-\d{4}-/.test(n) && !n.endsWith("-wal") && !n.endsWith("-shm")).sort().reverse();
    for (const name of candidates) {
      const candidate = path.join(userDataDir(), name); let backup: DB | null = null;
      try {
        backup = new Database(candidate, { readonly:true, fileMustExist:true });
        if (!backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='families'").get()) continue;
        const familyCount = Number((backup.prepare("SELECT COUNT(*) AS c FROM families").get() as {c:number}).c);
        if (familyCount <= 0) continue;
        backup.close(); backup = null; database.close(); db = null;
        const live = dbPath(); if (fs.existsSync(live)) moveDbSet(live, `${live}.empty-${new Date().toISOString().replace(/[:.]/g,"-")}`);
        moveDbSet(candidate, live); db = new Database(live); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); ensureRuntimeSchema(db);
        console.warn(`[db] Recovered ${familyCount} families from ${name}`);
        dialog.showMessageBoxSync({type:"info",title:"MMS — Previous Data Recovered",message:`${familyCount} family records were recovered from the preserved database.`,buttons:["OK"]});
        return db;
      } catch (e) { console.warn(`[db] Recovery candidate ${name} failed:`, e); }
      finally { try { backup?.close(); } catch {} }
    }
  } catch (e) { console.warn("[db] Empty database recovery check failed:", e); }
  return database;
}

export function getDB(): DB {
  if (db) return db;
  const p = dbPath();
  try {
    db = new Database(p); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); initializeSchema(db);
    // schema.sql / seed.sql and several migrations toggle PRAGMA foreign_keys
    // for their own DDL purposes and the LAST one to run (seed.sql on fresh
    // databases, V024/V025 on older ones) leaves it OFF. Referential integrity
    // — including the token_events → token_assignments ON DELETE CASCADE —
    // must hold for the live connection, so re-assert it AFTER every SQL file
    // has run. (No transaction is open here, so the pragma applies.)
    db.pragma("foreign_keys = ON");
    db = recoverEmptyDatabase(db); return db!;
  } catch (err) {
    console.error("[db] Initialization failed:", err); if (db) { try { db.close(); } catch {} db = null; }
    const choice = dialog.showMessageBoxSync({type:"error",title:"MMS — Database Error",message:"The existing database could not be opened safely.",detail:`${err instanceof Error ? err.message : String(err)}\n\nThe existing database will be preserved.`,buttons:["Yes — Preserve & Create Fresh","No — Exit"],defaultId:1,cancelId:1});
    if (choice !== 0) throw new Error("Database initialization failed; existing data was preserved");
    const backup = backupDb();
    try { db = new Database(p); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); initializeSchema(db); db.pragma("foreign_keys = ON"); console.warn(`[db] Fresh database created; previous database preserved at ${backup ?? "(none)"}`); return db; }
    catch (retryErr) { if (db) { try { db.close(); } catch {} db = null; } throw new Error(`Could not create a fresh database: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`); }
  }
}

function initializeSchema(database: DB) {
  const hasSchema = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  if (!hasSchema) {
    const dir = path.join(resourcesDir(), "sql"); const schema = path.join(dir,"schema.sql"); const seed = path.join(dir,"seed.sql");
    if (!fs.existsSync(schema)) throw new Error(`Schema file not found: ${schema}`);
    database.exec(fs.readFileSync(schema,"utf8")); if (fs.existsSync(seed)) database.exec(fs.readFileSync(seed,"utf8"));
  }
  // ensureRuntimeSchema runs once before migrations to add optional columns that
  // older databases may be missing (so migrations don't fail on column lookups),
  // and ONCE AGAIN afterwards: some tables (e.g. subscription_payments, V030)
  // are CREATED by a migration, so columns those tables need (e.g. the receipt
  // verification_code) can only be added after the migration has run. Every
  // addColumn is guarded by a column-existence check, so the second pass is a
  // cheap no-op on databases that already have everything.
  ensureRuntimeSchema(database);
  applyMigrations(database);
  ensureRuntimeSchema(database);
  provisionDeviceFingerprint(database);
  provisionQrSigningKey(database);
  // Demo profile only: re-issue legacy demo numbers (DON-/RCP-/CERT-) in the
  // unified MAHALLU/… scheme. Idempotent, rolled back on failure, and a
  // no-op on real mahallu databases (settings.demo_data = 0).
  renumberDemoDocuments(database as any);
  // Demo profile only: receipt verification codes for the seeded money rows
  // so the verify box works immediately on the demo data (real mahallu rows
  // get a code the moment their first receipt is generated — see
  // receipt.service.ts ensureDonation/SubscriptionVerificationCode).
  provisionDemoReceiptVerificationCodes(database as any);
  // Certificates issued before the anti-forgery feature have NO verification
  // code, and without a code a certificate print shows NO verify box / NO QR
  // at all. Mint codes for every existing certificate once at startup —
  // additive, idempotent, and issued codes never change afterwards.
  provisionCertificateVerificationCodes(database as any);
  const users = Number((database.prepare("SELECT COUNT(*) AS c FROM users").get() as {c:number}).c);
  if (users === 0) console.warn("[db] users table is empty — login may require initial setup");
}

/** Compute and store this machine's fingerprint once, so every later QR
 *  payload uses the same stable value. Re-runs keep the stored value. */
function provisionDeviceFingerprint(database: DB) {
  try {
    const row = database.prepare("SELECT device_fingerprint FROM settings WHERE id = 1").get() as { device_fingerprint: string | null } | undefined;
    if (!row || !row.device_fingerprint) {
      database.prepare("UPDATE settings SET device_fingerprint = ? WHERE id = 1").run(computeDeviceFingerprint());
    }
  } catch (err) { console.warn("[db] could not provision device fingerprint:", err); }
}

/** Provision the QR signing key once — 32 random bytes, hex-encoded. It
 *  signs every printed QR (HMAC tail) and is NEVER printed or exported; a
 *  restored backup keeps its key, so prints issued before the restore still
 *  verify. Re-runs keep the stored key. */
function provisionQrSigningKey(database: DB) {
  try {
    const row = database.prepare("SELECT qr_signing_key FROM settings WHERE id = 1").get() as { qr_signing_key: string | null } | undefined;
    if (!row || !row.qr_signing_key) {
      database.prepare("UPDATE settings SET qr_signing_key = ? WHERE id = 1").run(crypto.randomBytes(32).toString("hex"));
    }
  } catch (err) { console.warn("[db] could not provision QR signing key:", err); }
}

function applyMigrations(database: DB) {
  const dir = path.join(resourcesDir(), "sql", "migrations"); if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => /^V\d+.*\.sql$/i.test(f)).sort();
  let current = Number((database.prepare("SELECT MAX(version) AS v FROM schema_version").get() as {v:number|null}).v ?? 0);
  for (const file of files) {
    const match = file.match(/^V(\d+)/); if (!match) continue; const version = Number(match[1]); if (version <= current) continue;
    const sql = fs.readFileSync(path.join(dir,file),"utf8");
    try {
      database.exec("BEGIN"); database.exec(sql); database.prepare("INSERT OR IGNORE INTO schema_version(version,description) VALUES(?,?)").run(version,file); database.exec("COMMIT"); current = version;
    } catch (err) {
      try { database.exec("ROLLBACK"); } catch {}
      const msg = String(err);
      if (/duplicate column|already exists/i.test(msg)) { database.prepare("INSERT OR IGNORE INTO schema_version(version,description) VALUES(?,?)").run(version,`${file} (compatibility-reconciled)`); current = version; continue; }
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function closeDB(){ if(db){ db.close(); db=null; } }
export function all<T=any>(sql:string,params:any[]=[]):T[]{ return getDB().prepare(sql).all(...params) as T[]; }
export function one<T=any>(sql:string,params:any[]=[]):T|undefined{ return getDB().prepare(sql).get(...params) as T|undefined; }
export function run(sql:string,params:any[]=[]):{id:number;changes:number}{ const info=getDB().prepare(sql).run(...params); return {id:Number(info.lastInsertRowid),changes:info.changes}; }
export function scalar<T=any>(sql:string,params:any[]=[]):T{ const row=one(sql,params) as Record<string,any>|undefined; return row ? (Object.values(row)[0] ?? 0) as T : 0 as T; }
