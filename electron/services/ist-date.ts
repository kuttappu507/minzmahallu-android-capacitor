/*
 * Indian Standard Time date helpers — MMS is used in India ONLY, so every
 * calendar date is fixed to Asia/Kolkata regardless of the machine's
 * timezone. Never UTC (`toISOString()`), never machine-local
 * (`getTimezoneOffset()`) — both shift the date by a day for a machine on
 * UTC or another zone between 00:00–05:30 IST.
 * Pure functions, no DB/Electron imports — unit-testable.
 */

function istParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** Format a Date as yyyy-mm-dd in Indian Standard Time. */
export function istDateStr(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today's date (yyyy-mm-dd) in Indian Standard Time. */
export function todayIST(): string {
  return istDateStr(new Date());
}

/** Full date-time "yyyy-mm-dd HH:MM" in Indian Standard Time. */
export function istDateTimeStr(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

/** Full date-time "dd-mm-yyyy HH:MM" in Indian Standard Time — the app's
 * display convention (dd-mm-yyyy everywhere the user reads a date). */
export function istDateTimeDm(d: Date): string {
  const iso = istDateTimeStr(d);
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)} ${iso.slice(11)}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Human month label ("September 2026") from a yyyy-mm or yyyy-mm-dd value. */
export function monthLabel(value: string | null | undefined): string {
  const m = String(value || "").match(/^(\d{4})-(\d{2})/);
  if (!m) return String(value || "");
  const idx = Number(m[2]) - 1;
  return `${MONTH_NAMES[idx] ?? m[2]} ${m[1]}`;
}

/** Format a STORED date (yyyy-mm-dd, or yyyy-mm-dd with a time suffix) as
 * dd-mm-yyyy for display. Anything unparseable passes through unchanged. */
export function fmtDdMmYyyy(value: string | null | undefined): string {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(value);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Current year-month (yyyy-mm) in Indian Standard Time. */
export function istMonth(): string {
  return todayIST().slice(0, 7);
}

/** todayIST() plus N days (pure calendar arithmetic — no timezone involved). */
export function istPlusDays(days: number): string {
  const ymd = todayIST();
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)) + days));
  return d.toISOString().slice(0, 10);
}
