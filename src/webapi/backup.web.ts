/*
 * Backup vault for the MMS Android port.
 *
 * Desktop .mmbak files are written through OS save dialogs; on Android the
 * same protection is delivered as an in-app backup vault (IndexedDB):
 *  - "Create backup" snapshots the live SQLite bytes with a SHA-256 digest.
 *  - "Verify" re-computes the digest of the stored snapshot.
 *  - "Restore" verifies, replaces the live DB bytes and restarts the app.
 *  - Any snapshot can also be exported (share sheet / downloads) as a
 *    self-describing .mmbak JSON wrapper so the office can keep off-device
 *    copies. (Desktop .mmbak interop is documented in README-ANDROID.md.)
 */
import { sha256 } from "hash-wasm";
import { getDB } from "./db.web";
import { listStoredBackups, putStoredBackup, deleteStoredBackup, getStoredBackup, writeBytesNow } from "./persist";
import { outputBytes } from "./print.web";

export interface WebBackupInfo {
  name: string;
  time: string;
  size: number;
  sha256: string;
  source: "manual" | "auto";
}

const WRAPPER_FORMAT = "MMS-WEB-BAK";
const WRAPPER_VERSION = 1;

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export async function webCreateBackup(source: "manual" | "auto" = "manual"): Promise<{ success: boolean; path?: string; size?: number; sha256?: string; error?: string }> {
  try {
    const bytes = getDB().raw.export();
    const digest = await sha256(bytes);
    const name = `mms-backup-${stamp()}.mmbak`;
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    await putStoredBackup({
      name,
      time: new Date().toISOString(),
      size: bytes.length,
      sha256: digest,
      source,
      data: copy.buffer,
    });
    return { success: true, path: name, size: bytes.length, sha256: digest };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

export async function webListBackups(): Promise<{ backups: WebBackupInfo[] }> {
  const list = await listStoredBackups();
  return { backups: list.map((b) => ({ name: b.name, time: b.time, size: b.size, sha256: b.sha256, source: b.source })) };
}

export async function webVerifyBackup(name: string): Promise<{ success: boolean; ok?: boolean; name?: string; size?: number; error?: string }> {
  try {
    const entry = await getStoredBackup(name);
    if (!entry) return { success: false, error: "Backup not found" };
    const digest = await sha256(new Uint8Array(entry.data));
    if (digest !== entry.sha256) return { success: true, ok: false, name, error: "Checksum mismatch — the backup is corrupted" };
    return { success: true, ok: true, name, size: entry.size };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

/** Share / download a snapshot as a self-describing .mmbak wrapper. */
export async function webExportBackup(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await getStoredBackup(name);
    if (!entry) return { success: false, error: "Backup not found" };
    const wrapper = {
      format: WRAPPER_FORMAT,
      version: WRAPPER_VERSION,
      created: entry.time,
      sha256: entry.sha256,
      db: btoaBytes(new Uint8Array(entry.data)),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(wrapper));
    const res = await outputBytes(bytes, name, "application/json");
    if (res.status === "cancelled") return { success: false, error: res.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

export async function webDeleteBackup(name: string): Promise<{ success: boolean }> {
  await deleteStoredBackup(name);
  return { success: true };
}

/**
 * Restore a stored snapshot: verify → replace live bytes → the caller
 * reloads the WebView so the new database boots cleanly.
 */
export async function webRestoreBackup(name: string): Promise<{ success: boolean; restarted?: boolean; error?: string }> {
  try {
    const entry = await getStoredBackup(name);
    if (!entry) return { success: false, error: "Backup not found" };
    const digest = await sha256(new Uint8Array(entry.data));
    if (digest !== entry.sha256) return { success: false, error: "Checksum mismatch — refusing to restore a corrupted backup" };
    await writeBytesNow(new Uint8Array(entry.data));
    return { success: true, restarted: true };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

/** Import a .mmbak wrapper picked from disk (restore from a shared file). */
export async function webImportBackupFile(file: File): Promise<{ success: boolean; error?: string }> {
  try {
    const text = await file.text();
    const wrapper = JSON.parse(text);
    if (wrapper?.format !== WRAPPER_FORMAT) return { success: false, error: "Not an Android MMS backup file" };
    const bytes = b64Bytes(String(wrapper.db || ""));
    if (!bytes.length) return { success: false, error: "Backup payload is empty" };
    const digest = await sha256(bytes);
    if (digest !== wrapper.sha256) return { success: false, error: "Checksum mismatch — the file is corrupted" };
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    await putStoredBackup({
      name: file.name.replace(/\.mmbak$/i, "") || `mms-imported-${stamp()}`,
      time: String(wrapper.created || new Date().toISOString()),
      size: bytes.length,
      sha256: digest,
      source: "manual",
      data: copy.buffer,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: String(err?.message ?? err) };
  }
}

function btoaBytes(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(bin);
}

function b64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
