import { all, one, getDB } from "../../db/connection.js";
import { todayIST } from "../ist-date.js";

// All MMS calendar dates are INDIAN time (Asia/Kolkata) — see ist-date.ts.
// Imported for local use AND re-exported so existing importers keep working.

export function nowDate(): string {
  return todayIST();
}

/** Money-safe 2-decimal rounding — paise dust never accumulates on the
 *  arrears/advance ledger through repeated re-records. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Next register number for official registers (marriages / deaths / welfare).
 *
 * The old scheme was `'PREFIX-' || year || printf('%03d', COUNT(*)+1)` scoped
 * to rows dated in the current year. That breaks in two ways:
 *   1. A record dated outside the current year (e.g. a late-registered 2025
 *      marriage) is invisible to the COUNT, so the NEXT registration reuses /
 *      lags behind a number — the register then shows e.g. numbers up to 009
 *      while the count and the dashboard card correctly say 10 records.
 *   2. Deleting the highest record (deaths) makes the same number reusable.
 * This helper instead takes the MAX trailing number across ALL rows of the
 * table (any prefix format) and adds 1, guaranteeing a strictly increasing,
 * collision-free series. A final existence loop guards mixed-format data.
 */
export function nextRegisterNumber(
  table: string,
  column: string,
  prefix: string,
  opts: { pad?: number; withYear?: boolean } = {}
): string {
  const { pad = 3, withYear = true } = opts;
  const year = new Date().getFullYear();
  const rows = all<{ n: string }>(`SELECT ${column} AS n FROM ${table}`);
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)\s*$/.exec(String(r.n ?? ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const build = (s: number) =>
    withYear ? `${prefix}-${year}-${String(s).padStart(pad, "0")}` : `${prefix}-${String(s).padStart(pad, "0")}`;
  let seq = max + 1;
  // Existence guard: with legacy mixed prefixes (MRG-001, MRG-DEMO-001, …)
  // the suffix max is still correct, but bump until truly unique.
  while (one(`SELECT 1 FROM ${table} WHERE ${column} = ?`, [build(seq)])) {
    seq++;
  }
  return build(seq);
}
