/* Certificates module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run } from "../../db/connection.js";
import { makeVerificationCode } from "../codes.js";
import { nextCertificateNumber } from "../doc-number.service.js";
import { todayIST } from "../ist-date.js";
import { QR_KIND_CERT, extractScannedQrText, isSignedPayload, parseQrPayload, verifyQrSignature } from "../qr-code.js";
import { certificateQrVerifyMessage, getQrPrintContext, receiptQrVerifyMessage } from "../qr-signing.js";
import { nowDate } from "./shared.js";

// ---------------------------------------------------------------------------
// Receipt verification lookup (anti-forgery) — donations + subscription
// payments share ONE receipt series and both carry verification codes.
// ---------------------------------------------------------------------------
type ReceiptLookup = {
  source: "donations" | "subscription_payments" | "subscriptions";
  receipt: {
    receipt_number: string;
    verification_code: string;
    kind: "DONATION" | "SUBSCRIPTION";
    payer: string;
    payer_detail: string;
    amount: number;
    date: string;
    payment_method: string;
    status: string;
  };
};

function donationReceiptLookup(row: any): ReceiptLookup["receipt"] {
  return {
    receipt_number: String(row.receipt_number || ""),
    verification_code: String(row.verification_code || ""),
    kind: "DONATION",
    payer: String(row.donor_name || ""),
    payer_detail: String(row.donor_phone || ""),
    amount: Number(row.amount || 0),
    date: String(row.donation_date || "").slice(0, 10),
    payment_method: String(row.payment_method || ""),
    status: "Posted",
  };
}

function subscriptionReceiptLookup(row: any): ReceiptLookup["receipt"] {
  // Ledger rows: `amount` IS what was paid. Subscriptions mirror: `amount_paid`
  // is what was paid (amount = the monthly due). Both are selected AS
  // paid_amount by the callers.
  const paid = Number(row.paid_amount ?? row.amount_paid ?? row.amount ?? 0);
  return {
    receipt_number: String(row.receipt_number || ""),
    verification_code: String(row.verification_code || ""),
    kind: "SUBSCRIPTION",
    payer: String(row.member_name || row.house_name || row.family_number || ""),
    payer_detail: String(row.family_number || ""),
    amount: paid,
    date: String(row.payment_date || row.period_start || "").slice(0, 10),
    payment_method: String(row.payment_method || ""),
    status: String(row.status || ""),
  };
}

/** Find a money receipt by its register verification code. Only rows that
 *  actually carry a code (i.e. a receipt was issued) can match. */
function findReceiptByCode(code: string): ReceiptLookup | null {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return null;
  const d = one<any>(
    `SELECT receipt_number, verification_code, donor_name, donor_phone, amount, donation_date, payment_method
     FROM donations WHERE verification_code = ?`,
    [clean]
  );
  if (d) return { source: "donations", receipt: donationReceiptLookup(d) };
  const sp = one<any>(
    `SELECT sp.receipt_number, sp.verification_code, sp.amount AS paid_amount, sp.payment_date, sp.period_start, sp.payment_method, sp.status,
       f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = sp.member_id) AS member_name
     FROM subscription_payments sp LEFT JOIN families f ON f.id = sp.family_id
     WHERE sp.verification_code = ?`,
    [clean]
  );
  if (sp) return { source: "subscription_payments", receipt: subscriptionReceiptLookup(sp) };
  // Legacy mirror: accounts whose payment predates the ledger.
  const s = one<any>(
    `SELECT s.receipt_number, s.verification_code, s.amount_paid AS paid_amount, s.payment_date, s.period_start, s.payment_method, s.status,
       f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = s.member_id) AS member_name
     FROM subscriptions s LEFT JOIN families f ON f.id = s.family_id
     WHERE s.verification_code = ?`,
    [clean]
  );
  if (s) return { source: "subscriptions", receipt: subscriptionReceiptLookup(s) };
  return null;
}

/** Find a money receipt by verification code OR receipt number. */
function findReceiptByCodeOrNumber(query: string): ReceiptLookup | null {
  const byCode = findReceiptByCode(query);
  if (byCode) return byCode;
  const clean = String(query || "").trim().toUpperCase();
  if (!clean) return null;
  const d = one<any>(
    `SELECT receipt_number, verification_code, donor_name, donor_phone, amount, donation_date, payment_method
     FROM donations WHERE receipt_number = ?`,
    [clean]
  );
  if (d) return { source: "donations", receipt: donationReceiptLookup(d) };
  const sp = one<any>(
    `SELECT sp.receipt_number, sp.verification_code, sp.amount AS paid_amount, sp.payment_date, sp.period_start, sp.payment_method, sp.status,
       f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = sp.member_id) AS member_name
     FROM subscription_payments sp LEFT JOIN families f ON f.id = sp.family_id
     WHERE sp.receipt_number = ?`,
    [clean]
  );
  if (sp) return { source: "subscription_payments", receipt: subscriptionReceiptLookup(sp) };
  const s = one<any>(
    `SELECT s.receipt_number, s.verification_code, s.amount_paid AS paid_amount, s.payment_date, s.period_start, s.payment_method, s.status,
       f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = s.member_id) AS member_name
     FROM subscriptions s LEFT JOIN families f ON f.id = s.family_id
     WHERE s.receipt_number = ?`,
    [clean]
  );
  if (s) return { source: "subscriptions", receipt: subscriptionReceiptLookup(s) };
  return null;
}

export const certificates = {
  list: (filter: { type?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.type && filter.type !== "All Types") {
      where.push("type = ?");
      params.push(filter.type);
    }
    const sql = `SELECT * FROM certificates WHERE ${where.join(" AND ")} ORDER BY issued_date DESC, id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM certificates WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  /** Lazy backfill of a certificate's verification code — certificates issued
   *  by builds before the anti-forgery feature have no code, and without a code
   *  the print shows NO verify box / NO QR at all. The code is minted the
   *  moment the certificate is next touched (print / preview / verify), and
   *  issued codes never change. Mutates + returns the passed row's code. */
  ensureVerificationCode: (cert: { id: number; verification_code?: string | null }): string => {
    const current = String((cert as any).verification_code || "").trim();
    if (current) return current;
    const code = makeVerificationCode();
    run("UPDATE certificates SET verification_code = ? WHERE id = ?", [code, cert.id]);
    (cert as any).verification_code = code;
    return code;
  },
  /** Duplicate guard: an ACTIVE (Issued) certificate of this type already
   *  exists for the same linked record → return it with alreadyIssued so the
   *  UI can open the existing PDF instead of minting a second certificate. */
  findActiveDuplicate: (type: string, where: string, params: any[]): { id: number; certificate_number: string } | null => {
    const row = one<any>(
      `SELECT id, certificate_number FROM certificates WHERE type = ? AND status = 'Issued' AND ${where} ORDER BY id DESC LIMIT 1`,
      [type, ...params]
    );
    return row ? { id: Number(row.id), certificate_number: String(row.certificate_number) } : null;
  },
  /** Normalize the issue-result shape (older handlers returned mixed key
   *  casing — both are kept so every caller keeps working). */
  issueResult: (id: number, certificateNumber: string, alreadyIssued = false) => ({
    id,
    certificateNumber,
    certificate_number: certificateNumber,
    alreadyIssued,
  }),
  issueMembership: (memberCode: string, userId: number) => {
    const m = one<any>("SELECT * FROM members WHERE member_code = ?", [memberCode]);
    if (!m) throw new Error("Member not found");
    const existing = certificates.findActiveDuplicate("Membership", "member_id = ?", [m.id]);
    if (existing) return certificates.issueResult(existing.id, existing.certificate_number, true);
    const certNum = nextCertificateNumber("Membership", nowDate());
    const { id } = run(
      "INSERT INTO certificates (certificate_number, type, member_id, family_id, issued_to, issued_date, issued_by, status, verification_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [certNum, "Membership", m.id, m.family_id, m.name, nowDate(), userId, "Issued", makeVerificationCode()]
    );
    return certificates.issueResult(id, certNum);
  },
  issueResidence: (familyNumber: string, issuedTo: string, userId: number) => {
    const f = one<any>("SELECT * FROM families WHERE family_number = ?", [familyNumber]);
    if (!f) throw new Error("Family not found");
    const person = (issuedTo || "").trim() || f.house_name;
    const existing = certificates.findActiveDuplicate("Residence", "family_id = ? AND issued_to = ?", [f.id, person]);
    if (existing) return certificates.issueResult(existing.id, existing.certificate_number, true);
    const certNum = nextCertificateNumber("Residence", nowDate());
    const { id } = run(
      "INSERT INTO certificates (certificate_number, type, member_id, family_id, issued_to, issued_date, issued_by, status, verification_code) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)",
      [certNum, "Residence", f.id, person, nowDate(), userId, "Issued", makeVerificationCode()]
    );
    return certificates.issueResult(id, certNum);
  },
  issueMarriage: (marriageNumber: string, userId: number) => {
    const m = one<any>("SELECT * FROM marriages WHERE marriage_number = ?", [marriageNumber]);
    if (!m) throw new Error("Marriage record not found");
    const couple = m.bride_name + " & " + m.groom_name;
    // marriage_id is linked on new issues; legacy rows (NULL link) fall back to
    // matching the couple line so they still block duplicates.
    const existing = certificates.findActiveDuplicate(
      "Marriage",
      "(marriage_id = ? OR (marriage_id IS NULL AND issued_to = ?))",
      [m.id, couple]
    );
    if (existing) return certificates.issueResult(existing.id, existing.certificate_number, true);
    const certNum = nextCertificateNumber("Marriage", nowDate());
    const { id } = run(
      "INSERT INTO certificates (certificate_number, type, member_id, family_id, marriage_id, issued_to, issued_date, issued_by, status, verification_code) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 'Issued', ?)",
      [certNum, "Marriage", m.id, couple, nowDate(), userId, makeVerificationCode()]
    );
    return certificates.issueResult(id, certNum);
  },
  issueMarriageNoc: (marriageNum: string, userId: number) => {
    const marriage = one<any>("SELECT * FROM marriages WHERE marriage_number = ?", [marriageNum]);
    if (!marriage) throw new Error("Marriage record not found");
    const existing = certificates.findActiveDuplicate("NOC", "marriage_id = ?", [marriage.id]);
    if (existing) return certificates.issueResult(existing.id, existing.certificate_number, true);
    const certificateNumber = nextCertificateNumber("NOC", nowDate());
    const issuedTo = [marriage.bride_name, marriage.groom_name].filter(Boolean).join(" & ");
    const result = run(
      `INSERT INTO certificates (certificate_number, type, marriage_id, issued_to, issued_date, issued_by, notes, verification_code)
       VALUES (?, 'NOC', ?, ?, ?, ?, ?, ?)`,
      [certificateNumber, marriage.id, issuedTo, todayIST(), userId, `No Objection Certificate for marriage ${marriage.marriage_number}`, makeVerificationCode()]
    );
    return certificates.issueResult(result.id, certificateNumber);
  },
  issueDeath: (deathNumber: string, userId: number) => {
    const d = one<any>("SELECT * FROM deaths WHERE death_number = ?", [deathNumber]);
    if (!d) throw new Error("Death record not found");
    const existing = certificates.findActiveDuplicate("Death", "death_id = ?", [d.id]);
    if (existing) return certificates.issueResult(existing.id, existing.certificate_number, true);
    const certNum = nextCertificateNumber("Death", nowDate());
    const { id } = run(
      "INSERT INTO certificates (certificate_number, type, member_id, family_id, marriage_id, death_id, issued_to, issued_date, issued_by, status, verification_code) VALUES (?, 'Death', NULL, ?, NULL, ?, ?, ?, ?, 'Issued', ?)",
      [certNum, d.family_id ?? null, d.id, d.deceased_name, nowDate(), userId, makeVerificationCode()]
    );
    return certificates.issueResult(id, certNum);
  },
  /** Anti-forgery lookup: any printed code or number can be checked against
   *  the register — certificates (by code or number) AND money receipts
   *  (donations + subscription payments, by code or receipt number). */
  verify: (code: string) => {
    const clean = String(code || "").trim().toUpperCase();
    if (!clean) throw new Error("Enter a verification code");
    const cert = one<any>(
      `SELECT id, certificate_number, type, member_id, family_id, issued_to, issued_date, issued_by, status, reprint_count, verification_code
       FROM certificates WHERE verification_code = ? OR certificate_number = ?`,
      [clean, clean]
    );
    if (!cert) {
      const receipt = findReceiptByCodeOrNumber(clean);
      if (!receipt) return { valid: false, kind: null, certificate: null, receipt: null };
      const { fingerprint } = getQrPrintContext();
      return {
        valid: true,
        kind: "RECEIPT",
        certificate: null,
        receipt: receipt.receipt,
        // The QR payload printed on this receipt — the human-readable message
        // format (what a phone shows when the QR is scanned).
        qrPayload: receiptQrVerifyMessage({
          receiptNumber: String(receipt.receipt.receipt_number || ""),
          verificationCode: String(receipt.receipt.verification_code || ""),
          date: String(receipt.receipt.date || "").slice(0, 10),
        }),
        deviceFingerprint: fingerprint,
      };
    }
    const { fingerprint } = getQrPrintContext();
    // Legacy certificates (issued before the anti-forgery feature) get their
    // code minted NOW — without it the print shows no QR / verify box at all.
    certificates.ensureVerificationCode(cert);
    return {
      valid: true,
      kind: "CERTIFICATE",
      certificate: {
        certificate_number: cert.certificate_number,
        type: cert.type,
        issued_to: cert.issued_to,
        issued_date: cert.issued_date,
        status: cert.status,
        reprint_count: cert.reprint_count || 0,
      },
      receipt: null,
      // The QR text printed on this certificate — the human-readable message
      // format (scanning it shows the verify-via-app instructions + code).
      qrPayload: certificateQrVerifyMessage(cert),
      deviceFingerprint: fingerprint,
    };
  },
  /**
   * QR anti-forgery: verify a scanned QR — accepts BOTH print formats.
   *
   *   1. The human-readable message (v2 prints): any phone scan shows
   *      "…can be verified using the Minz Mahallu app. Give the following
   *      security code for verification: XXXX-…" — the code is extracted and
   *      looked up in the register (certificates, then receipts). The claimed
   *      document number is cross-checked against the register record so a
   *      doctored scan text is flagged.
   *   2. The machine payload (v1 prints / manual entry):
   *      MMS|CERT|num|code|fp|date[|sig] and MMS|RCP|num|code|fp|date[|sig].
   *      Signed payloads are HMAC-checked first (a field altered after
   *      printing no longer matches the tag), then register-looked-up, then
   *      checked against this device's fingerprint. Six-field payloads are
   *      legacy prints: no tag to check, but still register-verified.
   */
  verifyQr: (payload: string) => {
    const raw = String(payload || "").trim();
    const parsed = parseQrPayload(raw);

    // ---- v2: human-readable scanned text → security-code lookup ----
    if (!parsed) {
      const scanned = extractScannedQrText(raw);
      if (!scanned) return { valid: false, reason: "malformed", kind: null, certificate: null, receipt: null };
      const cert = one<any>(
        `SELECT id, certificate_number, type, issued_to, issued_date, issued_by, status, reprint_count, verification_code
         FROM certificates WHERE verification_code = ?`,
        [scanned.verificationCode]
      );
      if (cert) {
        return {
          valid: true,
          kind: "CERTIFICATE",
          certificate: {
            certificate_number: cert.certificate_number,
            type: cert.type,
            issued_to: cert.issued_to,
            issued_date: cert.issued_date,
            status: cert.status,
            reprint_count: cert.reprint_count || 0,
          },
          receipt: null,
          source: "message",
          qr: { verificationCode: scanned.verificationCode, claimedNumber: scanned.number, signed: false },
          // A scan text whose claimed number disagrees with the register record
          // was doctored after printing — flag it instead of passing silently.
          certificateMatchesRegister: !scanned.number || scanned.number === cert.certificate_number,
        };
      }
      const receipt = findReceiptByCode(scanned.verificationCode);
      if (receipt) {
        return {
          valid: true,
          kind: "RECEIPT",
          certificate: null,
          receipt: receipt.receipt,
          source: "message",
          qr: { verificationCode: scanned.verificationCode, claimedNumber: scanned.number, signed: false },
          receiptMatchesRegister: !scanned.number || scanned.number === receipt.receipt.receipt_number,
        };
      }
      return { valid: false, reason: "not-found", kind: scanned.kind === "CERT" ? "CERTIFICATE" : scanned.kind === "RCP" ? "RECEIPT" : null, certificate: null, receipt: null };
    }

    // ---- v1: machine payload → HMAC + register + device fingerprint ----
    // Signed payload → the tag must match the mahallu's key. An outsider can
    // clone a whole QR but cannot alter any field or mint a new one.
    if (isSignedPayload(parsed)) {
      const { signingKey } = getQrPrintContext();
      if (signingKey && !verifyQrSignature(parsed, signingKey)) {
        return { valid: false, reason: "bad-signature", kind: null, certificate: null, receipt: null };
      }
    }

    if (parsed.kind === QR_KIND_CERT) {
      const cert = one<any>(
        `SELECT id, certificate_number, type, issued_to, issued_date, issued_by, status, reprint_count, verification_code
         FROM certificates WHERE verification_code = ?`,
        [parsed.verificationCode]
      );
      if (!cert) return { valid: false, reason: "not-found", kind: "CERTIFICATE", certificate: null, receipt: null };
      const { fingerprint: currentFp } = getQrPrintContext();
      return {
        valid: true,
        kind: "CERTIFICATE",
        certificate: {
          certificate_number: cert.certificate_number,
          type: cert.type,
          issued_to: cert.issued_to,
          issued_date: cert.issued_date,
          status: cert.status,
          reprint_count: cert.reprint_count || 0,
        },
        receipt: null,
        qr: {
          fingerprint: parsed.fingerprint,
          issuedDate: parsed.issuedDate,
          certificateNumber: parsed.number,
          signed: isSignedPayload(parsed),
        },
        issuedOnThisDevice: !!currentFp && parsed.fingerprint.toUpperCase() === currentFp.toUpperCase(),
        certificateMatchesRegister: parsed.number === cert.certificate_number,
      };
    }

    // Receipt payload (RCP)
    const found = findReceiptByCode(parsed.verificationCode);
    if (!found) return { valid: false, reason: "not-found", kind: "RECEIPT", certificate: null, receipt: null };
    const { fingerprint: currentFpR } = getQrPrintContext();
    return {
      valid: true,
      kind: "RECEIPT",
      certificate: null,
      receipt: found.receipt,
      qr: {
        fingerprint: parsed.fingerprint,
        issuedDate: parsed.issuedDate,
        certificateNumber: parsed.number,
        receiptNumber: parsed.number,
        signed: isSignedPayload(parsed),
      },
      issuedOnThisDevice: !!currentFpR && parsed.fingerprint.toUpperCase() === currentFpR.toUpperCase(),
      receiptMatchesRegister: parsed.number === found.receipt.receipt_number,
    };
  },
  /** Count reprints so printed copies carry a "Reprinted on" corner note. */
  markReprint: (id: number) => {
    run("UPDATE certificates SET reprint_count = COALESCE(reprint_count, 0) + 1, updated_at = datetime('now') WHERE id = ?", [id]);
    return one<any>("SELECT * FROM certificates WHERE id = ?", [id]);
  },
  remove: (id: number) => run("DELETE FROM certificates WHERE id = ?", [id]),
};
