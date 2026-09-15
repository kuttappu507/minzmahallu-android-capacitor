/*
 * Unit tests for the uninstall guard (see uninstall-guard.ts).
 * Uses hashPasswordForStorage to build real pbkdf2 hashes so the
 * verification path (parse -> derive -> timingSafeEqual) is exercised.
 */
import { describe, expect, it } from "vitest";
import { verifyUninstallPassword, type UninstallAdminRow } from "./uninstall-guard.js";
import { hashPasswordForStorage } from "./auth.service.js";

const ADMIN = "Admin@2026";
const OTHER = "Treasurer#9";
const PWD = "CorrectHorse#7";

function row(id: number, username: string, password: string): UninstallAdminRow {
  return { id, username, password_hash: hashPasswordForStorage(password).stored };
}

describe("verifyUninstallPassword", () => {
  it("accepts the password of an administrator", () => {
    const rows = [row(1, "admin", ADMIN), row(2, "secretary", PWD)];
    const r = verifyUninstallPassword(rows, PWD);
    expect(r).toEqual({ ok: true, username: "secretary" });
  });

  it("tries every administrator (second account works too)", () => {
    const rows = [row(1, "admin", ADMIN), row(3, "treasurer", OTHER)];
    expect(verifyUninstallPassword(rows, OTHER)).toEqual({ ok: true, username: "treasurer" });
  });

  it("rejects a wrong password", () => {
    const rows = [row(1, "admin", ADMIN)];
    expect(verifyUninstallPassword(rows, "wrong-password-1A!")).toEqual({ ok: false, reason: "wrong-password" });
  });

  it("rejects an empty / undefined password", () => {
    const rows = [row(1, "admin", ADMIN)];
    expect(verifyUninstallPassword(rows, "")).toEqual({ ok: false, reason: "wrong-password" });
    expect(verifyUninstallPassword(rows, undefined as unknown as string)).toEqual({ ok: false, reason: "wrong-password" });
  });

  it("reports no-admins when the list is empty (fresh/broken install)", () => {
    expect(verifyUninstallPassword([], "whatever-A1!")).toEqual({ ok: false, reason: "no-admins" });
  });

  it("skips rows with a corrupt hash without throwing", () => {
    const rows: UninstallAdminRow[] = [
      { id: 1, username: "admin", password_hash: "not-a-valid-hash" },
      row(2, "secretary", PWD),
    ];
    expect(verifyUninstallPassword(rows, PWD)).toEqual({ ok: true, username: "secretary" });
  });
});
