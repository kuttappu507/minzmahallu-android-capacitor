#!/usr/bin/env node
/* Fresh-install security verification (runs the REAL initialization chain):
 *   schema.sql -> seed.sql -> ensureRuntimeSchema -> migrations V002..V035
 * Asserts the post-fix state:
 *   1. NO users exist (no shipped credential can log in)
 *   2. needsInitialSetup() returns true -> the app shows the setup screen
 *   3. V032 is a retired stub (no demo dataset: families/members/etc. empty)
 *   4. V035 applied (password-rotation migration present in schema_version)
 *   5. A seeded-style public hash would be flagged must_change_pwd=1 (V035 logic)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MMS_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "mms-fresh-"));
const { getDB } = await import("../electron/db/connection.ts");
const { needsInitialSetup } = await import("../electron/services/auth.service.ts");

let fail = 0;
const check = (label, cond, extra = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) fail++;
};

const db = getDB();
const q = (sql, ...p) => db.prepare(sql).get(...p);
const n = (t) => q(`SELECT COUNT(*) c FROM ${t}`).c;

check("users table is EMPTY (no shipped credentials)", n("users") === 0, `count=${n("users")}`);
check("needsInitialSetup() === true (setup screen will show)", needsInitialSetup() === true);
check("no demo families/members/donations on fresh install", n("families") === 0 && n("members") === 0 && n("donations") === 0);
const v32 = q("SELECT description FROM schema_version WHERE version = 32");
check("V032 recorded as RETIRED stub", !!v32 && /RETIRED/.test(v32.description), v32?.description);
const v35 = q("SELECT description FROM schema_version WHERE version = 35");
check("V035 (forced rotation) applied", !!v35);

// V035 rotation logic: an account still carrying the published demo hash
// must be flagged must_change_pwd=1 by the migration.
db.prepare(`INSERT INTO users (id, username, full_name, password_hash, password_salt, role, is_active) VALUES (50, 'legacy-admin', 'Legacy', 'pbkdf2_sha256$200000$zRLKI0xyc2sYKBzQaWXl6w==$qHO4yvos81/Oah+ECzVbh1ZHPz3rEhRHOJT2criWCPg=', 'zRLKI0xyc2sYKBzQaWXl6w==', 'Administrator', 1)`).run();
db.exec("UPDATE settings SET demo_data = 0"); // no-op guard; migration already ran once
// Re-run the V035 statement exactly as the migration defines it:
const v35sql = fs.readFileSync(new URL("../resources/sql/migrations/V035_force_password_rotation.sql", import.meta.url), "utf8");
db.exec(v35sql.split("INSERT OR IGNORE")[0]);
const flagged = q("SELECT must_change_pwd FROM users WHERE id = 50");
check("public-hash account gets must_change_pwd = 1", Number(flagged?.must_change_pwd) === 1);

console.log(fail === 0 ? "\nFRESH-INSTALL SECURITY: ALL CHECKS PASS" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
