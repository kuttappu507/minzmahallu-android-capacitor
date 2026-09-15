/*
 * Receipts for the Android web bridge — mirrors electron/services/receipt.service.ts
 * data assembly 1:1 (donation + subscription A6 receipts), replacing the
 * Electron printToPDF pipeline with the Android system print framework.
 *
 * The receipt NUMBER and verification CODE backfills run exactly as on
 * desktop (doc-number.service + verification codes), so a receipt printed on
 * the phone verifies against the same register as the office PC.
 */
import { getDB } from "../../electron/db/connection.js";
import { buildReceiptHtml, buildReceiptSheetHtml, type ReceiptData } from "../../electron/print/receipt.template.js";
import { fmtDdMmYyyy, monthLabel } from "../../electron/services/ist-date.js";
import { ensureDonationReceiptNumber, ensureSubscriptionReceiptNumber } from "../../electron/services/doc-number.service.js";
import { makeVerificationCode } from "../../electron/services/codes.js";
import { printHtml } from "./print.web";

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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

function mahalluIdentity(): { address: string; phone: string } {
  try {
    const row = getDB().prepare("SELECT address, phone FROM settings WHERE id = 1").get() as { address?: string; phone?: string } | undefined;
    return { address: String(row?.address || "").trim(), phone: String(row?.phone || "").trim() };
  } catch {
    return { address: "", phone: "" };
  }
}

function currencySymbol(): string {
  try {
    const row = getDB().prepare("SELECT currency_symbol FROM settings WHERE id = 1").get() as { currency_symbol?: string } | undefined;
    return String(row?.currency_symbol || "").trim() || "\u20B9";
  } catch {
    return "\u20B9";
  }
}

/** Backfill a receipt register code on a donation (issued codes never change). */
export function ensureDonationVerificationCode(donationId: number): string {
  const row = getDB().prepare("SELECT verification_code FROM donations WHERE id = ?").get(donationId) as { verification_code?: string } | undefined;
  const current = String(row?.verification_code || "").trim();
  if (current) return current;
  const code = makeVerificationCode();
  getDB().prepare("UPDATE donations SET verification_code = ? WHERE id = ?").run(code, donationId);
  return code;
}

/** Backfill a receipt code on the ledger payment (or legacy mirror) row. */
export function ensureSubscriptionVerificationCode(source: { table: "subscription_payments" | "subscriptions"; id: number }, existing?: string | null): string {
  const current = String(existing || "").trim();
  if (current) return current;
  const code = makeVerificationCode();
  getDB().prepare(`UPDATE ${source.table} SET verification_code = ? WHERE id = ?`).run(code, source.id);
  return code;
}

async function donationReceiptData(donationId: number): Promise<ReceiptData | null> {
  const d = getDB().prepare(
    `SELECT d.*, c.name AS category_name FROM donations d LEFT JOIN donation_categories c ON c.id = d.category_id WHERE d.id = ?`
  ).get(donationId) as any;
  if (!d) return null;
  const ml = langPref() === "ml";
  const receiptNumber = ensureDonationReceiptNumber(donationId, String(d.donation_date || ""));
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
  const receiptNumber = ensureSubscriptionReceiptNumber(
    { table: resolved.source === "ledger" ? "subscription_payments" : "subscriptions", id: Number(r.id), receiptNumber: r.receipt_number },
    String(r.payment_date || r.period_start || "")
  );
  const verificationCode = ensureSubscriptionVerificationCode(
    { table: resolved.source === "ledger" ? "subscription_payments" : "subscriptions", id: Number(r.id) },
    r.verification_code
  );
  const dateStr = String(r.payment_date || r.period_start || "");
  const inr = (n: number) => `${currencySymbol()}${n.toLocaleString("en-IN")}`;
  const appliedBits: string[] = [];
  if (arrearsCleared > 0) appliedBits.push(ml ? `${inr(arrearsCleared)} പഴയ മാസങ്ങൾ` : `${inr(arrearsCleared)} previous months`);
  if (monthPart > 0) appliedBits.push(ml ? `${inr(monthPart)} ഈ മാസം` : `${inr(monthPart)} this month`);
  if (advanceAdded > 0) appliedBits.push(ml ? `${inr(advanceAdded)} അഡ്വാൻസ്` : `${inr(advanceAdded)} advance`);
  const appliedNote = appliedBits.length ? (ml ? "തുക വിഭജനം: " : "Amount applied: ") + appliedBits.join(" · ") : "";
  const balanceNote = dueAfter > 0
    ? (ml ? `ബാക്കി: ${inr(dueAfter)}${arrearsAfter > 0 ? " (പഴയ മാസങ്ങൾ ഉൾപ്പെടെ)" : ""}` : `Balance due: ${inr(dueAfter)}${arrearsAfter > 0 ? " (incl. previous months)" : ""}`)
    : advanceAfter > 0
      ? (ml ? `പൂർണമായി അടച്ചു — ${inr(advanceAfter)} അഡ്വാൻസ് അടുത്ത മാസം കുറയ്ക്കും` : `Fully paid — ${inr(advanceAfter)} advance reduces next month's due`)
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

/* ------------------------------------------------------------------ */
/* Public web API                                                      */
/* ------------------------------------------------------------------ */

export async function printDonationReceipt(donationId: number): Promise<{ success: boolean; error?: string; receiptNumber?: string }> {
  const data = await donationReceiptData(donationId);
  if (!data) return { success: false, error: "Donation record not found. Refresh the donations page and try again." };
  printHtml(buildReceiptHtml(data, langPref()), `Receipt ${data.receiptNumber}`);
  return { success: true, receiptNumber: data.receiptNumber };
}

export async function printSubscriptionReceipt(subscriptionId: number): Promise<{ success: boolean; error?: string; receiptNumber?: string }> {
  const data = await subscriptionReceiptData(subscriptionId);
  if (!data) return { success: false, error: "No payment recorded for this subscription yet." };
  printHtml(buildReceiptHtml(data, langPref()), `Receipt ${data.receiptNumber}`);
  return { success: true, receiptNumber: data.receiptNumber };
}

async function batchDonationData(ids: number[]): Promise<ReceiptData[]> {
  const list: ReceiptData[] = [];
  for (const id of ids || []) {
    const d = await donationReceiptData(Number(id));
    if (d) list.push(d);
  }
  return list;
}

async function batchSubscriptionData(ids: number[]): Promise<ReceiptData[]> {
  const list: ReceiptData[] = [];
  for (const id of ids || []) {
    const d = await subscriptionReceiptData(Number(id));
    if (d) list.push(d);
  }
  return list;
}

export async function printDonationBatchReceipts(ids: number[]): Promise<{ success: boolean; error?: string; count?: number }> {
  const list = await batchDonationData(ids);
  if (!list.length) return { success: false, error: "No printable donations found" };
  printHtml(buildReceiptSheetHtml(list, langPref()), "Donation receipts (4 per sheet)");
  return { success: true, count: list.length };
}

export async function printSubscriptionBatchReceipts(ids: number[]): Promise<{ success: boolean; error?: string; count?: number }> {
  const list = await batchSubscriptionData(ids);
  if (!list.length) return { success: false, error: "No printable payments found" };
  printHtml(buildReceiptSheetHtml(list, langPref()), "Subscription receipts (4 per sheet)");
  return { success: true, count: list.length };
}
