/* Users module — split out of data.service.ts (public API unchanged via the facade). */

import { all, run } from "../../db/connection.js";
import { hashPasswordForStorage } from "../auth.service.js";

export const users = {
  list: () => all<any>(`SELECT id, username, full_name, role, is_active, must_change_pwd, last_login_at AS last_login, created_at FROM users ORDER BY username`),
  create: (data: any, creatorRole: string) => {
    if (creatorRole !== "Administrator") throw new Error("Only administrators can create users");
    // No fallback password: silently creating an account with a publicly-known
    // default would be a god-mode footgun. Callers must supply a real password
    // (the secured IPC layer validates the policy before reaching us).
    if (!data.password) throw new Error("A password is required to create a user");
    const { stored, salt } = hashPasswordForStorage(data.password);
    const { id } = run(
      "INSERT INTO users (username, full_name, password_hash, password_salt, role, is_active, must_change_pwd) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [
        data.username, data.fullName, stored, salt,
        data.role || "Staff", data.mustChangePwd ? 1 : 1
      ]
    );
    return { id };
  },
  update: (id: number, data: any) =>
    run("UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?",
      [data.fullName, data.role, data.isActive ? 1 : 0, id]),
  toggleLock: (id: number, locked: boolean) =>
    // Fix: previously this set is_active, which is a different concept from is_locked.
    // is_locked is set by the 5-failed-attempts auto-lockout; toggling it from the
    // Users page should clear is_locked + locked_until + failed_attempts (unlock)
    // or set them (lock), without touching is_active (which is a separate
    // admin-controlled "account enabled" flag).
    run(
      "UPDATE users SET is_locked = ?, locked_until = NULL, failed_attempts = 0, updated_at = datetime('now') WHERE id = ? AND username != 'admin'",
      [locked ? 1 : 0, id]
    ),
  resetPassword: (id: number, newPassword: string) => {
    const { stored, salt } = hashPasswordForStorage(newPassword);
    return run("UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 1, failed_attempts = 0, is_locked = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
      [stored, salt, id]);
  },
  remove: (id: number) => run("DELETE FROM users WHERE id = ? AND username != 'admin'", [id]),
};
