import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDB } from "../db/connection.js";

export type BackupMeta = { version: 1; createdAt: string; size: number; sha256: string; file: string };

function sha256(file: string) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export async function createBackup(filePath: string): Promise<BackupMeta> {
  const temp = `${filePath}.tmp-db`;
  try {
    // better-sqlite3 v11's db.backup() is ASYNC — it must be awaited before the
    // resulting file is read/hashed, otherwise sha256() reads a file that does
    // not exist yet and every backup throws ENOENT.
    const db = getDB();
    try {
      await db.backup(temp);
    } catch (syncErr: any) {
      // Fallback for older better-sqlite3 versions or locked DBs: checkpoint the
      // WAL into the main file, then copy it (with WAL/SHM) to the target.
      console.warn("[backup] Async backup failed, trying file copy fallback:", syncErr.message);
      const dbPath = path.join(path.dirname(temp), "mms.db");
      if (fs.existsSync(dbPath)) {
        try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
        fs.copyFileSync(dbPath, temp);
        for (const suffix of ["-wal", "-shm"]) {
          const src = dbPath + suffix;
          if (fs.existsSync(src)) {
            try { fs.copyFileSync(src, temp + suffix); } catch {}
          }
        }
      } else {
        throw syncErr;
      }
    }
    const digest = sha256(temp);
    const stat = fs.statSync(temp);
    const manifest = Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), size: stat.size, sha256: digest }), "utf8");
    const dbBytes = fs.readFileSync(temp);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(manifest.length, 0);
    header.writeUInt32BE(0x4d4d5342, 4); // MMSB
    fs.writeFileSync(filePath, Buffer.concat([header, manifest, dbBytes]));
    return { version: 1, createdAt: new Date().toISOString(), size: stat.size, sha256: digest, file: filePath };
  } finally {
    try { fs.rmSync(temp, { force: true }); try { fs.rmSync(temp + "-wal", { force: true }); } catch {} try { fs.rmSync(temp + "-shm", { force: true }); } catch {} } catch {}
  }
}

export function verifyBackup(filePath: string) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 8 || bytes.readUInt32BE(4) !== 0x4d4d5342) throw new Error("Invalid Minz Mahallu backup file");
  const manifestLength = bytes.readUInt32BE(0);
  const manifest = JSON.parse(bytes.subarray(8, 8 + manifestLength).toString("utf8"));
  const dbBytes = bytes.subarray(8 + manifestLength);
  const actual = crypto.createHash("sha256").update(dbBytes).digest("hex");
  if (actual !== manifest.sha256) throw new Error("Backup integrity check failed");
  if (dbBytes.length !== manifest.size) throw new Error("Backup size validation failed");
  return { valid: true, manifest };
}

export function extractVerifiedBackup(filePath: string, targetDb: string) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 8 || bytes.readUInt32BE(4) !== 0x4d4d5342) throw new Error("Invalid Minz Mahallu backup file");
  const manifestLength = bytes.readUInt32BE(0);
  const manifest = JSON.parse(bytes.subarray(8, 8 + manifestLength).toString("utf8"));
  const dbBytes = bytes.subarray(8 + manifestLength);
  const actual = crypto.createHash("sha256").update(dbBytes).digest("hex");
  if (actual !== manifest.sha256 || dbBytes.length !== manifest.size) throw new Error("Backup integrity check failed");
  fs.writeFileSync(targetDb, dbBytes);
  return manifest;
}

export function listBackups(userData: string) {
  return fs.readdirSync(userData).filter(f => (f.startsWith("backup-") || f.startsWith("mms-backup-")) && f.endsWith(".mmbak")).map(file => {
    const full = path.join(userData, file); const stat = fs.statSync(full);
    let valid = false; try { verifyBackup(full); valid = true; } catch {}
    return { name: file, path: full, size: stat.size, time: stat.mtime.toISOString(), valid };
  }).sort((a,b)=>b.time.localeCompare(a.time));
}

/**
 * Copy a finished .mmbak to a SECOND location (mirror folder) so data survives
 * even if the app-data folder/profile is wiped. Best-effort and non-throwing:
 * a missing USB drive must never break the backup flow itself. The copy is
 * byte-verified, and only the newest `keep` backups are retained in the mirror
 * (pruning keeps the folder from growing forever).
 */
export function mirrorBackup(sourcePath: string, mirrorDir: string, keep = 10): { ok: boolean; path?: string; error?: string } {
  try {
    if (!mirrorDir || !mirrorDir.trim()) return { ok: false, error: "no mirror folder configured" };
    if (!fs.existsSync(sourcePath)) return { ok: false, error: "source backup missing" };
    fs.mkdirSync(mirrorDir, { recursive: true });
    const dest = path.join(mirrorDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, dest);
    if (sha256(dest) !== sha256(sourcePath)) {
      try { fs.rmSync(dest, { force: true }); } catch {}
      return { ok: false, error: "mirror copy failed verification" };
    }
    // Prune: keep the newest `keep` backups. Ordering prefers the ISO
    // timestamp embedded in the filename (all MMS backups carry one); files
    // without a stamp fall back to mtime. Sorting by mtime alone is unstable
    // when several backups are mirrored within the same second.
    const stamp = (name: string): string | null => {
      const m = /(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})/.exec(name);
      return m ? m[1] : null;
    };
    const files = fs.readdirSync(mirrorDir).filter(f => f.endsWith(".mmbak")).map(name => {
      const full = path.join(mirrorDir, name);
      const key = stamp(name) ?? new Date(fs.statSync(full).mtimeMs).toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "-");
      return { full, key };
    });
    files.sort((a, b) => b.key.localeCompare(a.key));
    for (const oldFile of files.slice(keep)) { try { fs.rmSync(oldFile.full, { force: true }); } catch {} }
    return { ok: true, path: dest };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
