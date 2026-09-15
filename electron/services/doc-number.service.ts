/*
 * Unified document numbering — one short, unique, auditable scheme for every
 * receipt and certificate the mahallu issues:
 *
 *     Receipt:      PREFIX / yy / MM / NNN           e.g.  MMJM/26/09/001
 *     Certificate:  PREFIX / CODE / yy / MM / NNN    e.g.  MMJM/DT/26/09/001
 *
 *   PREFIX  capital letters identifying THE MAHALLU — the "Numbering
 *     Prefix" field in Settings. Blank or the legacy placeholder "RCP"
 *     derives the name's letters: the initial of every word (up to four —
 *     "Minz Mahallu Juma Masjid" → MMJM), or the first three letters when
 *     the name has fewer than three initials ("Noor" → NOO, "Minz
 *     Mahallu" → MIN). Because the mahallu's letters lead EVERY number —
 *     receipts AND certificates — two mahallus running this app can never
 *     issue the same number to two different people. (A manually chosen
 *     prefix may still be 1–5 letters.)
 *   CODE    certificate type only: DT (death), MB (membership), RS
 *     (residence), MR (marriage/Nikah), NOC (no-objection) — keeps
 *     certificate kinds in separate series. Receipts carry a two-letter
 *     series code too, so the two money books never share a number:
 *     DN (donations) and SB (subscriptions) — the mahallu ruled the
 *     donation book and the subscription book are DIFFERENT books, so a
 *     donation receipt and a subscription receipt can never print the
 *     same number.
 *   yy/MM   the document's OWN date in IST — a backdated receipt is numbered
 *     inside its own month. The year prints as TWO digits (26 = 2026) to
 *     keep the number short; the month and the zero-padded sequence keep
 *     the segments unambiguous.
 *   NNN     zero-padded 3-digit sequence restarting each month; it simply
 *     grows to 4+ digits past 999 without renumbering anything.
 *
 * Numbers are allocated by scanning the live rows (no counter table), so a
 * deleted row never causes a duplicate and a restored backup keeps working.
 * better-sqlite3 serves one synchronous connection, so read-max → INSERT is
 * atomic within the app process.
 *
 * Records created before this scheme keep their legacy numbers (issued
 * receipts are never renumbered); a legacy row whose number is blank gets
 * one the first time its receipt is generated, printed or sent
 * (ensureDonationReceiptNumber / ensureSubscriptionReceiptNumber).
 */
import { getDB } from "../db/connection.js";
import { todayIST } from "./ist-date.js";

/** Certificate type → number code. Death certificates use "DT" per the
 *  mahallu's request; every other type gets its own short code. The code
 *  rides AFTER the mahallu prefix (MM/DT/…), never instead of it. */
export const CERT_TYPE_CODES: Record<string, string> = {
  Death: "DT",
  Membership: "MB",
  Residence: "RS",
  Marriage: "MR",
  NOC: "NOC",
};

/** Receipt series codes — donations and subscriptions are DIFFERENT money
 *  books (the mahallu's rule), so each gets its own code AND its own
 *  per-month sequence. A donation receipt (MMJM/DN/26/09/001) can never
 *  collide with a subscription receipt (MMJM/SB/26/09/001). */
export type ReceiptKind = "donation" | "subscription";
export const RECEIPT_SERIES: Record<ReceiptKind, string> = {
  donation: "DN",
  subscription: "SB",
};

/** A–Z only, at most 5 letters — safe for SQL LIKE (no wildcards) and for
 *  file names after fileNameSafe(). Non-Latin input (e.g. Malayalam) yields
 *  the fallback, since receipt numbers print in Latin digits/letters. */
export function sanitizePrefix(raw: string | null | undefined, fallback: string): string {
  const letters = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters ? letters.slice(0, 5) : fallback;
}

/** The name's letters — the initial of every word (up to four letters:
 *  "Minz Mahallu Juma Masjid" → MMJM, "Kunnoth P O" → KPO), or the first
 *  three letters of the name when it yields fewer than three initials
 *  ("Noor" → NOO, "Minz Mahallu" → MIN). Malayalam-only names yield ""
 *  (the caller then falls back to a generic prefix). */
export function mahalluInitials(name: string | null | undefined): string {
  const upper = String(name || "").toUpperCase();
  const words = upper
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const initials = words.slice(0, 4).map((w) => w[0]).join("");
  if (initials.length >= 3) return initials;
  return upper.replace(/[^A-Z]/g, "").slice(0, 3);
}

/** yy (2-digit) + mm from a stored date (yyyy-mm-dd…); unparseable/empty
 *  values fall back to today in IST so a number is always emitted. The
 *  year prints as its last two digits ("2026" → "26"). */
export function yearMonthOf(dateStr: string | null | undefined): { y: string; m: string } {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})/);
  if (match) return { y: match[1].slice(2), m: match[2] };
  const today = todayIST();
  return { y: today.slice(2, 4), m: today.slice(5, 7) };
}

/** Any year form → its two trailing digits ("2026" → "26", "26" → "26"). */
const yy = (y: string) => String(y).slice(-2);

/** Highest sequence already used with `prefix/yy/mm/` among `numbers`.
 *  Legacy formats (DON-003, RCP-0001) and the old four-digit-year scheme
 *  (MM/2026/09/001) never match the two-digit head, so old data can never
 *  collide with or inflate the new series. */
export function maxSeriesUsed(numbers: string[], prefix: string, y: string, m: string): number {
  const head = `${prefix}/${yy(y)}/${m}/`;
  let max = 0;
  for (const n of numbers) {
    if (!n || !String(n).startsWith(head)) continue;
    const tail = Number(String(n).slice(head.length));
    if (Number.isFinite(tail) && tail > max) max = tail;
  }
  return max;
}

export function formatDocNumber(prefix: string, y: string, m: string, n: number): string {
  return `${prefix}/${yy(y)}/${m}/${String(n).padStart(3, "0")}`;
}

/** Receipt numbers contain "/" — make them file-name safe for saved PDFs and
 *  WhatsApp document names (MMJM/26/09/001 → MMJM-26-09-001). */
export function fileNameSafe(n: string | number): string {
  return String(n).replace(/[^A-Za-z0-9._-]/g, "-");
}

// ---------------------------------------------------------------------------
// DB-backed allocation
// ---------------------------------------------------------------------------
function columnValues(table: string, column: string): string[] {
  try {
    return (getDB()
      .prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`)
      .all() as Array<{ v: string }>).map((r) => String(r.v));
  } catch {
    return []; // table/column missing on a very old database — treat as empty
  }
}

/** The mahallu's own letters — lead EVERY receipt AND certificate number.
 *  Reads the "Numbering Prefix" setting; blank or legacy "RCP" falls back
 *  to three letters derived from the mahallu name. Works on any DB handle
 *  (the app connection or a fresh migration run) — no getDB() dependency. */
export function mahalluPrefixFor(db: { prepare(q: string): { get(...a: any[]): any } }): string {
  try {
    const row = db.prepare("SELECT receipt_prefix, mahallu_name FROM settings WHERE id = 1").get() as
      | { receipt_prefix?: string; mahallu_name?: string }
      | undefined;
    const stored = String(row?.receipt_prefix || "").trim().toUpperCase();
    // "RCP" is the legacy placeholder default shipped before this scheme —
    // treat it as "not chosen yet" and use the mahallu's own letters.
    if (stored && stored !== "RCP") return sanitizePrefix(stored, "RC");
    const initials = sanitizePrefix(mahalluInitials(row?.mahallu_name), "");
    if (initials) return initials;
  } catch {
    /* settings unavailable (odd DB orders) — generic prefix */
  }
  return "RC";
}

function mahalluPrefix(): string {
  return mahalluPrefixFor(getDB());
}

/** Next receipt number for a document dated `dateStr`. Donations and
 *  subscription payments are SEPARATE series (code DN vs SB — different
 *  money books), each scanning only its own tables so a series can never
 *  produce a duplicate or leak across books. Legacy rows numbered under
 *  the old shared scheme (bare PREFIX/yy/mm/NNN) match neither new head —
 *  their issued numbers stay final and never inflate the new series. */
export function nextReceiptNumber(dateStr: string | null | undefined, kind: ReceiptKind): string {
  const { y, m } = yearMonthOf(dateStr);
  const code = RECEIPT_SERIES[kind] || "DN";
  const prefix = `${mahalluPrefix()}/${code}`;
  const used = kind === "subscription"
    ? [
        ...columnValues("subscription_payments", "receipt_number"),
        ...columnValues("subscriptions", "receipt_number"),
      ]
    : columnValues("donations", "receipt_number");
  return formatDocNumber(prefix, y, m, maxSeriesUsed(used, prefix, y, m) + 1);
}

/** Next certificate number — MAHALLU/CODE/YYYY/MM/NNN. The mahallu's own
 *  letters lead the number (same letters the receipts carry), so mahallus
 *  using this app never issue duplicate certificate numbers; the type code
 *  after the prefix keeps certificate kinds in separate series. */
export function nextCertificateNumber(type: string, dateStr?: string | null): string {
  const { y, m } = yearMonthOf(dateStr);
  const prefix = `${mahalluPrefix()}/${CERT_TYPE_CODES[type] || "CRT"}`;
  const used = columnValues("certificates", "certificate_number");
  return formatDocNumber(prefix, y, m, maxSeriesUsed(used, prefix, y, m) + 1);
}

// ---------------------------------------------------------------------------
// Backfill — legacy rows with a blank number get one the moment their
// receipt is generated / printed / sent (a receipt leaving the app must
// always carry a number). Issued numbers are never changed.
// ---------------------------------------------------------------------------
export function ensureDonationReceiptNumber(donationId: number, dateStr?: string | null): string {
  const row = getDB().prepare("SELECT receipt_number FROM donations WHERE id = ?").get(donationId) as
    | { receipt_number?: string }
    | undefined;
  const current = String(row?.receipt_number || "").trim();
  if (current) return current;
  const number = nextReceiptNumber(dateStr, "donation");
  getDB().prepare("UPDATE donations SET receipt_number = ? WHERE id = ?").run(number, donationId);
  return number;
}

/** Backfill a subscription-side row (ledger payment, or the legacy
 *  subscription mirror for accounts whose payment predates the ledger). */
export function ensureSubscriptionReceiptNumber(
  source: { table: "subscription_payments" | "subscriptions"; id: number; receiptNumber: string | null },
  dateStr?: string | null
): string {
  const current = String(source.receiptNumber || "").trim();
  if (current) return current;
  const number = nextReceiptNumber(dateStr, "subscription");
  getDB().prepare(`UPDATE ${source.table} SET receipt_number = ? WHERE id = ?`).run(number, source.id);
  return number;
}
