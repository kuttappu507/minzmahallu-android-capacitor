/*
 * QR helpers — anti-forgery QR for official prints (certificates AND receipts).
 * Wraps the `qrcode` package (pure JS) with the MMS payload format:
 *
 *   MMS|CERT|<certificate_number>|<verification_code>|<device_fingerprint>|<issued_date>[|<hmac>]
 *   MMS|RCP |<receipt_number>    |<verification_code>|<device_fingerprint>|<issued_date>[|<hmac>]
 *
 * The payload binds the print to the machine that issued it (fingerprint) and
 * to the register (verification code). Any phone can scan the QR to read the
 * code; the app can re-verify the payload against the DB + device fingerprint.
 *
 * SIGNED QR (tamper-proofing): when a signing key is supplied, an HMAC-SHA256
 * tag over the first six fields is appended as a seventh field. The key lives
 * only in the mahallu's app database — it is never printed — so an outsider
 * can clone an existing QR but cannot ALTER any field (number, code, date,
 * fingerprint) or MINT a new valid one: the tag stops matching. Payloads
 * printed by earlier builds (six fields, no tag) still parse and verify
 * against the register; they are simply reported as unsigned/legacy.
 */
import QRCode from "qrcode";
import crypto from "node:crypto";

/** Payload kinds — certificates and (money) receipts. */
export const QR_KIND_CERT = "CERT";
export const QR_KIND_RECEIPT = "RCP";

export type QrPayload = {
  version: string;
  kind: string; // "CERT" | "RCP"
  /** Certificate number or receipt number. */
  number: string;
  verificationCode: string;
  fingerprint: string;
  issuedDate: string;
  /** Present on signed payloads (7 fields). */
  signature?: string;
};

/** Fields shared by every payload kind (kind added by the builder). */
export type QrFields = {
  number: string;
  verificationCode: string;
  fingerprint: string;
  issuedDate: string;
};

/** HMAC-SHA256(key, first-six-fields) → 16 hex chars. Short keeps the QR
 *  dense-printable while 64 bits of tag makes silent forgery impractical. */
export function signQrPayload(sixPartPayload: string, key: string): string {
  return crypto.createHmac("sha256", String(key || "")).update(sixPartPayload).digest("hex").slice(0, 16).toUpperCase();
}

/** Build the payload string for a certificate print (signed when key given). */
export function buildCertQrPayload(args: QrFields, key?: string): string {
  const base = ["MMS", QR_KIND_CERT, args.number, args.verificationCode, args.fingerprint, args.issuedDate].join("|");
  return key ? `${base}|${signQrPayload(base, key)}` : base;
}

/** Build the payload string for a receipt print (signed when key given). */
export function buildReceiptQrPayload(args: QrFields, key?: string): string {
  const base = ["MMS", QR_KIND_RECEIPT, args.number, args.verificationCode, args.fingerprint, args.issuedDate].join("|");
  return key ? `${base}|${signQrPayload(base, key)}` : base;
}

/** Parse a scanned/entered QR payload. Accepts the signed 7-field form and
 *  the legacy unsigned 6-field form; returns null when malformed. */
export function parseQrPayload(payload: string): QrPayload | null {
  const parts = String(payload || "").trim().split("|");
  if ((parts.length !== 6 && parts.length !== 7) || parts[0] !== "MMS") return null;
  if (parts[1] !== QR_KIND_CERT && parts[1] !== QR_KIND_RECEIPT) return null;
  return {
    version: parts[0],
    kind: parts[1],
    number: parts[2],
    verificationCode: parts[3],
    fingerprint: parts[4],
    issuedDate: parts[5],
    signature: parts.length === 7 ? parts[6] : undefined,
  };
}

/** True when the payload carries an HMAC tag. */
export function isSignedPayload(parsed: QrPayload | null): boolean {
  return !!parsed?.signature;
}

/** Re-check a parsed payload's HMAC tag against the app's signing key. */
export function verifyQrSignature(parsed: QrPayload | null, key: string): boolean {
  if (!parsed || !parsed.signature) return false;
  const base = ["MMS", parsed.kind, parsed.number, parsed.verificationCode, parsed.fingerprint, parsed.issuedDate].join("|");
  return signQrPayload(base, key) === parsed.signature.toUpperCase();
}

/** SVG data-URL of the QR for a payload (for embedding in print HTML / UI).
 *  Error correction L: the verify message is ~200 bytes — at L the code stays
 *  in a lower version (larger modules) so small prints (22mm A6 footer) scan
 *  reliably; prints are high-contrast vector output so M's redundancy is not
 *  needed. */
export async function qrSvgDataUrl(payload: string): Promise<string> {
  const svg = await QRCode.toString(payload, { type: "svg", margin: 1, width: 180, errorCorrectionLevel: "L", color: { dark: "#0e7c5b", light: "#ffffff" } });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Human-readable verification QR (v2 print format).
//
// Scanning a printed QR with any phone camera now shows a friendly message
// that tells the verifier HOW to check the document ("verification can be
// done using the Minz Mahallu app") and carries the printed security code,
// instead of the raw MMS|CERT|… machine line. The app's QR check box accepts
// BOTH forms: the new message (the security code inside is looked up in the
// register) and the legacy MMS|… payload (still HMAC-verified).
// ---------------------------------------------------------------------------

export type QrVerifyMessageArgs = {
  /** Full mahallu name from settings (e.g. "Minz Mahallu Jamath"). */
  mahalluName: string;
  /** Certificate number or receipt number as printed. */
  documentNumber: string;
  /** Register security code printed beside the QR. */
  verificationCode: string;
  /** yyyy-mm-dd (only the date part is used). */
  documentDate: string;
};

const QR_APP_NAME = "Minz Mahallu app";

/** Receipt QR message — what a phone shows when the receipt QR is scanned. */
export function buildReceiptQrMessage(args: QrVerifyMessageArgs): string {
  const name = args.mahalluName || "Mahallu";
  return [
    `${name} — Official Receipt`,
    `Receipt No: ${args.documentNumber}`,
    `Date: ${fmtMessageDate(args.documentDate)}`,
    ``,
    `This receipt can be verified using the ${QR_APP_NAME}.`,
    `Give the following security code for verification:`,
    `${args.verificationCode}`,
  ].join("\n");
}

/** Certificate QR message — what a phone shows when the certificate QR is scanned. */
export function buildCertificateQrMessage(args: QrVerifyMessageArgs): string {
  const name = args.mahalluName || "Mahallu";
  return [
    `${name} — Official Certificate`,
    `Certificate No: ${args.documentNumber}`,
    `Date: ${fmtMessageDate(args.documentDate)}`,
    ``,
    `This certificate can be verified using the ${QR_APP_NAME}.`,
    `Give the following security code for verification:`,
    `${args.verificationCode}`,
  ].join("\n");
}

function fmtMessageDate(date: string): string {
  const iso = String(date || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

export type ScannedQrText = {
  /** Security code extracted from the message (always present on success). */
  verificationCode: string;
  /** Document number claimed by the scanned text, when present. */
  number: string | null;
  /** "CERT" / "RCP" when the message names its document kind. */
  kind: string | null;
};

/** Extract the security code (and claimed number/kind) from text scanned off
 *  a printed QR — the human-readable message format. Also accepts a bare
 *  security code. Returns null when no recognizable code is present. */
export function extractScannedQrText(text: string): ScannedQrText | null {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("MMS|")) return null; // machine payloads use parseQrPayload
  const codeMatch = /(?:security code[^A-Z0-9\n]*|code\s*[:\-])\s*\n?\s*([A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4})/i.exec(raw)
    || /\b([A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4})\b/.exec(raw);
  if (!codeMatch) return null;
  const numberMatch = /(?:receipt|certificate)\s*(?:no|number)\s*[:\u00b7-]\s*([^\n·]+)/i.exec(raw);
  const kindMatch = /\breceipt\b/i.test(raw) ? "RCP" : /\bcertificate\b/i.test(raw) ? "CERT" : null;
  return {
    verificationCode: codeMatch[1].toUpperCase(),
    number: numberMatch ? numberMatch[1].trim() : null,
    kind: kindMatch,
  };
}
