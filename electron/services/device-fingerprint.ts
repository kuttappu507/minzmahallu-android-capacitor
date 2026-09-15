/*
 * Device fingerprint — anti-forgery binding for official prints.
 *
 * Every issued certificate embeds a QR code carrying a hash of THIS computer's
 * stable hardware/OS identifiers. A certificate printed on another machine
 * (or a photocopy) carries a different fingerprint, so authenticity can be
 * re-checked: scan the QR → compare the embedded fingerprint against the
 * fingerprint of the machine that issued it (stored in settings).
 *
 * Pure (node:os / node:crypto only) — no DB, no Electron — unit-testable and
 * safe to import from connection.ts and print templates.
 */
import os from "node:os";
import crypto from "node:crypto";

/** Stable machine identifiers (sorted so key order never changes the hash). */
export function deviceIdParts(): string[] {
  const nets = os.networkInterfaces();
  const macs: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.mac && net.mac !== "00:00:00:00:00:00") macs.push(net.mac);
    }
  }
  macs.sort();
  return [
    `host:${os.hostname()}`,
    `platform:${os.platform()}`,
    `arch:${os.arch()}`,
    `mac:${macs.join(",") || "none"}`,
    `cpu:${(os.cpus()[0]?.model || "unknown").trim()}`,
    `mem:${Math.round(os.totalmem() / (1024 * 1024 * 1024))}`,
  ];
}

/**
 * 16-hex-char SHA-256 fingerprint of this machine. Stable across restarts on
 * the same computer; differs between computers (hostname/MAC/CPU/memory).
 */
export function computeDeviceFingerprint(): string {
  return crypto.createHash("sha256").update(deviceIdParts().join("|")).digest("hex").slice(0, 16).toUpperCase();
}

/** Human-friendly 8-hex short tag (for badges/UI), derived from the fingerprint. */
export function fingerprintTag(fp: string): string {
  return (fp || "").slice(0, 8);
}
