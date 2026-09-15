/*
 * Unified document numbering — PREFIX/CODE/yy/MM/NNN.
 * Pure helpers are checked directly; the DB-backed allocation is exercised
 * through the real CRUD layer (donations / subscriptions / certificates) on
 * the demo database, exactly as the app uses it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDB } from "../db/connection.js";
import { donations, subscriptions, certificates } from "./data.service.js";
import { ensureFamily, ensurePendingSubscription, ensureFamilyWithHead, ensureDeathRecord } from "./fixtures.js";
import {
  sanitizePrefix,
  mahalluInitials,
  yearMonthOf,
  formatDocNumber,
  maxSeriesUsed,
  fileNameSafe,
  nextReceiptNumber,
  nextCertificateNumber,
  ensureDonationReceiptNumber,
} from "./doc-number.service.js";

const NUM = /^[A-Z]{1,5}\/[A-Z]{1,3}\/\d{2}\/\d{2}\/\d{3,}$/;

describe("doc-number pure helpers", () => {
  it("sanitizes prefixes to 1–5 capital letters", () => {
    expect(sanitizePrefix("mmh 2!", "RC")).toBe("MMH");
    expect(sanitizePrefix("KMJ", "RC")).toBe("KMJ");
    expect(sanitizePrefix("ABCDEFGH", "RC")).toBe("ABCDE");
    expect(sanitizePrefix("മിൻസ്", "RC")).toBe("RC");
    expect(sanitizePrefix("", "RC")).toBe("RC");
    expect(sanitizePrefix(null, "RC")).toBe("RC");
  });

  it("derives the mahallu's letters from the name", () => {
    // Initial of every word, up to four letters.
    expect(mahalluInitials("Minz Mahallu Juma Masjid")).toBe("MMJM");
    expect(mahalluInitials("Minz Mahallu Jamath")).toBe("MMJ");
    expect(mahalluInitials("Kunnoth P O")).toBe("KPO");
    // Fewer than three initials → the first three letters of the name.
    expect(mahalluInitials("Minz Mahallu")).toBe("MIN");
    expect(mahalluInitials("Noor")).toBe("NOO");
    // Names with no Latin letters yield "" (caller falls back generically).
    expect(mahalluInitials("മിൻസ് മഹല്ല്")).toBe("");
    expect(mahalluInitials("")).toBe("");
  });

  it("splits a stored date into a 2-digit year and month", () => {
    expect(yearMonthOf("2026-09-15")).toEqual({ y: "26", m: "09" });
    expect(yearMonthOf("1999-01-01T00:00:00")).toEqual({ y: "99", m: "01" });
    // Unparseable values fall back to today (IST) — still 2-digit.
    expect(yearMonthOf("")).toMatchObject({ m: expect.stringMatching(/^\d{2}$/) });
  });

  it("formats PREFIX/yy/MM/NNN with 3-digit padding that grows past 999", () => {
    expect(formatDocNumber("MMH", "26", "02", 1)).toBe("MMH/26/02/001");
    expect(formatDocNumber("MMH", "26", "02", 42)).toBe("MMH/26/02/042");
    expect(formatDocNumber("DT", "26", "09", 1000)).toBe("DT/26/09/1000");
    // A four-digit year still prints as two digits — the format owns the shape.
    expect(formatDocNumber("MMJM", "2026", "09", 1)).toBe("MMJM/26/09/001");
  });

  it("finds the highest used sequence, ignoring legacy formats and other months", () => {
    const used = [
      "MMH/26/02/001",
      "MMH/26/02/012",
      "MMH/26/02/007",
      "MMH/26/03/001", // different month
      "MMH/25/02/999", // different year
      "MMH/2026/02/001", // old four-digit-year scheme — never matches
      "MMH/DT/26/02/005", // certificate series — never matches receipts
      "DON-003",
      "RCP-0001",
      "",
    ];
    expect(maxSeriesUsed(used, "MMH", "26", "02")).toBe(12);
    expect(maxSeriesUsed(used, "MMH", "26", "03")).toBe(1);
    expect(maxSeriesUsed(used, "MMH", "26", "01")).toBe(0);
    // A four-digit year argument finds the two-digit numbers just the same.
    expect(maxSeriesUsed(used, "MMH", "2026", "02")).toBe(12);
  });

  it("never lets receipt numbers inflate a certificate series (or vice versa)", () => {
    // Receipts are PREFIX/SERIES/yy/MM/NNN; certificates are
    // PREFIX/CODE/yy/MM/NNN — the heads cannot cross-match, so the series
    // stay independent, and the DN/SB receipt codes keep the two money
    // books apart as well.
    expect(maxSeriesUsed(["MM/26/09/001", "MM/26/09/007"], "MM/DT", "26", "09")).toBe(0);
    expect(maxSeriesUsed(["MM/DT/26/09/004"], "MM", "26", "09")).toBe(0);
    // Old-scheme certificate numbers (four-digit year, no mahallu prefix)
    // never match the new head either — no collision, no sequence inflation.
    expect(maxSeriesUsed(["DT/2026/09/001", "MM/DT/2026/09/001"], "MM/DT", "26", "09")).toBe(0);
  });

  it("makes numbers file-name safe", () => {
    expect(fileNameSafe("MMJM/26/09/001")).toBe("MMJM-26-09-001");
    expect(fileNameSafe(123)).toBe("123");
  });
});

describe("doc-number allocation (real CRUD layer)", () => {
  beforeAll(() => {
    const db = getDB(); // loads schema + migrations + demo data (+ renumber)
    // Deterministic prefix source: the demo mahallu name's own letters; the
    // stored prefix stays at the legacy "RCP" placeholder, which must be
    // ignored in favour of the derived MMJM.
    db.prepare("UPDATE settings SET mahallu_name = 'Minz Mahallu Juma Masjid', receipt_prefix = 'RCP' WHERE id = 1").run();
  });

  it("numbers donations MMJM/DN/yy/MM/NNN, sequencing per month, honoring manual numbers", () => {
    const cat = getDB().prepare("SELECT id FROM donation_categories ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    expect(cat).toBeTruthy();
    const created: number[] = [];
    try {
      const first = donations.create({ donorName: "Numbering One", amount: 100, categoryId: cat!.id, donationDate: "2026-09-01" });
      expect(first.receiptNumber).toBe("MMJM/DN/26/09/001");

      const second = donations.create({ donorName: "Numbering Two", amount: 100, categoryId: cat!.id, donationDate: "2026-09-02" });
      expect(second.receiptNumber).toBe("MMJM/DN/26/09/002");

      // A manual number (book migration) is honored verbatim.
      const manual = donations.create({ donorName: "Numbering Book", amount: 100, categoryId: cat!.id, donationDate: "2026-09-03", receiptNumber: "BOOK-77" });
      expect(manual.receiptNumber).toBe("BOOK-77");

      // A different month starts its own sequence.
      const aug = donations.create({ donorName: "Numbering Aug", amount: 100, categoryId: cat!.id, donationDate: "2026-08-15" });
      expect(aug.receiptNumber).toMatch(/^MMJM\/DN\/26\/08\/\d{3}$/);

      created.push(first.id, second.id, manual.id, aug.id);
    } finally {
      for (const id of created) donations.remove(id);
    }
  });

  it("uses a customized prefix the moment the mahallu sets one", () => {
    const db = getDB();
    db.prepare("UPDATE settings SET receipt_prefix = 'KMJ' WHERE id = 1").run();
    try {
      expect(nextReceiptNumber("2026-09-01", "donation")).toMatch(/^KMJ\/DN\/26\/09\/\d{3}$/);
      expect(nextReceiptNumber("2026-09-01", "subscription")).toMatch(/^KMJ\/SB\/26\/09\/\d{3}$/);
      // The customized prefix leads certificate numbers too — one mahallu
      // identity across every document the app issues.
      expect(nextCertificateNumber("Death", "2026-09-01")).toMatch(/^KMJ\/DT\/26\/09\/\d{3}$/);
    } finally {
      db.prepare("UPDATE settings SET receipt_prefix = 'RCP' WHERE id = 1").run();
    }
  });

  it("numbers subscription payments in their OWN SB series (donations run DN) and never renumbers an issued receipt", () => {
    // Fresh DBs ship empty: create the Pending August account this test bills.
    const famId = ensureFamily();
    ensurePendingSubscription(famId, 150);
    getDB().prepare("UPDATE subscriptions SET period_start='2026-08-01', period_end='2026-08-31', amount=150, amount_paid=0, status='Pending' WHERE family_id = ?").run(famId);
    const pending = getDB()
      .prepare("SELECT id, period_start, amount FROM subscriptions WHERE status = 'Pending' AND amount > 0 AND period_start = '2026-08-01' ORDER BY id LIMIT 1")
      .get() as { id: number; period_start: string; amount: number } | undefined;
    expect(pending).toBeTruthy();

    const paid = subscriptions.applyPayment(pending!.id, { amountPaid: 100, paymentDate: "2026-08-20", paymentMethod: "Cash" });
    expect(paid.receiptNumber).toMatch(/^MMJM\/SB\/26\/08\/\d{3}$/);

    // The two money books never share a number: same day, same prefix, but
    // the donation series carries DN while the subscription series carries SB.
    expect(nextReceiptNumber("2026-08-20", "donation")).toMatch(/^MMJM\/DN\/26\/08\/\d{3}$/);
    expect(nextReceiptNumber("2026-08-20", "donation")).not.toBe(paid.receiptNumber);

    // Re-recording the SAME month (member tops up the payment) must keep the
    // receipt number that may already be printed / sent on WhatsApp.
    const topped = subscriptions.applyPayment(pending!.id, { amountPaid: pending!.amount, paymentDate: "2026-08-21", paymentMethod: "Cash" });
    expect(topped.receiptNumber).toBe(paid.receiptNumber);

    const ledger = getDB()
      .prepare("SELECT receipt_number FROM subscription_payments WHERE subscription_id = ? AND period_start = ? LIMIT 1")
      .get(pending!.id, pending!.period_start) as { receipt_number: string };
    expect(ledger.receipt_number).toBe(paid.receiptNumber);
  });

  it("numbers certificates MAHALLU/CODE/yy/MM/NNN — the mahallu letters lead every certificate", () => {
    // Certificates are append-only (delete triggers guard the register), so
    // the issued rows are verified in place — the test database is a
    // throwaway per-process copy. Fresh DBs are empty: create the register
    // rows the certificates certify against and use THEIR numbers.
    const deathNumber = ensureDeathRecord();
    const { memberId, memberCode } = (() => {
      const m = ensureFamilyWithHead();
      const row = getDB().prepare("SELECT member_code FROM members WHERE id = ?").get(m.memberId) as { member_code: string };
      return { memberId: m.memberId, memberCode: row.member_code };
    })();
    const death = certificates.issueDeath(deathNumber, 1);
    expect(death.certificateNumber).toMatch(/^MMJM\/DT\/\d{2}\/\d{2}\/\d{3}$/);
    const deathRow = getDB().prepare("SELECT certificate_number, type FROM certificates WHERE id = ?").get(death.id) as { certificate_number: string; type: string };
    expect(deathRow.certificate_number).toBe(death.certificateNumber);
    expect(deathRow.type).toBe("Death");

    const member = certificates.issueMembership(memberCode, 1);
    expect(member.certificateNumber).toMatch(/^MMJM\/MB\/\d{2}\/\d{2}\/\d{3}$/);
    const memberRow = getDB().prepare("SELECT certificate_number, type FROM certificates WHERE id = ?").get(member.id) as { certificate_number: string; type: string };
    expect(memberRow.certificate_number).toBe(member.certificateNumber);
    expect(memberRow.type).toBe("Membership");

    // Every certificate type has its own series AND carries the mahallu's
    // letters (MMJM here), so numbers never collide across kinds — or across
    // mahallus using the app.
    const dt = nextCertificateNumber("Death", "2026-09-01");
    const mb = nextCertificateNumber("Membership", "2026-09-01");
    const noc = nextCertificateNumber("NOC", "2026-09-01");
    expect(new Set([dt, mb, noc]).size).toBe(3);
    expect(dt).toMatch(/^MMJM\/DT\/26\/09\/\d{3}$/);
    expect(mb).toMatch(/^MMJM\/MB\/26\/09\/\d{3}$/);
    expect(noc).toMatch(/^MMJM\/NOC\/26\/09\/\d{3}$/);
  });

  it("backfills a number on first generation for legacy blank rows, never renumbering issued ones", () => {
    const db = getDB();
    const cat = db.prepare("SELECT id FROM donation_categories ORDER BY id LIMIT 1").get() as { id: number };
    const info = db
      .prepare("INSERT INTO donations (donor_name, donor_phone, donor_address, family_id, member_id, category_id, amount, donation_date, receipt_number, purpose, payment_method, transaction_ref, received_by, remarks) VALUES ('Legacy Blank', '', '', NULL, NULL, ?, 100, '2026-09-05', '', '', 'Cash', '', 1, '')")
      .run(cat.id);
    const legacyId = Number(info.lastInsertRowid);
    try {
      const issued = ensureDonationReceiptNumber(legacyId, "2026-09-05");
      expect(issued).toMatch(NUM);
      // Second generation returns the SAME number — issued numbers are final.
      expect(ensureDonationReceiptNumber(legacyId, "2026-09-05")).toBe(issued);
      const row = db.prepare("SELECT receipt_number FROM donations WHERE id = ?").get(legacyId) as { receipt_number: string };
      expect(row.receipt_number).toBe(issued);
    } finally {
      donations.remove(legacyId);
    }
  });
});
