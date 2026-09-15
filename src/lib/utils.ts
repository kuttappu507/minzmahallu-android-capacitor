import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Currency symbol store — Settings → Currency Symbol drives EVERY amount in
// the UI. The symbol is set once at app start (from settings.load) and again
// whenever Settings are saved, so formatCurrency() everywhere follows the
// configured value instead of a hardcoded "₹".
let CURRENCY_SYMBOL = "₹";
export function setCurrencySymbol(symbol: string | null | undefined): void {
  const v = String(symbol ?? "").trim();
  if (v) CURRENCY_SYMBOL = v;
}
export function getCurrencySymbol(): string {
  return CURRENCY_SYMBOL;
}
export function formatCurrency(amount: number): string {
  return CURRENCY_SYMBOL + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Today's date (yyyy-mm-dd) in INDIAN time (Asia/Kolkata) — the app is
 * used in India only, so a machine set to another zone must still record the
 * date the office sees. Never UTC, never the machine's local zone. */
export function todayIST(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

export function statusVariant(status: string): "active" | "inactive" | "overdue" | "paid" | "pending" | "partial" {
  const s = status?.toLowerCase() ?? "";
  if (s === "paid" || s === "active" || s === "approved" || s === "disbursed") return "active";
  if (s === "pending") return "pending";
  if (s === "overdue") return "overdue";
  if (s === "partial") return "partial";
  if (s === "inactive" || s === "rejected" || s === "archived") return "inactive";
  return "pending";
}
