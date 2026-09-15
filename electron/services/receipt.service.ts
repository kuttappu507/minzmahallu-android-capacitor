/*
 * Receipt service — A6 receipts for donations and subscription payments.
 *
 * One A6 receipt design (print/receipt.template.ts) serves three outputs:
 *   - a PDF copy stored IN THE APP (SQLite BLOB → travels with backups),
 *   - the same PDF sent to the member/donor on WhatsApp,
 *   - admin PDF export: one A6 receipt, or one A4 PDF holding 4 receipts
 *     per sheet (with cut guides) for bulk runs. Every receipt leaving the
 *     app is a PDF file — no direct-to-printer dialogs (the admin prints
 *     the saved PDF from any viewer, which also keeps an archival copy).
 *
 * Electron APIs (BrowserWindow, dialog) are resolved lazily so importing this
 * module from plain Node (vitest) stays side-effect free.
 */
import { createRequire } from "node:module";
import { getDB } from "../db/connection.js";
import { renderHtmlToPdf } from "../print/pdf-renderer.js";
import { buildReceiptHtml, buildReceiptSheetHtml, type ReceiptData } from "../print/receipt.template.js";
import { fmtDdMmYyyy, monthLabel } from "./ist-date.js";
import { ensureDonationReceiptNumber, ensureSubscriptionReceiptNumber, fileNameSafe } from "./doc-number.service.js";
import { makeVerificationCode } from "./codes.js";

const require = createRequire(import.meta.url);
function electron(): typeof import("electron") {
  return require("electron");
}

const FAMILY_PHONE_SQL = `COALESCE(NULLIF(TRIM(f.whatsapp_phone), ''), NULLIF(TRIM(f.phone), ''))`;

/** Money-safe 2-decimal rounding (mirrors data.service's helper). */
function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

let schemaReady = false;

/** Idempotent receipt columns on both money tables. */
export function ensureReceiptSchema(): void {
  if (schemaReady) return;
  const db = getDB();
  const add = (table: string, name: string, definition: string) => {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name));
    if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  for (const table of ["donations", "subscription_payments", "subscriptions"]) {
    add(table, "receipt_pdf", "BLOB");
    add(table, "receipt_generated_at", "TEXT");
    add(table, "receipt_sent_at", "TEXT");
    add(table, "verification_code", "TEXT");
    // V037 send-lock columns (privacy): delivery timestamp, the one admin
    // re-send counter, and the message-id for late delivery receipts. The
    // `subscriptions` mirror gets the inert columns only — its live state is
    // the current month's ledger row (see the list JOIN).
    add(table, "receipt_delivered_at", "TEXT");
    add(table, "receipt_resends", "INTEGER NOT NULL DEFAULT 0");
    add(table, "whatsapp_msg_id", "TEXT");
  }
  schemaReady = true;
}

// ---------------------------------------------------------------------------
// Verification codes — anti-forgery register codes for receipts, backfilled
// the moment a receipt leaves the app (PDF/WhatsApp), exactly like receipt
// numbers. Issued codes never change.
// ---------------------------------------------------------------------------
export function ensureDonationVerificationCode(donationId: number): string {
  const row = getDB().prepare("SELECT verification_code FROM donations WHERE id = ?").get(donationId) as
    | { verification_code?: string }
    | undefined;
  const current = String(row?.verification_code || "").trim();
  if (current) return current;
  const code = makeVerificationCode();
  getDB().prepare("UPDATE donations SET verification_code = ? WHERE id = ?").run(code, donationId);
  return code;
}

/** Backfill a receipt code on the ledger payment (or legacy subscription
 *  mirror) row that backs this receipt. */
export function ensureSubscriptionVerificationCode(
  source: { table: "subscription_payments" | "subscriptions"; id: number },
  existing?: string | null
): string {
  const current = String(existing || "").trim();
  if (current) return current;
  const code = makeVerificationCode();
  getDB().prepare(`UPDATE ${source.table} SET verification_code = ? WHERE id = ?`).run(code, source.id);
  return code;
}

function langPref(): "en" | "ml" {
  try {
    const row = getDB().prepare("SELECT language FROM settings WHERE id = 1").get() as { language?: string } | undefined;
    return row?.language === "ml" ? "ml" : "en";
  } catch {
    return "en";
  }
}

function mahalluName(): string {
  try {
    const row = getDB().prepare("SELECT mahallu_name FROM settings WHERE id = 1").get() as { mahallu_name?: string } | undefined;
    return String(row?.mahallu_name || "").trim() || "MAHALLU";
  } catch {
    return "MAHALLU";
  }
}

/** Mahallu address + phone for the receipt header — the same identity block
 *  the certificate header prints (name on top, address · phone underneath). */
function mahalluIdentity(): { address: string; phone: string } {
  try {
    const row = getDB().prepare("SELECT address, phone FROM settings WHERE id = 1").get() as { address?: string; phone?: string } | undefined;
    return { address: String(row?.address || "").trim(), phone: String(row?.phone || "").trim() };
  } catch {
    return { address: "", phone: "" };
  }
}

/** Currency symbol from Settings — printed receipts follow the configured
 *  symbol so the whole office output stays consistent. */
function currencySymbol(): string {
  try {
    const row = getDB().prepare("SELECT currency_symbol FROM settings WHERE id = 1").get() as { currency_symbol?: string } | undefined;
    return String(row?.currency_symbol || "").trim() || "\u20B9";
  } catch {
    return "\u20B9";
  }
}

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

async function donationReceiptData(donationId: number): Promise<ReceiptData | null> {
  const d = getDB().prepare(
    `SELECT d.*, c.name AS category_name FROM donations d LEFT JOIN donation_categories c ON c.id = d.category_id WHERE d.id = ?`
  ).get(donationId) as any;
  if (!d) return null;
  const ml = langPref() === "ml";
  // Legacy rows recorded before the numbering scheme get a number the
  // moment their receipt is generated — a receipt leaving the app (PDF,
  // print, WhatsApp) must always carry one. Issued numbers never change.
  const receiptNumber = ensureDonationReceiptNumber(donationId, String(d.donation_date || ""));
  // Same for the register SECURITY CODE printed in the footer.
  const verificationCode = ensureDonationVerificationCode(donationId);
  const identity = mahalluIdentity();
  return {
    kind: "DONATION",
    receiptNumber,
    date: fmtDdMmYyyy(String(d.donation_date || "")),
    payerName: String(d.donor_name || "—"),
    payerDetail: String(d.donor_phone || ""),
    line1Label: ml ? "വിഭാഗം" : "Category",
    line1Value: String(d.category_name || "Donation"),
    line2Label: ml ? "ആവശ്യം" : "Purpose",
    line2Value: String(d.purpose || ""),
    amount: Number(d.amount || 0),
    paymentMethod: String(d.payment_method || ""),
    transactionRef: String(d.transaction_ref || ""),
    notes: String(d.remarks || ""),
    mahalluName: mahalluName(),
    mahalluAddress: identity.address,
    mahalluPhone: identity.phone,
    currencySymbol: currencySymbol(),
    verificationCode,
  };
}

/** The most recent ACTIVE payment on a subscription (ledger first, then the
 * subscription row for accounts whose first payment predates the ledger). */
function subscriptionPaymentRow(subscriptionId: number): any | null {
  const db = getDB();
  const paid = db.prepare(
    `SELECT sp.*, f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = sp.member_id) AS member_name
     FROM subscription_payments sp LEFT JOIN families f ON f.id = sp.family_id
     WHERE sp.subscription_id = ? AND sp.status = 'Active' AND sp.amount > 0
     ORDER BY sp.period_start DESC, sp.id DESC LIMIT 1`
  ).get(subscriptionId) as any;
  if (paid) return { source: "ledger", row: paid };
  const s = db.prepare(
    `SELECT s.*, f.house_name, f.family_number,
       (SELECT m.name FROM members m WHERE m.id = s.member_id) AS member_name
     FROM subscriptions s LEFT JOIN families f ON f.id = s.family_id WHERE s.id = ?`
  ).get(subscriptionId) as any;
  if (s && Number(s.amount_paid || 0) > 0) return { source: "subscription", row: s };
  return null;
}

async function subscriptionReceiptData(subscriptionId: number): Promise<ReceiptData | null> {
  const resolved = subscriptionPaymentRow(subscriptionId);
  if (!resolved) return null;
  const r = resolved.row;
  const ml = langPref() === "ml";
  // Account-level truth (rate + post-allocation arrears/advance) — the
  // receipt states where the cash went and what is still due AFTER it.
  const sub = getDB()
    .prepare("SELECT amount, amount_paid, arrears, advance FROM subscriptions WHERE id = ?")
    .get(subscriptionId) as { amount?: number; amount_paid?: number; arrears?: number; advance?: number } | undefined;
  const rate = Number(sub?.amount ?? r.amount ?? 0);
  const cash = resolved.source === "ledger" ? Number(r.amount || 0) : Number(r.amount_paid ?? 0);
  const arrearsCleared = Number(r.arrears_cleared || 0);
  const advanceAdded = Number(r.advance_added || 0);
  const monthPart = Math.max(0, Math.min(round2(cash - arrearsCleared), rate));
  const arrearsAfter = Number(sub?.arrears || 0);
  const advanceAfter = Number(sub?.advance || 0);
  const dueAfter = Math.max(0, round2(arrearsAfter + Math.max(0, rate - Number(sub?.amount_paid ?? 0)) - advanceAfter));
  // Blank legacy numbers are backfilled on first generation (never renumbered).
  const receiptNumber = ensureSubscriptionReceiptNumber(
    { table: resolved.source === "ledger" ? "subscription_payments" : "subscriptions", id: Number(r.id), receiptNumber: r.receipt_number },
    String(r.payment_date || r.period_start || "")
  );
  const verificationCode = ensureSubscriptionVerificationCode(
    { table: resolved.source === "ledger" ? "subscription_payments" : "subscriptions", id: Number(r.id) },
    r.verification_code
  );
  const dateStr = String(r.payment_date || r.period_start || "");
  // ---- Receipt footnote: the money story on one line (or two short ones) ----
  const inr = (n: number) => `${currencySymbol()}${n.toLocaleString("en-IN")}`;
  const appliedBits: string[] = [];
  if (arrearsCleared > 0) appliedBits.push(ml ? `${inr(arrearsCleared)} പഴയ മാസങ്ങൾ` : `${inr(arrearsCleared)} previous months`);
  if (monthPart > 0) appliedBits.push(ml ? `${inr(monthPart)} ഈ മാസം` : `${inr(monthPart)} this month`);
  if (advanceAdded > 0) appliedBits.push(ml ? `${inr(advanceAdded)} അഡ്വാൻസ്` : `${inr(advanceAdded)} advance`);
  const appliedNote = appliedBits.length
    ? (ml ? "തുക വിഭജനം: " : "Amount applied: ") + appliedBits.join(" · ")
    : "";
  const balanceNote = dueAfter > 0
    ? (ml
        ? `ബാക്കി: ${inr(dueAfter)}${arrearsAfter > 0 ? " (പഴയ മാസങ്ങൾ ഉൾപ്പെടെ)" : ""}`
        : `Balance due: ${inr(dueAfter)}${arrearsAfter > 0 ? " (incl. previous months)" : ""}`)
    : advanceAfter > 0
      ? (ml
          ? `പൂർണമായി അടച്ചു — ${inr(advanceAfter)} അഡ്വാൻസ് അടുത്ത മാസം കുറയ്ക്കും`
          : `Fully paid — ${inr(advanceAfter)} advance reduces next month's due`)
      : (ml ? "ഈ മാസത്തെ വരിസംഖ്യ പൂർണമായി അടയ്ക്കപ്പെട്ടു" : "This month's subscription is fully paid");
  const footNote = appliedNote ? `${appliedNote}. ${balanceNote}` : balanceNote;
  const identity = mahalluIdentity();
  return {
    kind: "SUBSCRIPTION",
    receiptNumber,
    date: fmtDdMmYyyy(dateStr),
    payerName: String(r.member_name || r.house_name || r.family_number || "—"),
    payerDetail: String(r.family_number ? `${r.house_name ? r.house_name + " · " : ""}${r.family_number}` : ""),
    line1Label: ml ? "മാസം" : "Month",
    line1Value: monthLabel(String(r.period_start || "")),
    line2Label: ml ? "പ്രതിമാസ വരിസംഖ്യ" : "Monthly due",
    line2Value: inr(rate),
    amount: cash,
    paymentMethod: String(r.payment_method || ""),
    transactionRef: String(r.transaction_ref || ""),
    notes: String(r.remarks || ""),
    mahalluName: mahalluName(),
    mahalluAddress: identity.address,
    mahalluPhone: identity.phone,
    currencySymbol: currencySymbol(),
    verificationCode,
    footNote,
  };
}

// ---------------------------------------------------------------------------
// PDF generation (fresh render each time so edited records never ship a
// stale receipt) + BLOB persistence in the app database.
// ---------------------------------------------------------------------------
async function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const html = buildReceiptHtml(data, langPref());
  // A6 at 96dpi ≈ 397×559px.
  return renderHtmlToPdf(html, { width: 397, height: 559 });
}

export interface GeneratedReceipt {
  buffer: Buffer;
  receiptNumber: string;
  generatedAt: string;
  source: "ledger" | "subscription" | null;
  paymentId: number | null;
}

export async function generateDonationReceiptPdf(donationId: number): Promise<GeneratedReceipt> {
  ensureReceiptSchema();
  const data = await donationReceiptData(donationId);
  if (!data) throw new Error("Donation record not found. Refresh the donations page and try again.");
  const buffer = await renderReceiptPdf(data);
  const generatedAt = new Date().toISOString();
  getDB().prepare("UPDATE donations SET receipt_pdf = ?, receipt_generated_at = ? WHERE id = ?").run(buffer, generatedAt, donationId);
  return { buffer, receiptNumber: data.receiptNumber, generatedAt, source: null, paymentId: null };
}

export async function generateSubscriptionReceiptPdf(subscriptionId: number): Promise<GeneratedReceipt> {
  ensureReceiptSchema();
  const data = await subscriptionReceiptData(subscriptionId);
  if (!data) throw new Error("No payment recorded for this subscription yet.");
  const buffer = await renderReceiptPdf(data);
  const resolved = subscriptionPaymentRow(subscriptionId);
  const generatedAt = new Date().toISOString();
  if (resolved?.source === "ledger") {
    getDB().prepare("UPDATE subscription_payments SET receipt_pdf = ?, receipt_generated_at = ? WHERE id = ?").run(buffer, generatedAt, resolved.row.id);
  }
  return {
    buffer,
    receiptNumber: data.receiptNumber,
    generatedAt,
    source: resolved?.source ?? null,
    paymentId: resolved?.source === "ledger" ? Number(resolved.row.id) : null,
  };
}

// ---------------------------------------------------------------------------
// WhatsApp send-lock (privacy, V037) — a receipt may leave the app ONCE.
//
//   · receipt_sent_at      the WhatsApp server ACCEPTED the message (a send
//                          attempt that failed offline never sets this).
//   · receipt_delivered_at the recipient's phone CONFIRMED receiving it
//                          (WhatsApp delivery receipt). ONLY this locks the
//                          button — "server took it" is not "they got it".
//   · receipt_resends      how many of the ONE admin-authorized re-sends was
//                          used (0 → available, 1 → exhausted, forever).
//   · whatsapp_msg_id      maps a LATE delivery receipt back to this row.
//
// Rules (enforced in whatsapp.service.ts before any send):
//   1. Not delivered yet → the send button stays open (a receipt the family
//      never received can be sent at ANY time — one message per click).
//   2. Delivered → locked, the UI says "Already sent to recipient".
//   3. Delivered + administrator password → exactly ONE re-send, ever.
// ---------------------------------------------------------------------------
export interface ReceiptSendState {
  sent: boolean;
  sentAt: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  resends: number;
  msgId: string | null;
}

function receiptRow(kind: "donation" | "subscription", id: number): any | null {
  const table = kind === "donation" ? "donations" : "subscription_payments";
  try {
    return getDB()
      .prepare(`SELECT receipt_sent_at, receipt_delivered_at, receipt_resends, whatsapp_msg_id FROM ${table} WHERE id = ?`)
      .get(id) as any;
  } catch {
    return null;
  }
}

/** Send-lock state of one receipt. `id` is the donation id, or the
 *  subscription LEDGER payment id (the row that owns this month's receipt). */
export function receiptSendState(kind: "donation" | "subscription", id: number): ReceiptSendState {
  ensureReceiptSchema();
  const r = receiptRow(kind, id);
  return {
    sent: !!r?.receipt_sent_at,
    sentAt: r?.receipt_sent_at || null,
    delivered: !!r?.receipt_delivered_at,
    deliveredAt: r?.receipt_delivered_at || null,
    resends: Number(r?.receipt_resends || 0),
    msgId: r?.whatsapp_msg_id || null,
  };
}

/** The WhatsApp server accepted the outgoing copy (message id kept for the
 *  late delivery receipt). Delivery is NOT implied — markReceiptDelivered*()
 *  alone flips the lock. */
export function markReceiptAccepted(kind: "donation" | "subscription", id: number, msgId: string): void {
  ensureReceiptSchema();
  const table = kind === "donation" ? "donations" : "subscription_payments";
  try {
    getDB().prepare(`UPDATE ${table} SET receipt_sent_at = datetime('now'), whatsapp_msg_id = ? WHERE id = ?`).run(msgId, id);
  } catch { /* best effort */ }
}

/** The recipient's phone confirmed the message — the lock moment. */
export function markReceiptDelivered(kind: "donation" | "subscription", id: number): void {
  ensureReceiptSchema();
  const table = kind === "donation" ? "donations" : "subscription_payments";
  try {
    getDB().prepare(`UPDATE ${table} SET receipt_delivered_at = datetime('now') WHERE id = ?`).run(id);
  } catch { /* best effort */ }
}

/** Late delivery (phone came online hours later): map the stored message id
 *  back to whichever receipt row it belongs to. Called from the engine's
 *  delivery listener — must never throw. */
export function markReceiptDeliveredByMsgId(msgId: string): void {
  if (!msgId) return;
  ensureReceiptSchema();
  for (const table of ["donations", "subscription_payments"]) {
    try {
      getDB()
        .prepare(`UPDATE ${table} SET receipt_delivered_at = datetime('now') WHERE whatsapp_msg_id = ? AND receipt_delivered_at IS NULL`)
        .run(msgId);
    } catch { /* best effort */ }
  }
}

/** Spend the ONE admin-authorized re-send. Returns the new count (1). */
export function consumeAdminResend(kind: "donation" | "subscription", id: number): number {
  ensureReceiptSchema();
  const table = kind === "donation" ? "donations" : "subscription_payments";
  const r = receiptRow(kind, id);
  if (Number(r?.receipt_resends || 0) >= 1) {
    throw new Error("The one administrator re-send for this receipt was already used. The receipt stays with the recipient.");
  }
  getDB().prepare(`UPDATE ${table} SET receipt_resends = 1 WHERE id = ?`).run(id);
  return 1;
}


// ---------------------------------------------------------------------------
// IPC-shaped helpers (no dialogs — safe for automated checks)
// ---------------------------------------------------------------------------
export async function getDonationPdf(donationId: number) {
  const r = await generateDonationReceiptPdf(donationId);
  return { success: true, receiptNumber: r.receiptNumber, generatedAt: r.generatedAt, pdfBase64: r.buffer.toString("base64"), sizeBytes: r.buffer.length };
}

export async function getSubscriptionPdf(subscriptionId: number) {
  const r = await generateSubscriptionReceiptPdf(subscriptionId);
  return { success: true, receiptNumber: r.receiptNumber, generatedAt: r.generatedAt, pdfBase64: r.buffer.toString("base64"), sizeBytes: r.buffer.length };
}

// ---------------------------------------------------------------------------
// Save-to-file (dialog) — the receipt output path. Single A6 PDF or one A4
// PDF with 4 receipts per sheet; the file is also kept in the app database.
// ---------------------------------------------------------------------------
function todayStamp(): string { return new Date().toISOString().slice(0, 10); }

async function savePdfWithDialog(opts: {
  title: string; defaultPath: string; buffer: Buffer; win: import("electron").BrowserWindow | null;
}): Promise<{ success: boolean; cancelled?: boolean; path?: string }> {
  const { dialog } = electron();
  const save = await dialog.showSaveDialog(opts.win!, {
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (save.canceled || !save.filePath) return { success: false, cancelled: true };
  const fs = await import("node:fs");
  fs.writeFileSync(save.filePath, opts.buffer);
  return { success: true, path: save.filePath };
}

export async function saveDonationPdf(donationId: number, win: import("electron").BrowserWindow | null) {
  const r = await generateDonationReceiptPdf(donationId);
  return savePdfWithDialog({
    title: "Save Donation Receipt (A6)",
    defaultPath: `receipt-${fileNameSafe(r.receiptNumber || donationId)}.pdf`,
    buffer: r.buffer, win,
  });
}

export async function saveSubscriptionPdf(subscriptionId: number, win: import("electron").BrowserWindow | null) {
  const r = await generateSubscriptionReceiptPdf(subscriptionId);
  return savePdfWithDialog({
    title: "Save Subscription Receipt (A6)",
    defaultPath: `receipt-${fileNameSafe(r.receiptNumber || subscriptionId)}.pdf`,
    buffer: r.buffer, win,
  });
}

/** MANY donation receipts as ONE A4 PDF — 4 per sheet, dashed cut guides. */
export async function saveDonationBatchPdf(donationIds: number[], win: import("electron").BrowserWindow | null) {
  ensureReceiptSchema();
  const list: ReceiptData[] = [];
  const missing: number[] = [];
  for (const id of donationIds) {
    const d = await donationReceiptData(id);
    if (d) list.push(d); else missing.push(id);
  }
  if (!list.length) throw new Error("No donation receipts were found for the current filter.");
  const html = buildReceiptSheetHtml(list, langPref());
  const buffer = await renderHtmlToPdf(html);
  const result = await savePdfWithDialog({
    title: "Save Donation Receipts (4 per A4)",
    defaultPath: `receipts-${todayStamp()}.pdf`,
    buffer, win,
  });
  return { ...result, count: list.length, missing };
}

/** MANY subscription payment receipts as ONE A4 PDF — 4 per sheet. */
export async function saveSubscriptionBatchPdf(subscriptionIds: number[], win: import("electron").BrowserWindow | null) {
  ensureReceiptSchema();
  const list: ReceiptData[] = [];
  const skipped: number[] = [];
  for (const id of subscriptionIds) {
    const d = await subscriptionReceiptData(id);
    if (d) list.push(d); else skipped.push(id);
  }
  if (!list.length) throw new Error("No paid subscriptions were found for the current filter.");
  const html = buildReceiptSheetHtml(list, langPref());
  const buffer = await renderHtmlToPdf(html);
  const result = await savePdfWithDialog({
    title: "Save Subscription Receipts (4 per A4)",
    defaultPath: `receipts-${todayStamp()}.pdf`,
    buffer, win,
  });
  return { ...result, count: list.length, skipped };
}
