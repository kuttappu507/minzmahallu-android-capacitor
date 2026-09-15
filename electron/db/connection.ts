/* Single SQLite connection and compatibility layer for MMS. */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app, dialog } from "electron";
import { fileURLToPath } from "node:url";
import { computeDeviceFingerprint } from "../services/device-fingerprint.js";
import { installTokenDateGuard } from "./token-guard.js";
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
function columns(database: DB, table: string): Set<string> { return new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(x => x.name)); }
function addColumn(database: DB, table: string, name: string, definition: string) { if (!columns(database, table).has(name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); }

/** Reconcile fields and feature tables used by the current CRUD layer before migrations run. */
function ensureRuntimeSchema(database: DB) {
  const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(x => x.name));
  if (!tables.has("families") || !tables.has("members")) throw new Error("Core MMS tables are missing");
  const fields: Array<[string,string,string]> = [
    ["settings","subscription_monthly_amount","REAL NOT NULL DEFAULT 100"],
    ["settings","subscription_frequency","TEXT NOT NULL DEFAULT 'Monthly'"],
    ["settings","subscription_quarterly_amount","REAL NOT NULL DEFAULT 300"],
    // Auto-backup retention — how many automatic .mmbak files to keep on disk
    ["settings","backup_keep_count","INTEGER NOT NULL DEFAULT 30"],
    ["settings","affiliation_number","TEXT"],
    ["settings","committee_term_start","TEXT"],
    ["settings","committee_term_end","TEXT"],
    // V027 — official certificate reg nos + mahallu jurisdiction (idempotent guards)
    ["settings","wakf_reg_no","TEXT"],
    ["settings","society_reg_no","TEXT"],
    ["settings","village","TEXT"],
    ["settings","panchayath","TEXT"],
    ["settings","taluk","TEXT"],
    ["settings","district","TEXT"],
    ["settings","pincode","TEXT"],
    ["settings","state","TEXT"],
    // V027 — extended death register fields (official SMF certificate format)
    ["deaths","place_of_death","TEXT"],
    ["deaths","address","TEXT"],
    ["deaths","registration_date","TEXT"],
    ["families","archived_at","TEXT"],["families","archived_by","INTEGER"],["families","archive_reason","TEXT"],
    ["members","archive_state","INTEGER NOT NULL DEFAULT 0"],["members","archive_source","TEXT"],["members","archived_at","TEXT"],["members","archived_by","INTEGER"],["members","archive_reason","TEXT"],["members","father_name","TEXT"],
    ["donations","transaction_ref","TEXT"],["donations","updated_at","TEXT"],
    ["transactions","transaction_ref","TEXT"],["transactions","updated_at","TEXT"],
    ["marriages","updated_at","TEXT"],["deaths","updated_at","TEXT"],
    ["welfare_requests","request_date","TEXT"],["welfare_requests","rejection_reason","TEXT"],["welfare_requests","processed_by","INTEGER"],["welfare_requests","processed_date","TEXT"],
    ["certificates","status","TEXT NOT NULL DEFAULT 'Issued'"],["audit_log","metadata","TEXT"],
    // V030 — voucher/bill control fields on manual transactions (audit evidence for expenses)
    ["transactions","voucher_no","TEXT"],["transactions","bill_no","TEXT"],["transactions","payee","TEXT"],
    // V031 — receipt VOID workflow + certificate anti-forgery
    ["transactions","status","TEXT NOT NULL DEFAULT 'Posted'"],["transactions","voided_at","TEXT"],["transactions","voided_by","INTEGER"],["transactions","void_reason","TEXT"],
    // V036 — ledger categories on manual transactions (shop rent, goods rent, hall rent etc.)
    ["transactions","category","TEXT"],
    ["certificates","verification_code","TEXT"],["certificates","reprint_count","INTEGER NOT NULL DEFAULT 0"],
    // V030 — member family-tree links (father/mother/spouse as member references)
    ["members","father_id","INTEGER"],["members","mother_id","INTEGER"],["members","spouse_id","INTEGER"],
    // V030 — tamper-evident audit chain columns + demo-data flag
    ["audit_log","prev_hash","TEXT"],["audit_log","entry_hash","TEXT"],
    ["settings","demo_data","INTEGER NOT NULL DEFAULT 0"],
    // QR anti-forgery — device fingerprint + HMAC signing key bound into QR payloads
    ["settings","device_fingerprint","TEXT"],
    ["settings","qr_signing_key","TEXT"],
    // Backup mirror — second copy of every .mmbak (USB / other disk / Drive folder)
    ["settings","backup_mirror_dir","TEXT"],
    // Receipt anti-forgery — verification codes on money receipts (V035).
    // subscriptions is the legacy mirror that can still back a receipt when
    // an account's payment predates the ledger, so it carries codes too.
    ["donations","verification_code","TEXT"],
    ["subscription_payments","verification_code","TEXT"],
    ["subscriptions","verification_code","TEXT"],
    // Multi-month dues & advance (V036): unpaid balances from closed months
    // accumulate on the subscription account (arrears); overpayments become
    // credit (advance) that nets against future dues. Each ledger payment
    // remembers how much cash cleared arrears / became advance so a re-record
    // or cancel can roll the account state back exactly.
    ["subscriptions","arrears","REAL NOT NULL DEFAULT 0"],
    ["subscriptions","advance","REAL NOT NULL DEFAULT 0"],
    ["subscription_payments","arrears_cleared","REAL NOT NULL DEFAULT 0"],
    ["subscription_payments","advance_added","REAL NOT NULL DEFAULT 0"],
    // WhatsApp receipt privacy lock (V037): one send per receipt (+ one
    // admin-authorized re-send). receipt_sent_at marks the ACCEPTED send,
    // whatsapp_msg_id maps late delivery receipts back to the row, and
    // receipt_delivered_at is set ONLY when the phone actually got it — the
    // lock rule. Rows on `subscriptions` would go stale at month roll-over,
    // so the live state lives on the money tables (donations and the
    // subscription_payments ledger) and the list joins the current month's
    // ledger row.
    ["donations","receipt_pdf","BLOB"],
    ["donations","receipt_generated_at","TEXT"],
    ["donations","receipt_sent_at","TEXT"],
    ["donations","receipt_delivered_at","TEXT"],
    ["donations","receipt_resends","INTEGER NOT NULL DEFAULT 0"],
    ["donations","whatsapp_msg_id","TEXT"],
    ["subscription_payments","receipt_pdf","BLOB"],
    ["subscription_payments","receipt_generated_at","TEXT"],
    ["subscription_payments","receipt_sent_at","TEXT"],
    ["subscription_payments","receipt_delivered_at","TEXT"],
    ["subscription_payments","receipt_resends","INTEGER NOT NULL DEFAULT 0"],
    ["subscription_payments","whatsapp_msg_id","TEXT"],
  ];
  for (const [table,name,definition] of fields) if (tables.has(table)) addColumn(database, table, name, definition);
  if (tables.has("welfare_requests")) database.exec("UPDATE welfare_requests SET request_date = COALESCE(request_date, created_at) WHERE request_date IS NULL");
  // V027 backfill: existing death records were registered the day they were created.
  if (tables.has("deaths")) database.exec("UPDATE deaths SET registration_date = COALESCE(NULLIF(registration_date,''), date(created_at)) WHERE registration_date IS NULL OR registration_date = ''");

  // Token feature compatibility for databases created before the token module was added.
  // Keep this schema local and idempotent so token generation never depends on a missing
  // migration or on the build process rewriting source files.
  database.exec(`
    CREATE TABLE IF NOT EXISTS token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'general',
      event_date TEXT NOT NULL,
      event_time TEXT DEFAULT '',
      venue TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS token_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      family_id INTEGER NOT NULL,
      token_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'GENERATED',
      collected INTEGER NOT NULL DEFAULT 0,
      collected_at TEXT,
      collected_by INTEGER,
      cancelled_at TEXT,
      cancelled_reason TEXT,
      replacement_for INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(event_id) REFERENCES token_events(id) ON DELETE CASCADE,
      FOREIGN KEY(family_id) REFERENCES families(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_token_event_family_active
      ON token_assignments(event_id, family_id)
      WHERE status != 'CANCELLED';
    CREATE INDEX IF NOT EXISTS idx_token_assignments_event ON token_assignments(event_id);
    CREATE INDEX IF NOT EXISTS idx_token_assignments_family ON token_assignments(family_id);
  `);
  // Older token tables may predate some fields used by collection/replacement/PDF CRUD.
  const tokenTables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(x => x.name));
  if (tokenTables.has("token_events")) {
    addColumn(database, "token_events", "event_type", "TEXT NOT NULL DEFAULT 'general'");
    addColumn(database, "token_events", "event_time", "TEXT DEFAULT ''");
    addColumn(database, "token_events", "venue", "TEXT DEFAULT ''");
    addColumn(database, "token_events", "description", "TEXT DEFAULT ''");
    addColumn(database, "token_events", "status", "TEXT NOT NULL DEFAULT 'active'");
    addColumn(database, "token_events", "created_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
    addColumn(database, "token_events", "updated_at", "TEXT");
  }
  if (tokenTables.has("token_assignments")) {
    addColumn(database, "token_assignments", "status", "TEXT NOT NULL DEFAULT 'GENERATED'");
    addColumn(database, "token_assignments", "collected", "INTEGER NOT NULL DEFAULT 0");
    addColumn(database, "token_assignments", "collected_at", "TEXT");
    addColumn(database, "token_assignments", "collected_by", "INTEGER");
    addColumn(database, "token_assignments", "cancelled_at", "TEXT");
    addColumn(database, "token_assignments", "cancelled_reason", "TEXT");
    addColumn(database, "token_assignments", "replacement_for", "INTEGER");
    addColumn(database, "token_assignments", "created_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  // Date-based deletion protection: a token event can be deleted only
  // after its date is over — upcoming events are protected (DB triggers
  // enforce it even against external editors — see token-guard.ts).
  installTokenDateGuard(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS record_history (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, action TEXT NOT NULL, user_id INTEGER, username TEXT, changed_at TEXT NOT NULL DEFAULT (datetime('now')), summary TEXT NOT NULL, changes_json TEXT, reason TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS idx_record_history_entity ON record_history(entity_type, entity_id, changed_at DESC);
    CREATE TABLE IF NOT EXISTS family_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, old_family_id INTEGER NOT NULL, new_family_id INTEGER NOT NULL, move_type TEXT NOT NULL CHECK(move_type IN ('ExistingFamily','NewFamily')), reason TEXT NOT NULL, moved_at TEXT NOT NULL DEFAULT(datetime('now')), moved_by INTEGER, FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE RESTRICT, FOREIGN KEY(old_family_id) REFERENCES families(id) ON DELETE RESTRICT, FOREIGN KEY(new_family_id) REFERENCES families(id) ON DELETE RESTRICT, FOREIGN KEY(moved_by) REFERENCES users(id));
    CREATE INDEX IF NOT EXISTS idx_family_moves_member ON family_moves(member_id, moved_at DESC);
    -- V030 — tamper-evidence anchor: stores the hash of the newest audit event so
    -- chain verification can also detect truncation of the tail of the log.
    CREATE TABLE IF NOT EXISTS audit_chain (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_hash TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    INSERT OR IGNORE INTO audit_chain (id, last_hash, event_count) VALUES (1, NULL, 0);
  `);

  // Staff module tables — created here (idempotent) so the module works on any
  // database version, even before V024 migration has a chance to run.
  database.exec(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_code TEXT NOT NULL UNIQUE,
      member_id INTEGER,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Staff',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      joined_date TEXT,
      salary REAL NOT NULL DEFAULT 0,
      payment_frequency TEXT NOT NULL DEFAULT 'Monthly',
      status TEXT NOT NULL DEFAULT 'Active',
      notes TEXT DEFAULT '',
      archive_state INTEGER NOT NULL DEFAULT 0,
      archive_source TEXT,
      archived_at TEXT,
      archived_by INTEGER,
      archive_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status, archive_state);
    CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);
    CREATE TABLE IF NOT EXISTS staff_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payment_date TEXT NOT NULL DEFAULT (date('now')),
      payment_method TEXT DEFAULT 'Cash',
      transaction_ref TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Paid',
      notes TEXT DEFAULT '',
      paid_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE RESTRICT,
      FOREIGN KEY(paid_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_payments_staff ON staff_payments(staff_id, period_year, period_month);
    CREATE INDEX IF NOT EXISTS idx_staff_payments_period ON staff_payments(period_year, period_month);
  `);
  const allTables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(x => x.name));
  if (allTables.has("staff")) {
    addColumn(database, "staff", "member_id", "INTEGER");
    addColumn(database, "staff", "role", "TEXT NOT NULL DEFAULT 'Staff'");
    addColumn(database, "staff", "payment_frequency", "TEXT NOT NULL DEFAULT 'Monthly'");
    addColumn(database, "staff", "archive_state", "INTEGER NOT NULL DEFAULT 0");
    addColumn(database, "staff", "archive_source", "TEXT");
    addColumn(database, "staff", "archived_at", "TEXT");
    addColumn(database, "staff", "archived_by", "INTEGER");
    addColumn(database, "staff", "archive_reason", "TEXT");
    addColumn(database, "staff", "updated_at", "TEXT");
  }

  // Asset register (V036) — the mahallu's buildings, lands and rentable goods.
  // Created here (idempotent) so the module works on any database version,
  // even before the migration file has a chance to run. transactions.asset_id
  // is the accounting link: rent income and repair expenses can be tagged
  // with the asset they belong to.
  database.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Other',
      reference_no TEXT DEFAULT '',
      location TEXT DEFAULT '',
      acquisition_date TEXT DEFAULT '',
      acquisition_cost REAL DEFAULT 0,
      current_value REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'In use',
      condition_note TEXT DEFAULT 'Good',
      custodian TEXT DEFAULT '',
      income_generating INTEGER NOT NULL DEFAULT 0,
      tenant_name TEXT DEFAULT '',
      monthly_rent REAL DEFAULT 0,
      agreement_start TEXT DEFAULT '',
      agreement_end TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
  `);
  addColumn(database, "transactions", "asset_id", "INTEGER REFERENCES assets(id)");
  database.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_asset ON transactions(asset_id);`);

  // Committee module tables — created idempotently so the module works on any DB.
  database.exec(`
    CREATE TABLE IF NOT EXISTS committee_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      committee_code TEXT NOT NULL UNIQUE,
      member_id INTEGER,
      name TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT 'Committee Member',
      committee_type TEXT NOT NULL DEFAULT 'Executive',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      term_start TEXT,
      term_end TEXT,
      status TEXT NOT NULL DEFAULT 'Active',
      notes TEXT DEFAULT '',
      archive_state INTEGER NOT NULL DEFAULT 0,
      archive_source TEXT,
      archived_at TEXT,
      archived_by INTEGER,
      archive_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_committee_status ON committee_members(status, archive_state);
    CREATE INDEX IF NOT EXISTS idx_committee_position ON committee_members(position);
    CREATE INDEX IF NOT EXISTS idx_committee_type ON committee_members(committee_type);
    CREATE INDEX IF NOT EXISTS idx_committee_term_end ON committee_members(term_end);
  `);
  // Per-entity lookups for the ledger double-click preview and the "Edited"
  // badge — audit rows for one transaction/donation are fetched by (module, id).
  if (allTables.has("audit_log")) {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(module, entity_id);`);
  }
  if (allTables.has("committee_members")) {
    addColumn(database, "committee_members", "member_id", "INTEGER");
    addColumn(database, "committee_members", "position", "TEXT NOT NULL DEFAULT 'Committee Member'");
    addColumn(database, "committee_members", "committee_type", "TEXT NOT NULL DEFAULT 'Executive'");
    addColumn(database, "committee_members", "term_start", "TEXT");
    addColumn(database, "committee_members", "term_end", "TEXT");
    addColumn(database, "committee_members", "status", "TEXT NOT NULL DEFAULT 'Active'");
    addColumn(database, "committee_members", "archive_state", "INTEGER NOT NULL DEFAULT 0");
    addColumn(database, "committee_members", "archive_source", "TEXT");
    addColumn(database, "committee_members", "archived_at", "TEXT");
    addColumn(database, "committee_members", "archived_by", "INTEGER");
    addColumn(database, "committee_members", "archive_reason", "TEXT");
    addColumn(database, "committee_members", "updated_at", "TEXT");
  }
}

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
