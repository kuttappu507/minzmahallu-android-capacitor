/*
 * Demo-data renumbering — legacy demo numbers (DON-/RCP-/CERT-…, plus the
 * interim four-digit-year scheme) are re-issued in the unified
 * MAHALLU/yy/MM/NNN scheme, only on demo profiles, idempotently.
 * Also covers the startup certificate-code provisioning (ALL profiles).
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { renumberDemoDocuments, provisionCertificateVerificationCodes } from "./demo-renumber.service.js";

function makeDb(demo: number, name = "Minz Mahallu Juma Masjid"): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE settings (id INTEGER PRIMARY KEY, receipt_prefix TEXT, mahallu_name TEXT, demo_data INTEGER DEFAULT 0);
    CREATE TABLE donations (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, donation_date TEXT);
    CREATE TABLE subscription_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, payment_date TEXT);
    CREATE TABLE subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, payment_date TEXT);
    CREATE TABLE certificates (id INTEGER PRIMARY KEY AUTOINCREMENT, certificate_number TEXT, type TEXT, issued_date TEXT, verification_code TEXT);
  `);
  db.prepare("INSERT INTO settings (id, receipt_prefix, mahallu_name, demo_data) VALUES (1, 'RCP', ?, ?)").run(name, demo);
  return db;
}

describe("renumberDemoDocuments", () => {
  it("re-issues legacy demo receipts in ONE date-ordered series per month", () => {
    const db = makeDb(1);
    const ins = db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES (?, ?)");
    ins.run("DON-2026-0001", "2026-08-02");
    ins.run("DON-2026-0005", "2026-08-06");
    ins.run("RCP-2026-0501", "2026-06-04"); // ledger row, earlier month
    const subIns = db.prepare("INSERT INTO subscription_payments (receipt_number, payment_date) VALUES (?, ?)");
    subIns.run("RCP-2026-0601", "2026-07-05");
    subIns.run("RCP-2026-0602", "2026-07-07");

    const out = renumberDemoDocuments(db as any);
    expect(out.receipts).toBe(5);
    const nums = (db.prepare("SELECT receipt_number, donation_date FROM donations ORDER BY donation_date").all() as Array<{ receipt_number: string }>).map((r) => r.receipt_number);
    // June: 001; July: 001, 002; August: 001, 002 — shared series, dates rule.
    expect(nums).toEqual(["MMJM/26/06/001", "MMJM/26/08/001", "MMJM/26/08/002"]);
    const subNums = (db.prepare("SELECT receipt_number FROM subscription_payments ORDER BY payment_date").all() as Array<{ receipt_number: string }>).map((r) => r.receipt_number);
    expect(subNums).toEqual(["MMJM/26/07/001", "MMJM/26/07/002"]);
    db.close();
  });

  it("re-issues legacy certificates per type code", () => {
    const db = makeDb(1);
    const ins = db.prepare("INSERT INTO certificates (certificate_number, type, issued_date) VALUES (?, ?, ?)");
    ins.run("CERT-2025-0004", "Death", "2025-10-08");
    ins.run("CERT-2026-0001", "Membership", "2026-03-01");
    ins.run("CERT-2025-0001", "Membership", "2025-08-15");

    const out = renumberDemoDocuments(db as any);
    expect(out.certificates).toBe(3);
    const rows = db.prepare("SELECT certificate_number, type FROM certificates ORDER BY issued_date").all() as Array<{ certificate_number: string; type: string }>;
    expect(rows.map((r) => r.certificate_number)).toEqual([
      "MMJM/MB/25/08/001", // membership, Aug 2025
      "MMJM/DT/25/10/001", // death, Oct 2025
      "MMJM/MB/26/03/001", // membership, Mar 2026 — own month sequence
    ]);
    db.close();
  });

  it("rebases interim four-digit-year numbers to the two-digit scheme", () => {
    const db = makeDb(1);
    db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES ('MMJM/2026/09/001', '2026-09-01')").run();
    db.prepare("INSERT INTO certificates (certificate_number, type, issued_date) VALUES ('MM/DT/2026/09/004', 'Death', '2026-09-10')").run();

    const out = renumberDemoDocuments(db as any);
    expect(out.receipts).toBe(1);
    expect(out.certificates).toBe(1);
    expect((db.prepare("SELECT receipt_number FROM donations").get() as { receipt_number: string }).receipt_number).toBe("MMJM/26/09/001");
    // The interim number is re-issued with the CURRENT mahallu prefix and
    // per-month sequence — the demo shows today's scheme, whatever issued it.
    expect((db.prepare("SELECT certificate_number FROM certificates").get() as { certificate_number: string }).certificate_number).toBe("MMJM/DT/26/09/001");
    db.close();
  });

  it("leaves manual numbers and the TXN- voucher namespace alone", () => {
    const db = makeDb(1);
    db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES ('BOOK-77', '2026-08-01')").run();
    db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES ('TXN-0001', '2026-08-01')").run();
    const out = renumberDemoDocuments(db as any);
    expect(out.receipts).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS c FROM donations WHERE receipt_number IN ('BOOK-77','TXN-0001')").get() as { c: number }).c).toBe(2);
    db.close();
  });

  it("is idempotent — a second run is a no-op", () => {
    const db = makeDb(1);
    db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES ('DON-2026-0001', '2026-08-02')").run();
    expect(renumberDemoDocuments(db as any).receipts).toBe(1);
    const again = renumberDemoDocuments(db as any);
    expect(again.receipts).toBe(0);
    expect(again.certificates).toBe(0);
    expect((db.prepare("SELECT receipt_number FROM donations").get() as { receipt_number: string }).receipt_number).toBe("MMJM/26/08/001");
    db.close();
  });

  it("never touches a real (non-demo) profile", () => {
    const db = makeDb(0);
    db.prepare("INSERT INTO donations (receipt_number, donation_date) VALUES ('DON-2026-0001', '2026-08-02')").run();
    const out = renumberDemoDocuments(db as any);
    expect(out.receipts).toBe(0);
    expect((db.prepare("SELECT receipt_number FROM donations").get() as { receipt_number: string }).receipt_number).toBe("DON-2026-0001");
    db.close();
  });
});

describe("provisionCertificateVerificationCodes (startup, ALL profiles)", () => {
  it("mints codes for legacy certificates without one — including non-demo profiles", () => {
    const db = makeDb(0); // REAL mahallu profile
    const ins = db.prepare("INSERT INTO certificates (certificate_number, type, issued_date, verification_code) VALUES (?, ?, ?, ?)");
    ins.run("OLD-0001", "Membership", "2024-01-01", null);
    ins.run("OLD-0002", "Residence", "2024-02-01", "");
    ins.run("OLD-0003", "Death", "2026-09-01", "WK4M-8Q7Z-T3HD"); // already coded

    const assigned = provisionCertificateVerificationCodes(db as any);
    expect(assigned).toBe(2);
    const rows = db.prepare("SELECT certificate_number, verification_code FROM certificates ORDER BY id").all() as Array<{ certificate_number: string; verification_code: string }>;
    expect(rows[0].verification_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(rows[1].verification_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(rows[0].verification_code).not.toBe(rows[1].verification_code);
    // Already-coded rows keep their code (issued codes never change).
    expect(rows[2].verification_code).toBe("WK4M-8Q7Z-T3HD");
    db.close();
  });

  it("is idempotent — a second run assigns nothing", () => {
    const db = makeDb(1);
    db.prepare("INSERT INTO certificates (certificate_number, type, issued_date) VALUES ('CERT-2025-0001', 'Membership', '2025-08-15')").run();
    expect(provisionCertificateVerificationCodes(db as any)).toBe(1);
    expect(provisionCertificateVerificationCodes(db as any)).toBe(0);
    db.close();
  });
});
