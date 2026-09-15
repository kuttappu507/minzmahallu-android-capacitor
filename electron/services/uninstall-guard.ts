/*
 * Uninstall guard — verifies an MMS administrator password for the
 * Windows uninstaller.
 *
 * The NSIS uninstaller (build/installer.nsh, customUnInit) launches the
 * installed app with --verify-uninstall BEFORE removing any file. The main
 * process opens a small verify window; when the user submits a password,
 * main queries the active Administrator accounts and calls the pure function
 * below. Exit code 0 = verified, 1 = declined/cancelled, so the uninstaller
 * only proceeds after an explicit "verified".
 *
 * Pure + injectable (no electron imports) so it is unit-testable offline.
 */
import { verifyStoredPassword } from "./auth.service.js";

export interface UninstallAdminRow {
  id: number;
  username: string;
  password_hash: string;
}

export type UninstallVerifyResult =
  | { ok: true; username: string }
  | { ok: false; reason: "no-admins" | "wrong-password" };

/**
 * Try the password against every active administrator account. The uninstall
 * dialog asks for a password only (no username), so any admin's password is
 * accepted — an office with several admins never gets locked out because one
 * person is unavailable.
 */
export function verifyUninstallPassword(
  rows: UninstallAdminRow[],
  password: string
): UninstallVerifyResult {
  if (!rows || rows.length === 0) return { ok: false, reason: "no-admins" };
  const plain = String(password ?? "");
  if (!plain) return { ok: false, reason: "wrong-password" };
  for (const r of rows) {
    if (r && r.password_hash && verifyStoredPassword(plain, r.password_hash)) {
      return { ok: true, username: r.username };
    }
  }
  return { ok: false, reason: "wrong-password" };
}

/** SQL the caller should run to fetch the candidate rows. */
export const UNINSTALL_ADMIN_SQL =
  "SELECT id, username, password_hash FROM users WHERE role = 'Administrator' AND is_active = 1 AND is_locked = 0";
