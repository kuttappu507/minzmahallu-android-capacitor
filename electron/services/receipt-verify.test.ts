/*
 * Receipt/certificate verification (anti-forgery) — DB-backed integration.
 *
 * Covers the full document trust chain:
 *   · the QR signing key + device fingerprint are provisioned on this DB,
 *   · demo receipts arrive with verification codes (startup provisioning),
 *   · verify() finds receipts by code AND by receipt number,
 *   · the printed QR is now the HUMAN-READABLE verify message — scanning it
 *     shows "…can be verified using the Minz Mahallu app. Give the following
 *     security code for verification: XXXX-…"; verifyQr() accepts that
 *     scanned text (code lookup), a bare code, and the legacy MMS| machine
 *     payload (still HMAC-verified; tampering → bad-signature),
 *   · legacy certificates with no verification code get one minted lazily
 *     (they used to print with NO QR box at all),
 *   · issuing a certificate for a record that already has one returns the
 *     existing certificate (alreadyIssued) instead of minting a duplicate,
 *   · a new donation gets a code the moment its receipt is assembled
 *     (same lazy backfill as receipt numbers).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDB } from "../db/connection.js";
import { donations, certificates as certs } from "./data.service.js";
import { ensureDonationVerificationCode } from "./receipt.service.js";
import { ensureDonationReceiptNumber } from "./doc-number.service.js";
import { parseQrPayload, verifyQrSignature, signQrPayload, extractScannedQrText, buildReceiptQrPayload } from "./qr-code.js";
import { getQrPrintContext, signedReceiptQrPayload } from "./qr-signing.js";
import { ensureFamilyWithHead, ensureDeathRecord, ensureMarriageRecord } from "./fixtures.js";

function firstReceiptRow() {
  return getDB().prepare("SELECT verification_code, receipt_number FROM donations WHERE verification_code != '' LIMIT 1").get() as any;
}

/** Fresh DBs ship EMPTY (the demo dataset was retired for security). Seed the
 *  donation receipts this suite verifies against — the service assigns the
 *  receipt number and verification code exactly as the office flow does. */
function ensureDonationFixtures(): void {
  const db = getDB();
  const have = db.prepare("SELECT COUNT(*) AS c FROM donations").get() as { c: number };
  if (Number(have?.c ?? 0) > 0) return;
  const cat = db.prepare("SELECT id FROM donation_categories ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  for (const [i, d] of [
    { donorName: "Fixture Donor One", amount: 1000, donationDate: "2026-09-01", paymentMethod: "Cash" },
    { donorName: "Fixture Donor Two", amount: 2500, donationDate: "2026-09-02", paymentMethod: "UPI" },
  ].entries()) {
    const created: any = donations.create({
      donorName: d.donorName, donorPhone: `91987654321${i}`, donorAddress: "",
      familyId: null, memberId: null, categoryId: cat?.id ?? 1, amount: d.amount,
      donationDate: d.donationDate, receiptNumber: "", purpose: "Fixture", paymentMethod: d.paymentMethod,
      transactionRef: "", remarks: "",
    });
    const id = Number(created?.id ?? created?.lastInsertRowid ?? created);
    // Numbers and security codes are minted lazily (on first receipt render)
    // in the office flow — mint them here so the verify lookups have targets.
    ensureDonationReceiptNumber(id, d.donationDate);
    ensureDonationVerificationCode(id);
  }
}

describe("QR trust chain provisioning", () => {
  beforeAll(() => { getDB(); ensureDonationFixtures(); });

  it("provisions a stable 64-hex signing key (never printed, never re-rolled)", () => {
    const row = getDB().prepare("SELECT qr_signing_key, device_fingerprint FROM settings WHERE id = 1").get() as
      | { qr_signing_key?: string; device_fingerprint?: string }
      | undefined;
    expect(row?.qr_signing_key).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.device_fingerprint).toMatch(/^[0-9A-F]{16}$/);
    // The context helper returns exactly the stored values.
    const ctx = getQrPrintContext();
    expect(ctx.signingKey).toBe(row!.qr_signing_key);
    expect(ctx.fingerprint).toBe(row!.device_fingerprint);
  });

  it("gives every issued demo receipt a verification code", () => {
    const db = getDB();
    const missingDon = db.prepare("SELECT COUNT(*) AS c FROM donations WHERE receipt_number != '' AND (verification_code IS NULL OR verification_code = '')").get() as { c: number };
    const missingSub = db.prepare("SELECT COUNT(*) AS c FROM subscription_payments WHERE receipt_number != '' AND (verification_code IS NULL OR verification_code = '')").get() as { c: number };
    expect(missingDon.c).toBe(0);
    expect(missingSub.c).toBe(0);
  });
});

describe("receipt verification (verify + verifyQr)", () => {
  beforeAll(() => { getDB(); ensureDonationFixtures(); });

  it("finds a receipt by its verification code", () => {
    const db = getDB();
    const row = db.prepare("SELECT verification_code, receipt_number, donor_name, amount FROM donations WHERE verification_code IS NOT NULL AND verification_code != '' LIMIT 1").get() as any;
    expect(row).toBeTruthy();
    const res: any = certs.verify(row.verification_code);
    expect(res.valid).toBe(true);
    expect(res.kind).toBe("RECEIPT");
    expect(res.receipt.receipt_number).toBe(row.receipt_number);
    expect(res.receipt.payer).toBe(row.donor_name);
    expect(res.receipt.amount).toBe(Number(row.amount));
    expect(res.deviceFingerprint).toMatch(/^[0-9A-F]{16}$/);
  });

  it("finds a receipt by its receipt NUMBER (the office types what is printed)", () => {
    const db = getDB();
    const row = db.prepare("SELECT receipt_number FROM donations WHERE receipt_number IS NOT NULL AND receipt_number != '' LIMIT 1").get() as any;
    const res: any = certs.verify(row.receipt_number);
    expect(res.valid).toBe(true);
    expect(res.kind).toBe("RECEIPT");
    expect(res.receipt.receipt_number).toBe(row.receipt_number);
  });

  it("reports unknown codes as invalid", () => {
    const res = certs.verify("ZZZZ-ZZZZ-ZZZZ");
    expect(res.valid).toBe(false);
    expect(res.kind).toBeNull();
  });

  it("returns the HUMAN-READABLE verify message as the printed QR text", () => {
    const row = firstReceiptRow();
    const res: any = certs.verify(row.receipt_number);
    // What a phone shows when the printed QR is scanned.
    expect(String(res.qrPayload)).toContain("can be verified using the Minz Mahallu app");
    expect(String(res.qrPayload)).toContain("security code for verification");
    expect(String(res.qrPayload)).toContain(row.receipt_number);
    expect(String(res.qrPayload)).toContain(row.verification_code);
    // The message parses back into its code + number.
    const scanned = extractScannedQrText(String(res.qrPayload));
    expect(scanned?.verificationCode).toBe(row.verification_code);
    expect(scanned?.number).toBe(row.receipt_number);
  });

  it("round-trips a scanned MESSAGE through verifyQr (register lookup)", () => {
    const row = firstReceiptRow();
    const byNumber: any = certs.verify(row.receipt_number);
    const checked: any = certs.verifyQr(String(byNumber.qrPayload));
    expect(checked.valid).toBe(true);
    expect(checked.kind).toBe("RECEIPT");
    expect(checked.source).toBe("message");
    expect(checked.receiptMatchesRegister).toBe(true);
    expect(checked.receipt.receipt_number).toBe(row.receipt_number);
  });

  it("accepts a BARE security code in the QR check box", () => {
    const row = firstReceiptRow();
    const checked: any = certs.verifyQr(row.verification_code);
    expect(checked.valid).toBe(true);
    expect(checked.kind).toBe("RECEIPT");
    expect(checked.source).toBe("message");
    expect(checked.receipt.receipt_number).toBe(row.receipt_number);
  });

  it("still round-trips the LEGACY machine payload (signed, device-bound)", () => {
    const row = firstReceiptRow();
    const genuine = signedReceiptQrPayload({
      receiptNumber: row.receipt_number,
      verificationCode: row.verification_code,
      date: "2026-08-19",
    });
    const parsed = parseQrPayload(genuine);
    expect(parsed?.kind).toBe("RCP");
    const { signingKey } = getQrPrintContext();
    expect(verifyQrSignature(parsed, signingKey)).toBe(true);

    const checked: any = certs.verifyQr(genuine);
    expect(checked.valid).toBe(true);
    expect(checked.kind).toBe("RECEIPT");
    expect(checked.receiptMatchesRegister).toBe(true);
    expect(checked.issuedOnThisDevice).toBe(true);
    expect(checked.qr.signed).toBe(true);
  });

  it("rejects a TAMPERED legacy payload — bad-signature (forged QR)", () => {
    const row = firstReceiptRow();
    const genuine = signedReceiptQrPayload({
      receiptNumber: row.receipt_number,
      verificationCode: row.verification_code,
      date: "2026-08-19",
    });
    // Forger alters the receipt number by one digit, keeping the tag.
    const parts = genuine.split("|");
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("9") ? "8" : "9");
    const forged = parts.join("|");
    // The structure still parses…
    expect(parseQrPayload(forged)).not.toBeNull();
    // …but the signature check fails, so verification reports it.
    const res: any = certs.verifyQr(forged);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("bad-signature");
  });

  it("reports a well-formed signed payload with an unknown code as not-found", () => {
    const row = firstReceiptRow();
    const parts = buildReceiptQrPayload(
      { number: row.receipt_number, verificationCode: "ZZZZ-ZZZZ-ZZZZ", fingerprint: getQrPrintContext().fingerprint, issuedDate: "2026-08-19" },
      getQrPrintContext().signingKey
    ).split("|");
    parts[3] = "ZZZZ-ZZZZ-ZZZZ"; // unknown code — recompute the tag so only the lookup fails
    parts[6] = signQrPayload(parts.slice(0, 6).join("|"), getQrPrintContext().signingKey);
    const res: any = certs.verifyQr(parts.join("|"));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("not-found");
  });

  it("flags a DOCTORED scan message whose number disagrees with the register", () => {
    const row = firstReceiptRow();
    // A forger re-writes the QR text to claim a different receipt number.
    const doctored = certs.verifyQr(
      `Minz Mahallu Jamath — Official Receipt\nReceipt No: MMJM/99/99/999\n\nThis receipt can be verified using the Minz Mahallu app.\nGive the following security code for verification:\n${row.verification_code}`
    ) as any;
    expect(doctored.valid).toBe(true); // the code is real…
    expect(doctored.receiptMatchesRegister).toBe(false); // …but the claimed number is not.
  });

  it("gives a new donation a verification code the moment its receipt is assembled", () => {
    const cat = getDB().prepare("SELECT id FROM donation_categories ORDER BY id LIMIT 1").get() as { id: number };
    const created = donations.create({ donorName: "Verify Backfill", amount: 100, categoryId: cat.id, donationDate: "2026-09-02" });
    const id = Number(created.id);
    try {
      const before = getDB().prepare("SELECT verification_code FROM donations WHERE id = ?").get(id) as { verification_code?: string };
      expect(String(before.verification_code || "")).toBe(""); // not yet issued
      const code = ensureDonationVerificationCode(id);
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      // Stable: a second call returns the SAME code (issued codes never change).
      expect(ensureDonationVerificationCode(id)).toBe(code);
      // And now the code verifies.
      const res: any = certs.verify(code);
      expect(res.valid).toBe(true);
      expect(res.kind).toBe("RECEIPT");
      expect(res.receipt.payer).toBe("Verify Backfill");
    } finally {
      donations.remove(id);
    }
  });
});

describe("certificate verification + duplicate-issue guard", () => {
  beforeAll(() => {
    getDB();
    // Fresh DBs are empty — certificate issue flows need a member, a death
    // register row and a marriage register row to certify against.
    const { memberId } = ensureFamilyWithHead();
    ensureDeathRecord();
    ensureMarriageRecord();
    // The verify-message test expects at least one ISSUED certificate with a
    // security code (the office would have issued one; issue it here).
    const have = getDB().prepare("SELECT COUNT(*) AS c FROM certificates WHERE status='Issued'").get() as { c: number };
    if (Number(have?.c ?? 0) === 0) {
      const member = getDB().prepare("SELECT member_code FROM members WHERE id = ?").get(memberId) as { member_code: string };
      certs.issueMembership(member.member_code, 1);
    }
  });

  it("returns the human-readable verify message for a certificate", () => {
    const db = getDB();
    const cert = db.prepare("SELECT id, certificate_number, verification_code, issued_to FROM certificates WHERE verification_code != '' ORDER BY id LIMIT 1").get() as any;
    expect(cert).toBeTruthy();
    const res: any = certs.verify(cert.certificate_number);
    expect(res.valid).toBe(true);
    expect(res.kind).toBe("CERTIFICATE");
    expect(res.certificate.issued_to).toBe(cert.issued_to);
    expect(String(res.qrPayload)).toContain("can be verified using the Minz Mahallu app");
    expect(String(res.qrPayload)).toContain(cert.certificate_number);
    expect(String(res.qrPayload)).toContain(cert.verification_code);
    // The message QR round-trips through verifyQr as a certificate record.
    const checked: any = certs.verifyQr(String(res.qrPayload));
    expect(checked.valid).toBe(true);
    expect(checked.kind).toBe("CERTIFICATE");
    expect(checked.source).toBe("message");
    expect(checked.certificateMatchesRegister).toBe(true);
    expect(checked.certificate.certificate_number).toBe(cert.certificate_number);
  });

  it("mints a code for a LEGACY certificate with no code (lazy backfill)", () => {
    const db = getDB();
    // Simulate a certificate issued before the anti-forgery feature.
    const legacyNumber = `TEST-LEGACY-${Date.now()}`;
    const runRes = db.prepare(
      "INSERT INTO certificates (certificate_number, type, member_id, family_id, issued_to, issued_date, issued_by, status, verification_code) VALUES (?, 'Membership', NULL, NULL, 'Legacy Member', '2024-01-01', 1, 'Issued', NULL)"
    ).run(legacyNumber);
    const id = Number(runRes.lastInsertRowid);
    try {
      const row = db.prepare("SELECT verification_code FROM certificates WHERE id = ?").get(id) as { verification_code?: string };
      expect(String(row.verification_code || "")).toBe(""); // legacy: no code
      // Touching it (verify by number) mints a code — and it sticks.
      const res: any = certs.verify(legacyNumber);
      expect(res.valid).toBe(true);
      expect(res.qrPayload).toContain("security code for verification");
      const after = db.prepare("SELECT verification_code FROM certificates WHERE id = ?").get(id) as { verification_code?: string };
      expect(String(after.verification_code || "")).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(String(res.qrPayload)).toContain(String(after.verification_code));
      // ensureVerificationCode is stable — the minted code never changes.
      const certRow = db.prepare("SELECT id, verification_code FROM certificates WHERE id = ?").get(id) as any;
      expect(certs.ensureVerificationCode(certRow)).toBe(after.verification_code);
    } finally {
      // No DELETE cleanup — certificates are protected by an anti-delete
      // trigger, and the test DB is a fresh per-run (PID-scoped) database.
      db.prepare("UPDATE certificates SET status = 'Void', certificate_number = certificate_number || '-VOID' WHERE id = ?").run(id);
    }
  });

  it("re-issuing an existing certificate returns the SAME record (alreadyIssued)", () => {
    const db = getDB();
    const member = db.prepare("SELECT member_code, id FROM members ORDER BY id LIMIT 1").get() as any;
    const first: any = certs.issueMembership(member.member_code, 1);
    const second: any = certs.issueMembership(member.member_code, 1);
    // The first call may issue (fresh DB) or return a pre-existing demo
    // certificate — either way the SECOND call must never mint a duplicate.
    expect(second.alreadyIssued).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.certificate_number).toBe(first.certificate_number);
    expect(second.certificateNumber).toBe(first.certificate_number); // normalized shape
    // Exactly ONE active Membership certificate for this member.
    const count = db.prepare("SELECT COUNT(*) AS c FROM certificates WHERE type = 'Membership' AND member_id = ? AND status = 'Issued'").get(member.id) as { c: number };
    expect(count.c).toBe(1);
  });

  it("re-issuing a death certificate for the same death also deduplicates", () => {
    const db = getDB();
    const death = db.prepare("SELECT death_number, id FROM deaths ORDER BY id LIMIT 1").get() as any;
    const first: any = certs.issueDeath(death.death_number, 1);
    const second: any = certs.issueDeath(death.death_number, 1);
    expect(second.alreadyIssued).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("re-issuing residence for a DIFFERENT person is allowed (not a duplicate)", () => {
    const db = getDB();
    const family = db.prepare("SELECT family_number, id FROM families ORDER BY id LIMIT 1").get() as any;
    const stamp = Date.now();
    const a: any = certs.issueResidence(family.family_number, `First Person ${stamp}`, 1);
    const b: any = certs.issueResidence(family.family_number, `Second Person ${stamp}`, 1);
    expect(a.alreadyIssued).toBeFalsy();
    expect(b.alreadyIssued).toBeFalsy(); // different issued_to → new certificate
    expect(b.id).not.toBe(a.id);
    // But the same person again is a duplicate.
    const c: any = certs.issueResidence(family.family_number, `Second Person ${stamp}`, 1);
    expect(c.alreadyIssued).toBe(true);
    expect(c.id).toBe(b.id);
    // No DELETE cleanup — certificates are protected by an anti-delete
    // trigger, and the test DB is a fresh per-run (PID-scoped) database; the
    // unique per-run person names keep later runs from matching these rows.
  });

  it("marriage certificates link marriage_id and deduplicate on it", () => {
    const db = getDB();
    const marriage = db.prepare("SELECT marriage_number, id FROM marriages ORDER BY id LIMIT 1").get() as any;
    const first: any = certs.issueMarriage(marriage.marriage_number, 1);
    const row = db.prepare("SELECT marriage_id FROM certificates WHERE id = ?").get(first.id) as { marriage_id?: number };
    expect(Number(row.marriage_id)).toBe(Number(marriage.id)); // linked now
    const second: any = certs.issueMarriage(marriage.marriage_number, 1);
    expect(second.alreadyIssued).toBe(true);
    expect(second.id).toBe(first.id);
  });

  it("verifyQr still rejects garbage input", () => {
    const res: any = certs.verifyQr("not a qr anything");
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("malformed");
  });
});
