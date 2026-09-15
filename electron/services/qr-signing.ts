/*
 * QR signing context — the glue between the app database and the QR builders.
 *
 * Every QR the app prints is signed with HMAC using a key that lives ONLY in
 * the mahallu's database (settings.qr_signing_key): provisioned once on first
 * launch, never rendered, never printed, never exported. It travels with
 * backups/restores (so a restored mahallu DB keeps verifying its own prints)
 * but a forger outside the app never sees it.
 *
 * The device fingerprint is likewise read from settings (provisioned at
 * startup) so every payload is also bound to the issuing computer.
 *
 * getDB() is called lazily inside each helper — importing this module never
 * touches the database (safe for the connection.ts import cycle).
 */
import { getDB } from "../db/connection.js";
import { buildCertQrPayload, buildReceiptQrPayload, buildCertificateQrMessage, buildReceiptQrMessage } from "./qr-code.js";

/** The machine fingerprint + signing key used for every printed QR. */
export function getQrPrintContext(): { fingerprint: string; signingKey: string } {
  try {
    const row = getDB().prepare("SELECT device_fingerprint, qr_signing_key FROM settings WHERE id = 1").get() as
      | { device_fingerprint?: string; qr_signing_key?: string }
      | undefined;
    return {
      fingerprint: String(row?.device_fingerprint || "").trim() || "UNBOUND",
      signingKey: String(row?.qr_signing_key || "").trim(),
    };
  } catch {
    return { fingerprint: "UNBOUND", signingKey: "" };
  }
}

/** Signed QR payload for a certificate row (number + code + issue date). */
export function signedCertQrPayload(cert: {
  certificate_number?: string | number | null;
  verification_code?: string | null;
  issued_date?: string | null;
}): string {
  const { fingerprint, signingKey } = getQrPrintContext();
  return buildCertQrPayload(
    {
      number: String(cert.certificate_number ?? cert.verification_code ?? ""),
      verificationCode: String(cert.verification_code || ""),
      fingerprint,
      issuedDate: String(cert.issued_date || "").slice(0, 10),
    },
    signingKey || undefined
  );
}

/** Signed QR payload for a receipt (receipt number + code + payment date). */
export function signedReceiptQrPayload(receipt: {
  receiptNumber: string;
  verificationCode: string;
  /** yyyy-mm-dd (only the date part is used). */
  date: string;
}): string {
  const { fingerprint, signingKey } = getQrPrintContext();
  return buildReceiptQrPayload(
    {
      number: String(receipt.receiptNumber || ""),
      verificationCode: String(receipt.verificationCode || ""),
      fingerprint,
      issuedDate: String(receipt.date || "").slice(0, 10),
    },
    signingKey || undefined
  );
}

// ---------------------------------------------------------------------------
// Human-readable QR (v2 print format) — what a phone shows when the printed
// QR is scanned. Replaces the raw MMS|… machine line on prints so a verifier
// with ANY scanner sees "verification can be done using the Minz Mahallu app"
// plus the printed security code, instead of cryptic fields.
// ---------------------------------------------------------------------------

/** Full mahallu display name from settings ("Minz Mahallu Jamath" etc.). */
export function mahalluNameFromSettings(): string {
  try {
    const row = getDB().prepare("SELECT mahallu_name FROM settings WHERE id = 1").get() as { mahallu_name?: string } | undefined;
    return String(row?.mahallu_name || "").trim();
  } catch {
    return "";
  }
}

/** Message-format QR text for a certificate print (code must be backfilled first). */
export function certificateQrVerifyMessage(cert: {
  certificate_number?: string | number | null;
  verification_code?: string | null;
  issued_date?: string | null;
}): string {
  return buildCertificateQrMessage({
    mahalluName: mahalluNameFromSettings(),
    documentNumber: String(cert.certificate_number ?? ""),
    verificationCode: String(cert.verification_code || ""),
    documentDate: String(cert.issued_date || ""),
  });
}

/** Message-format QR text for a receipt print. */
export function receiptQrVerifyMessage(receipt: {
  receiptNumber: string;
  verificationCode: string;
  /** yyyy-mm-dd (only the date part is used). */
  date: string;
}): string {
  return buildReceiptQrMessage({
    mahalluName: mahalluNameFromSettings(),
    documentNumber: String(receipt.receiptNumber || ""),
    verificationCode: String(receipt.verificationCode || ""),
    documentDate: String(receipt.date || ""),
  });
}
