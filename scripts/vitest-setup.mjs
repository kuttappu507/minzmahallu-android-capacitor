/* Vitest global setup: give the per-process test database the one thing a
 * REAL database always has once it accepts writes — an Administrator account.
 *
 * Production flow: fresh DB -> first-run setup screen -> admin created -> only
 * then does any data entry happen. Tests that insert money records referencing
 * user id 1 (createdBy, audit actor, …) depend on that post-setup state.
 * Since the security fix removed the shipped seed user (no credential may be
 * committed to the repo), the test harness creates its own admin here with a
 * random password that nobody (including the repo) knows.
 */
import crypto from "node:crypto";
import { getDB } from "../electron/db/connection.ts";

const db = getDB();
const count = db.prepare("SELECT COUNT(*) AS c FROM users").get();
if (Number(count?.c ?? 0) === 0) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(crypto.randomBytes(24).toString("hex"), salt, 200000, 32, "sha256");
  db.prepare(
    "INSERT INTO users (username, full_name, password_hash, password_salt, role, is_active, is_locked, failed_attempts, must_change_pwd) VALUES (?,?,?,?, 'Administrator',1,0,0,0)"
  ).run("test-admin", "Test Administrator", `pbkdf2_sha256$200000$${salt.toString("base64")}$${hash.toString("base64")}`, salt.toString("base64"));
}
