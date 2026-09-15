/*
 * One-time demo-data renumbering.
 *
 * The demo profile ships with legacy-format numbers (DON-2026-0001,
 * RCP-2026-0001, CERT-2025-0001 …) seeded by the demo rebuild migration,
 * and interim builds issued four-digit-year numbers (MMJM/2026/09/001).
 * With the unified two-digit scheme in place the demo data should SHOW that
 * scheme, so every legacy/interim demo number is re-issued at startup:
 *
 *     receipts (donations + subscription ledger + legacy mirror) →
 *         MAHALLU/yy/MM/NNN, one shared series in date order
 *     certificates →
 *         MAHALLU/CODE/yy/MM/NNN, one series per type in date order
 *
 * Safety rules:
 *   · Runs ONLY on the demo profile (settings.demo_data = 1). A real
 *     mahallu's issued numbers are never touched.
 *   · Matches only the demo-era patterns: the legacy DON-YYYY-NNNN /
 *     RCP-YYYY-NNNN / CERT-YYYY-NNNN seeds and the interim four-digit-year
 *     scheme (PREFIX/2026/09/NNN, PREFIX/CODE/2026/09/NNN). Manual numbers
 *     (e.g. BOOK-77) and the internal TXN- voucher namespace are left alone.
 *   · Idempotent: renumbered rows no longer match the legacy patterns, so a
 *     second run is a no-op. A failed run rolls back and never blocks
 *     startup (the next launch retries).
 *   · Fails safe on UNIQUE collisions: a row that would clash with an
 *     existing number keeps its legacy number instead of aborting.
 */
import { CERT_TYPE_CODES, formatDocNumber, mahalluPrefixFor, yearMonthOf } from "./doc-number.service.js";
import { makeVerificationCode } from "./codes.js";

type DB = { prepare(q: string): { get(...a: any[]): any; all(...a: any[]): any[]; run(...a: any[]): any } };

const LEGACY_RECEIPT = /^(DON|RCP)-\d{4}-\d+$/;
const LEGACY_CERT = /^CERT-\d{4}-\d+$/;
/** Interim scheme (issued between the two unified-scheme builds) — a
 *  four-digit year in segment 2 (receipt) or 3 (certificate). */
const INTERIM_RECEIPT = /^[A-Z]{1,5}\/\d{4}\/\d{2}\/\d{3,}$/;
const INTERIM_CERT = /^[A-Z]{1,5}\/[A-Z]{1,3}\/\d{4}\/\d{2}\/\d{3,}$/;
const isLegacyReceipt = (n: string) => LEGACY_RECEIPT.test(n) || INTERIM_RECEIPT.test(n);
const isLegacyCert = (n: string) => LEGACY_CERT.test(n) || INTERIM_CERT.test(n);

interface ReceiptRow { table: string; id: number; date: string; }
interface CertRow { id: number; type: string; date: string; }

/** Renumber legacy demo numbers to the unified scheme. Returns how many
 *  rows were rewritten (0 when not a demo profile or nothing left to do). */
export function renumberDemoDocuments(db: DB): { receipts: number; certificates: number } {
  const flag = (() => {
    try {
      return db.prepare("SELECT demo_data FROM settings WHERE id = 1").get() as { demo_data?: number } | undefined;
    } catch { return undefined; }
  })();
  if (!flag || !Number(flag.demo_data)) return { receipts: 0, certificates: 0 };

  const prefix = mahalluPrefixFor(db as any);
  let receipts = 0;
  let certificates = 0;

  try {
    db.prepare("BEGIN").run();

    // ---- Receipt series (shared: donations + ledger + legacy mirror) ----
    const rows: ReceiptRow[] = [];
    const collect = (table: string, dateExpr: string) => {
      const list = db
        .prepare(`SELECT id, receipt_number AS number, COALESCE(${dateExpr}, '') AS date FROM ${table} WHERE receipt_number IS NOT NULL AND receipt_number != ''`)
        .all() as Array<{ id: number; number: string; date: string }>;
      for (const r of list) {
        if (isLegacyReceipt(String(r.number))) rows.push({ table, id: Number(r.id), date: String(r.date || "") });
      }
    };
    collect("donations", "donation_date");
    collect("subscription_payments", "payment_date");
    collect("subscriptions", "payment_date");
    // Chronological within the shared series; ties stay in insertion order.
    rows.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));

    const taken = new Set<string>(
      (db.prepare("SELECT receipt_number AS n FROM donations WHERE receipt_number IS NOT NULL AND receipt_number != '' UNION SELECT receipt_number FROM subscription_payments WHERE receipt_number IS NOT NULL AND receipt_number != '' UNION SELECT receipt_number FROM subscriptions WHERE receipt_number IS NOT NULL AND receipt_number != ''").all() as Array<{ n: string }>).map((r) => String(r.n))
    );
    const seq = new Map<string, number>();
    for (const r of rows) {
      const { y, m } = yearMonthOf(r.date);
      const key = `${y}/${m}`;
      let n = (seq.get(key) || 0) + 1;
      let number = formatDocNumber(prefix, y, m, n);
      // Never collide with a number someone already holds (e.g. rows the
      // user created after upgrading): advance until free, then track it.
      while (taken.has(number)) { n += 1; number = formatDocNumber(prefix, y, m, n); }
      seq.set(key, n);
      taken.add(number);
      db.prepare(`UPDATE ${r.table} SET receipt_number = ? WHERE id = ?`).run(number, r.id);
      receipts += 1;
    }

    // ---- Certificate series (per type code) ----
    const certs: CertRow[] = (db
      .prepare("SELECT id, type, issued_date, certificate_number FROM certificates WHERE certificate_number IS NOT NULL AND certificate_number != ''")
      .all() as Array<{ id: number; type: string; issued_date: string; certificate_number: string }>)
      .filter((c) => isLegacyCert(String(c.certificate_number)))
      .map((c) => ({ id: Number(c.id), type: String(c.type || ""), date: String(c.issued_date || "") }));
    certs.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));

    const certTaken = new Set<string>(
      (db.prepare("SELECT certificate_number AS n FROM certificates WHERE certificate_number IS NOT NULL AND certificate_number != ''").all() as Array<{ n: string }>).map((r) => String(r.n))
    );
    const certSeq = new Map<string, number>();
    for (const c of certs) {
      const code = CERT_TYPE_CODES[c.type] || "CRT";
      const { y, m } = yearMonthOf(c.date);
      const key = `${code}/${y}/${m}`;
      let n = (certSeq.get(key) || 0) + 1;
      let number = formatDocNumber(`${prefix}/${code}`, y, m, n);
      while (certTaken.has(number)) { n += 1; number = formatDocNumber(`${prefix}/${code}`, y, m, n); }
      certSeq.set(key, n);
      certTaken.add(number);
      db.prepare("UPDATE certificates SET certificate_number = ? WHERE id = ?").run(number, c.id);
      certificates += 1;
    }

    db.prepare("COMMIT").run();
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch { /* already closed */ }
    console.warn("[demo-renumber] skipped:", err instanceof Error ? err.message : String(err));
    return { receipts: 0, certificates: 0 };
  }
  if (receipts || certificates) console.log(`[demo-renumber] re-issued ${receipts} receipt(s) and ${certificates} certificate(s) as ${prefix}/…`);
  return { receipts, certificates };
}

/**
 * Demo profile only: assign verification codes to every seeded money receipt
 * (donations + subscription ledger payments) that is missing one, so the
 * verify box and receipt QRs work immediately on the demo data. Real mahallu
 * rows are untouched — they get a code the moment their first receipt is
 * generated (receipt.service.ts, same lazy pattern as receipt numbers).
 * Idempotent: coded rows are skipped; failures roll back and never block
 * startup. Returns how many codes were assigned.
 */
export function provisionDemoReceiptVerificationCodes(db: DB): number {
  const flag = (() => {
    try {
      return db.prepare("SELECT demo_data FROM settings WHERE id = 1").get() as { demo_data?: number } | undefined;
    } catch { return undefined; }
  })();
  if (!flag || !Number(flag.demo_data)) return 0;

  let assigned = 0;
  for (const table of ["donations", "subscription_payments"]) {
    // Per-table transactions: one table failing (e.g. a column a migration
    // order glitch hasn't added yet) must never roll back the other's codes.
    try {
      db.prepare("BEGIN").run();
      // Only rows that have actually been issued as receipts (they carry a
      // number) get a code — a pending/unpaid row has never been printed.
      const rows = db
        .prepare(`SELECT id FROM ${table} WHERE (verification_code IS NULL OR verification_code = '') AND receipt_number IS NOT NULL AND receipt_number != ''`)
        .all() as Array<{ id: number }>;
      for (const r of rows) {
        db.prepare(`UPDATE ${table} SET verification_code = ? WHERE id = ?`).run(makeVerificationCode(), Number(r.id));
        assigned += 1;
      }
      db.prepare("COMMIT").run();
    } catch (err) {
      try { db.prepare("ROLLBACK").run(); } catch { /* already closed */ }
      console.warn(`[demo-receipt-codes] ${table} skipped:`, err instanceof Error ? err.message : String(err));
    }
  }
  if (assigned) console.log(`[demo-receipt-codes] assigned ${assigned} receipt verification code(s)`);
  return assigned;
}

/**
 * ALL databases (not demo-only): mint a verification code for every existing
 * certificate that is missing one. Certificates issued by builds before the
 * anti-forgery feature carry no code — and a certificate without a code
 * prints with NO verify box and NO QR at all. Runs once at startup:
 * additive, idempotent (coded rows are skipped), and issued codes never
 * change. Returns how many codes were assigned.
 */
export function provisionCertificateVerificationCodes(db: DB): number {
  let assigned = 0;
  try {
    db.prepare("BEGIN").run();
    const rows = db
      .prepare("SELECT id FROM certificates WHERE verification_code IS NULL OR verification_code = ''")
      .all() as Array<{ id: number }>;
    for (const r of rows) {
      db.prepare("UPDATE certificates SET verification_code = ? WHERE id = ?").run(makeVerificationCode(), Number(r.id));
      assigned += 1;
    }
    db.prepare("COMMIT").run();
  } catch (err) {
    try { db.prepare("ROLLBACK").run(); } catch { /* already closed */ }
    console.warn("[cert-codes] skipped:", err instanceof Error ? err.message : String(err));
    return 0;
  }
  if (assigned) console.log(`[cert-codes] assigned ${assigned} certificate verification code(s)`);
  return assigned;
}
