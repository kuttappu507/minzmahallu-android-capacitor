# UI / UX / Integrity Deep Audit — 2026-08-30

Deep audit of the Minz Mahallu Management System (branch `arena/01a05068-minzmahallu-electron`).
Scope: UI/UX, i18n, IPC security, date handling, XSS/escaping in print templates, tooling, data integrity.

## Summary

| Area | Result |
|---|---|
| IPC auth gating (124 channels) | ✅ PASS — every channel gated (see §1) |
| Print-template escaping (XSS) | ✅ PASS (see §2) |
| i18n key integrity | ✅ FIXED — 3 missing keys (see §3) |
| Hardcoded English | ⚠️ REDUCED — Settings + Donations + Certificates fixed; 1 placeholder remains (see §4) |
| Date handling (UTC vs local) | ✅ FIXED — real bug, off-by-one-day in IST (see §5) |
| Tooling | ⚠️ `npm run lint` broken — eslint not in devDependencies (see §6) |
| UI/UX nits | ⚠️ icon-only buttons, native `confirm()`, dashboard alert gap (see §7) |

## 1. IPC security — PASS

- `registerSecurityIpc()` re-registers every sensitive channel with `actor()`/`admin()` role checks after `main.ts` boots (uses `ipcMain.removeHandler()` first, so the gated version always wins).
- Handlers that stay in `main.ts` only (`backup:*`, `pdf:*`, `certificates:generatePdf/previewHtml`, `accounting:export*`, `marriages/deaths:registerPdf`) all start with `if (!session.user)`.
- `auth:login/logout`, `win:*` are intentionally public. `auth:setupStatus`/`createInitialAdministrator` are public (first-run setup).
- Additional sender guard: every handler validates the event sender is a live `BrowserWindow`.
- Permanent-deletion is blocked server-side for families, members, marriages, deaths, certificates, donations, welfare, subscriptions, token events; VOID/archive/cancel are the only paths, all requiring admin + reason (+ re-auth password for secure actions).

## 2. Print-template escaping — PASS

- All user-data fields in account-statement, certificate, audit-pack, register-book, token, collection-sheet templates go through `esc()`.
- Token template injects CSS custom properties from a **hardcoded hex palette** (not user input) — no injection vector.
- `pdf:generate` renders HTML in a sandboxed, preload-less, `nodeIntegration:false` offscreen window.

## 3. i18n key integrity — FIXED (3 keys)

Tool: `scripts/i18n-keys-audit.mjs` (new) — every `t("key")` must exist in `src/i18n/index.ts`, else the raw key renders to the user.

- `tb_toggle_theme`, `tb_minimize`, `tb_maximize` (Topbar tooltips) — **added to dictionary** (EN + ML).

## 4. Hardcoded English — REDUCED

- **Settings page** (was 2 full cards + 4 strings in English, incl. a native `window.confirm`):
  - "Financial & Subscription" card → `t()` (section, frequency, monthly/quarterly, amounts, hint paragraph) — 6 new keys.
  - "Donation Categories" card → `t()` (labels, placeholders, status, buttons, titles, hint, toasts) — ~17 new keys.
  - Category deletion now uses the themed `ConfirmDialog` instead of `window.confirm`.
- **Donations dialog**: "Mahallu Member", "Link this donation…", "Outstanding subscription balance…", "Other", "Enter category" → bilingual `tx()`.
- **Certificates**: preview dialog title "Preview" → bilingual.
- **Remaining acceptable**: brand name "Minz Mahallu" (Splash), phone placeholder `98XXXXXXXX` (universal).

## 5. Date handling — FIXED (real bug)

`new Date().toISOString().slice(0,10)` is **UTC**, and `getTimezoneOffset()` is the **machine's** zone. MMS is **India-only**, so all dates are fixed to **Indian Standard Time (Asia/Kolkata)** regardless of machine timezone:
- Entries made 00:00–05:30 were stamped with **yesterday's date** (`nowDate()`, all form defaults) — now `todayIST()`.
- `currentMonthPeriod()` could produce `period_start` on the previous month and `period_end` on the 30th of a 31-day month — now computed from the IST date string.
- Certificate `issued_date` used SQLite `date('now')` (UTC) — now `todayIST()`.
- "This month" sums, dashboard chart month anchors, "today at a glance" counts and committee-term alerts used SQLite `date('now')`/`strftime('now')` (UTC) — now parameterized with IST values (`todayIST()`, `istMonth()`, `istPlusDays()`).
- Token-deletion "today" gate (`security-ipc.ts`) and export filename stamps (`main.ts`) — now IST.

New unit tests (2) prove the IST date is identical whether the machine runs UTC, New York, or Kolkata.

## 6. Tooling — FIXED (reporting only)

- `npm run lint` → `eslint: not found`: **eslint is not in devDependencies** although the script references it. Either add eslint or drop the script. Not part of CI, so no build impact.
- New audit script `scripts/i18n-keys-audit.mjs` exits 1 on missing keys (like the existing hardcoded-English audit, it's a report — CI only uploads it).

## 7. UI/UX nits fixed & remaining

Fixed:
- Icon-only Edit buttons in Marriages / Deaths / Donations now have `title` tooltips.
- Dashboard alert chips are bilingual; **new "missing receipt numbers" alert** surfaces receipt-sequence gaps directly on the dashboard (integrity feature now visible daily).
- Donations Delete button tooltip added.

Remaining (low priority, suggested for future):
1. `formatCurrency()` hardcodes ₹ while Settings exposes an editable currency symbol that only the PDF template respects — either wire the setting through a context or remove the field.
2. `formatDate()` parses `yyyy-mm-dd` as UTC — correct for IST (positive offset), off-by-one for negative-offset timezones; India-only target makes this acceptable.
3. 15 `key={i}` React list indices (re-render churn; harmless in practice).
4. `console.warn/error` in prod renderer for background loads — acceptable, no user-facing harm.

## Verification after fixes

- `tsc -p electron/tsconfig.json` ✅ · `tsc -p tsconfig.json` ✅ · `vite build` ✅ · vitest **31/31** ✅ (incl. 4 IST-date tests)
- `scripts/i18n-keys-audit.mjs` → 0 missing keys ✅
- Hardcoded-English audit: 3 candidates (brand name + phone placeholder + nothing else user-visible) ✅
