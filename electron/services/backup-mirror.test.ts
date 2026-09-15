import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mirrorBackup, verifyBackup, createBackup } from "./backup.service.js";

// mirrorBackup is pure-filesystem (no DB), so it can be tested directly.
// createBackup touches the DB — the mock lives in scripts/ and is wired via
// vitest config only for template tests; here we build a valid .mmbak by
// hand using the same file format (header + manifest + payload).

function makeFakeBackup(file: string, payload = "demo-payload") {
  const manifest = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), size: Buffer.byteLength(payload), sha256: "x" }), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(manifest.length, 0);
  header.writeUInt32BE(0x4d4d5342, 4);
  fs.writeFileSync(file, Buffer.concat([header, manifest, Buffer.from(payload)]));
}

describe("backup mirror", () => {
  let dir: string;
  let mirrorDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mms-mirror-test-"));
    mirrorDir = path.join(dir, "mirror");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("copies the backup into the mirror folder and byte-verifies it", () => {
    const src = path.join(dir, "backup-auto-2026-09-05.mmbak");
    makeFakeBackup(src, "payload-a");
    const r = mirrorBackup(src, mirrorDir);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(mirrorDir, "backup-auto-2026-09-05.mmbak"));
    expect(fs.existsSync(r.path!)).toBe(true);
    expect(fs.readFileSync(r.path!)).toEqual(fs.readFileSync(src));
  });

  it("creates the mirror folder if it does not exist", () => {
    const src = path.join(dir, "backup-1.mmbak");
    makeFakeBackup(src);
    const r = mirrorBackup(src, path.join(mirrorDir, "nested", "deep"));
    expect(r.ok).toBe(true);
    expect(fs.existsSync(r.path!)).toBe(true);
  });

  it("keeps only the newest N backups in the mirror (prune, filename timestamps)", () => {
    // Production names embed ISO timestamps; prune order must follow them.
    const names = [
      "backup-auto-2026-09-01-10-00-00.mmbak",
      "backup-auto-2026-09-02-10-00-00.mmbak",
      "backup-auto-2026-09-03-10-00-00.mmbak",
      "backup-auto-2026-09-04-10-00-00.mmbak",
      "backup-auto-2026-09-05-10-00-00.mmbak",
    ];
    for (const n of names) {
      const f = path.join(dir, n);
      makeFakeBackup(f, `payload-${n}`);
      const r = mirrorBackup(f, mirrorDir, 3);
      expect(r.ok).toBe(true);
    }
    const remaining = fs.readdirSync(mirrorDir).filter(f => f.endsWith(".mmbak")).sort();
    expect(remaining).toEqual([
      "backup-auto-2026-09-03-10-00-00.mmbak",
      "backup-auto-2026-09-04-10-00-00.mmbak",
      "backup-auto-2026-09-05-10-00-00.mmbak",
    ]);
  });

  it("prunes stamped names correctly even when file mtimes are identical (burst copies)", () => {
    const names = [
      "mms-backup-2026-09-01-09-00-00.mmbak",
      "mms-backup-2026-09-02-09-00-00.mmbak",
      "mms-backup-2026-09-03-09-00-00.mmbak",
      "mms-backup-2026-09-04-09-00-00.mmbak",
    ];
    for (const n of names) {
      const f = path.join(dir, n);
      makeFakeBackup(f, `p-${n}`);
      mirrorBackup(f, mirrorDir, 2);
    }
    // force identical mtimes on the mirrored copies (simulates a burst)
    const same = new Date();
    for (const f of fs.readdirSync(mirrorDir)) fs.utimesSync(path.join(mirrorDir, f), same, same);
    // one more mirror triggers a prune pass under identical mtimes
    const f2 = path.join(dir, "mms-backup-2026-09-05-09-00-00.mmbak");
    makeFakeBackup(f2, "p-newest");
    const r = mirrorBackup(f2, mirrorDir, 2);
    expect(r.ok).toBe(true);
    const remaining = fs.readdirSync(mirrorDir).filter(f => f.endsWith(".mmbak")).sort();
    expect(remaining).toEqual([
      "mms-backup-2026-09-04-09-00-00.mmbak",
      "mms-backup-2026-09-05-09-00-00.mmbak",
    ]);
  });

  it("fails soft (ok:false) when the source is missing", () => {
    const r = mirrorBackup(path.join(dir, "nope.mmbak"), mirrorDir);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("fails soft when no mirror dir is configured", () => {
    const src = path.join(dir, "backup-1.mmbak");
    makeFakeBackup(src);
    const r = mirrorBackup(src, "");
    expect(r.ok).toBe(false);
  });

  it("fails soft when the mirror path is not a valid directory (a file)", () => {
    const src = path.join(dir, "backup-1.mmbak");
    makeFakeBackup(src);
    const blocker = path.join(dir, "blocker");
    fs.writeFileSync(blocker, "i am a file");
    const r = mirrorBackup(src, blocker);
    expect(r.ok).toBe(false);
  });

  it("mirrored file still passes verifyBackup format check", () => {
    const src = path.join(dir, "backup-auto-x.mmbak");
    makeFakeBackup(src, "payload-a");
    const r = mirrorBackup(src, mirrorDir);
    expect(r.ok).toBe(true);
    // verifyBackup checks the MMSB magic + internal sha256 of the payload —
    // our fake manifest sha256 is "x", so it must FAIL integrity (proving the
    // mirror kept the exact bytes rather than rewriting the file).
    expect(() => verifyBackup(r.path!)).toThrow(/integrity/i);
  });
});
