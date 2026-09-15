# MMS — Data Integrity, Security & Controls Improvement Plan

*Research-based plan (Aug 2026) for protecting mahallu records against accidental deletion, intentional deletion, forging and mismanagement — while keeping the software simple for everyday users.*

---

## 1. Why this matters — the legal context

The records this app holds are not just convenience data. In Kerala, a mahallu committee typically wears **two or three hats at once**, each with its own legal duties:

| Obligation | Source | What it means for MMS |
|---|---|---|
| **Waqf accounts** | Waqf Act 1995, §46–47 (Kerala State Waqf Board) | Every mutawalli (committee) must keep **regular accounts** and submit an annual statement of accounts to the Board **before 1 May** for the year ending 31 March. Waqfs with net annual income > ₹1 lakh must be **audited annually by a Board-panel auditor**; the audit report is filed (2025 Unified Waqf Management Rules make this an online-portal upload). A **7% Waqf contribution** to the Board is payable (S.77). |
| **Society accounts** | Kerala Societies Registration Act, 2025 (replaced Travancore-Cochin Act 1955) | Registered societies must keep proper books of account, get accounts **audited by an auditor appointed by the general body**, lay balance sheet + Income & Expenditure before the general meeting, have it **signed by two governing-body members**, and **file with the Registrar**. |
| **Marriage register** | Kerala Registration of Marriages (Common) Rules, 2008 + community practice (SMF etc.) | The mahallu **nikah register** is the community's own official record; it supports marriage certificates and NOCs used for civil registration, passports, banks. It must be complete, continuous and tamper-evident. |
| **Electronic evidence** | §65B Indian Evidence Act 1872 / §63 Bharatiya Sakshya Adhiniyam 2023 (*Anvar v. Basheer* 2014; *Arjun Panditrao* 2020) | **Printouts/exports of computer records are admissible as evidence only with a 65B certificate** — a signed statement by the person in responsible charge of the system describing the device and how the records are generated in the regular course. A tamper-evident audit trail materially strengthens that. |

**Bottom line:** MMS should be able to produce, at the click of a button:
1. Annual **Receipts & Payments + Income & Expenditure** statements in the Waqf Board/auditor-friendly format;
2. A **65B-style certificate** page for any exported register/statement;
3. A **tamper-evidence report** (audit-chain verification) an auditor can check.

---

## 2. What already protects data (existing features — good foundation)

| Protection | Where |
|---|---|
| Append-only audit log (`audit_log`) + record history, enforced by **SQLite triggers** (no UPDATE/DELETE) | V008, V010, `connection.ts` |
| **No hard delete** for families, members, marriages, deaths, certificates, welfare, financial records — archive / correct / revoke only | `security-ipc.ts`, triggers |
| Archive/restore with **mandatory reason**, full history, member-move audit (incl. head-demotion rule) | `security.service.ts` |
| PBKDF2-SHA256 (200k) auth, lockout, admin-only user mgmt, role checks on IPC | `auth.service.ts`, `security-ipc.ts` |
| Collision-free register numbers (marriages/deaths/welfare/certificates) | `data.service.ts` |
| Verified SHA-256 backups (`.mmbak`), pre-restore safety backup | `backup.service.ts` |
| Certificate issue → print → revoke lifecycle; welfare approve/reject/disburse workflow | `data.service.ts` |
| PDF rendering of untrusted HTML in a sandboxed window | `main.ts` |

**Critical caveat:** the **backup feature is currently broken at runtime** (un-awaited async `db.backup()` + ESM `require()` — see earlier analysis). A data-protection plan is worthless if the backup fails — **fixing this is P0 item #1.**

---

## 3. The improvement plan

Grouped into 7 pillars. Every item lists **What / Why / Simple version** (how users experience it).

---

### PILLAR A — Financial integrity & voucher workflow (the expense example you raised)

**A1. Mandatory voucher/bill numbers on expenses** *(P0 — your request)*
- **What:** Add `voucher_no`, `bill_no`, `payee`, `approval_status`, `approved_by`, `approved_at` to `transactions`. When a user saves an **Expense**, the app requires (or auto-generates) a **Voucher No.** and asks for **Bill/Invoice No.** — with a friendly "Add photo of the bill" button. Duplicate bill numbers are warned about ("This bill number was already entered on 12-Mar — duplicate?").
- **Why:** Waqf/society audits and S.77 assessments rest on **vouchers**. Every rupee out must trace to a document. Duplicate-bill detection blocks the classic re-submission fraud.
- **Simple version:** The form shows: *Voucher No. (auto-filled, editable), Bill No., Payee, Attach bill (photo/PDF), Description.* Two fields on one form — no new screens. Users who leave bill no. empty get a gentle warning, and the entry is flagged "No bill" in the ledger, visible to the auditor.

**A2. Receipt numbering continuity + VOID workflow** *(P1)*
- **What:** Receipts already use `receipt_prefix`. Add a **sequence ledger** (per financial year) so receipt numbers are strictly sequential and **gaps are detectable** ("Receipts 1041–1043 are missing from this month — click to see who voided them"). Replace "delete a wrong receipt" with **VOID** (keeps the number, marks `VOID`, reason + who + when, audited).
- **Why:** An auditor checks sequence continuity. A voided receipt must be visible, not vanish.
- **Simple version:** Wrong entry? One button "Void with reason" (3 fields max). The number stays in the list greyed out with a strikethrough.

**A3. Optional two-person approval above a threshold** *(P1, opt-in)*
- **What:** Setting: *"Expenses above ₹X need approval"* (default OFF, so small mahallus stay simple). When ON: Secretary/Treasurer **records** the expense with voucher; President/Administrator **approves** it; only then it appears in the ledger totals. Approval is one click from a "Pending approvals" list on the dashboard.
- **Why:** Segregation of duties — no single person can record, approve and pay (the #1 fraud control per standard internal-controls guidance). Small orgs keep it off or set a high threshold.
- **Simple version:** One dashboard card, one button. Nobody needs to learn a workflow — the app just routes.

**A4. Monthly closing / period lock** *(P2, opt-in)*
- **What:** "Lock March" → no edits to March entries without an Administrator correction (which is itself audited).
- **Why:** Prevents silent re-dating of entries into past months; supports the annual 31-March cutoff for the Waqf Board statement.
- **Simple version:** A single toggle per month in Reports → Accounting.

**A5. Annual Waqf-Board / auditor export** *(P1)*
- **What:** One-click **"Audit pack"** export: Receipts & Payments, Income & Expenditure (financial-year basis, default already 01-Apr), ledger with voucher refs, **7% contribution calculation**, member collection summary. Formats: Excel + PDF. The PDF carries a **65B certificate page** (Pillar B).
- **Why:** This is the actual statutory deliverable (§46/47 Waqf Act; Societies Act audit). Doing it by hand every year is the current pain.
- **Simple version:** Reports → "Annual audit pack" → pick year → Export. Done.

---

### PILLAR B — Anti-tampering & evidentiary strength

**B1. Hash-chained audit log** *(P1 — high value, low effort)*
- **What:** Add `prev_hash` + `entry_hash` (SHA-256 over previous hash + event fields) to `audit_log`. Add **"Verify integrity"** under Settings → Audit Log: walks the chain and reports "✓ Chain intact — 12,431 events verified" or flags the first broken link. Export the chain as JSON/CSV for auditors.
- **Why:** Today the triggers make audit rows append-only in *normal operation*, but a determined insider with the DB file could edit rows and rebuild the file. A hash chain makes **any** deletion/editing of history detectable. This is the standard, lightweight tamper-evidence technique (no blockchain needed).
- **Simple version:** A single button + a green/red verdict. Users never see the mechanics.

**B2. 65B / BSA §63 certificate for exports** *(P1)*
- **What:** Every export (register, ledger, certificate reprint, audit pack) can append a page: *"This is to certify that the following records were generated by [Mahallu name] using MMS v2.x on [device], in the ordinary course of operations; entries are protected by an append-only, hash-verified audit trail. Signed: [Administrator]."* Administrator signs once in Settings; the text is stored and reused.
- **Why:** Without this, a printed register has weak evidentiary value in a dispute (Anvar ruling). With it, the committee can actually rely on printouts.
- **Simple version:** A checkbox "Include certificate page" that's ON by default. Zero extra typing after the one-time setup.

**B3. Certificate anti-forgery** *(P1)*
- **What:** Each issued certificate gets: a **verification code** (stored in DB), a **hash of its contents**, and a **QR code** printed on it. Anyone can scan the QR (or type the code on the mahallu's own machine) and get "✓ This certificate matches the register — issued 12-Jan-2026, No. 0042". **Reprints are watermarked "DUPLICATE"** and logged.
- **Why:** Directly addresses "forging" — a photocopy/forged PDF won't verify; a reprint is distinguishable from the original issue.
- **Simple version:** All automatic — QR prints on the certificate, reprint button asks "reason" (2 fields). Verification is a search box on the Certificates page.

**B4. Edit policy for official records: "correct, don't overwrite"** *(P1)*
- **What:** For marriages/deaths/certificates: edits after entry are limited to **"Correction"** — the old value is preserved in history with the reason, and the register shows both (old crossed out style in the printed register, or a "corrected" flag).
- **Why:** In a physical register you never white-out a marriage entry; you strike through and re-enter. Digital registers should mirror that. Currently `marriages:update`/`deaths:update` allow edits with audit — good, but a correction workflow makes it deliberate and visible on the printed register.
- **Simple version:** The edit dialog becomes "Correct entry — reason (required)". One extra required field; everything else looks the same.

---

### PILLAR C — Official registers (marriage/death/certificates)

**C1. Register book exports in official page format** *(P1)*
- **What:** "Print Register" produces a paginated, numbered **register book** (like the SMF/Samastha register) — sequential page numbers, entry numbers, signature lines for Qazi/Secretary and witnesses, and a **"This register has N entries, no deletions"** integrity line at the end.
- **Why:** The physical register is what elders/auditors trust. The app should generate it in a form that can be printed, bound and signed — and every reprint carries the integrity line.
- **Simple version:** One button per register: Marriage register, Death register, Certificate register.

**C2. Link nikah entries to member records (optional)** *(P2 — also feeds family tree, Pillar D)*
- **What:** Bride/groom fields stay free-text (people from outside the mahallu must still be enterable) but add optional **"Link to member"** pickers. Linked couples automatically appear in the family tree.
- **Why:** Marriage is the family-tree backbone; linking makes trees possible without forcing data entry.

---

### PILLAR D — Family tree & member relationships

**D1. Relationship links (father/mother/spouse/children)** *(P1)*
- **What:** Add `father_id`, `mother_id` to `members` (links to member rows; `father_name` text stays for unlinked people). Spouse links come from linked marriage records (C2) or an explicit spouse picker. Children are derived automatically.
- **Why:** This is the standard, simple genealogy model (adjacency/self-referencing with recursive queries — no complex graph engine needed for a mahallu-sized DB).
- **Simple version:** On a member's profile, a small "Family" card: *Parents · Spouse · Children* with photos, auto-built from links. Adding a link is two clicks (search + select).

**D2. Family tree view** *(P2)*
- **What:** "Family" tab on the Family card and Member profile showing a **tree** (3 generations deep by default, expandable). Pedigree view for a single member (ancestors) + descendants view.
- **Why:** The mahallu is one big extended family; a tree makes relationships (who is whose cousin, eligibility for committee posts, burial plot records, etc.) instantly visible.
- **Simple version:** Read-only visualization; users don't edit the tree directly — links are made on member profiles (D1). Zero new workflows.

---

### PILLAR E — Backup & disaster recovery

**E1. Fix the broken backup path** *(P0 — do this first)*
- **What:** `await db.backup(temp)` (or switch to a reliable synchronous copy+checkpoint), remove ESM `require()`s, add an integration test that creates a real backup.
- **Why:** Data protection starts with backups. Right now manual backup, auto-backup and pre-restore safety backups all fail at runtime.

**E2. Pre-migration safety backup + retention policy** *(P1)*
- **What:** Before applying schema migrations, take an automatic `.mmbak` snapshot. Add a setting: *Keep last N backups* (default 10); auto-prune older ones. Warn on startup if the last backup is older than X days (uses existing auto-backup timer).
- **Why:** A bad migration is the one failure mode that can silently corrupt history. One snapshot per migration is cheap insurance.
- **Simple version:** Fully automatic; the user only sees the "last backup" date in Settings/Backup.

**E3. Encrypted backups (optional)** *(P2)*
- **What:** Optional password-encrypted `.mmbak` (AES-GCM) for off-site storage.
- **Why:** Backups contain members' phones/addresses; if stored on a pen drive or cloud, encryption matters. Off by default to keep things simple; one checkbox in Settings.

---

### PILLAR F — Access & approval (segregation of duties, done simply)

**F1. Role-based module access (read/write/approve) enforced end-to-end** *(P1)*
- **What:** Today roles exist and admin gates exist, but most write handlers accept *any authenticated* actor. Add a simple **permission matrix** (Settings → Users → "Permissions", a table of module × role × action, pre-filled with sensible defaults matching committee structure: Secretary records, President/Treasurer approves, Auditor reads). Enforce it in `security-ipc.ts` like the existing guards.
- **Why:** Prevents one person from controlling an entire flow (record + approve + pay). Pre-filled defaults keep it one screen, not a burden.
- **Simple version:** The default matrix is shown as "recommended"; most mahallus never touch it.

**F2. "Why is this locked?" everywhere** *(P1 — usability)*
- **What:** Every blocked action explains itself: *"Marriage #0042 can't be deleted because official records are permanent. You can correct it or mark it void — ask an Administrator."*
- **Why:** Users get confused by blocks only when the app is silent. One tooltip/tost line turns a confusing restriction into a trust signal.

---

### PILLAR G — Demo vs production data

**G1. Demo data flag** *(P1)*
- **What:** A setting `demo_data` (auto-set when seed/demo migrations load). When ON, the UI shows a persistent banner "Demo data — clear it before real use", and **"Clear demo data"** wipes demo families/members/transactions in one click (leaving real entries).
- **Why:** Right now every fresh install ships the demo population and it can never be deleted (archive-only). A new committee starting real use should clean it in one step.
- **Simple version:** A banner + one button. The demo flag also keeps future demo/test migrations out of production databases.

---

## 4. Workflow map — every module, one line

| Module | Simple workflow (what the user does) | Protections |
|---|---|---|
| Families | Add → Edit (audited) → Archive (reason) → Restore | No delete; history; single-head rule |
| Members | Add → Edit → Move family (reason) → Archive → Restore | No delete; move audit; head rule |
| Subscriptions | Collect → numbered receipt → Void (reason) if wrong | No delete; sequence ledger; overdue tracking |
| Donations | Record (linked to family/member) → receipt → Void | No delete; duplicate-bill check |
| Expenses | **Voucher no + bill no + attachment + (approval if threshold)** | No delete; approval; duplicate check |
| Accounting | Unified ledger → monthly lock (opt-in) → audit pack export | Period lock; 65B certificate on export |
| Marriages | Register entry → link members (optional) → Certificate/NOC → print register | Correction-only edits; register export |
| Deaths | Register entry → Certificate → print register | Correction-only edits; register export |
| Welfare | Apply → Approve (admin, amount) → Disburse → receipt | Status workflow; no delete |
| Certificates | Issue → print (QR) → reprint (DUPLICATE) → revoke (reason) | Verification code + QR; revoke, no delete |
| Tokens | Create event → generate → collect → cancel/replace → delete (admin, past event) | Event delete blocked; audit |
| Staff | Add → pay salary (admin) → cancel payment | No delete; payment audit |
| Committee | Add → archive (reason) → restore | No delete; history |
| Users | Admin-only; lock; reset; strong password | PBKDF2; lockout; per-role matrix (new) |
| Settings | Admin-only; every save audited | — |
| Backup | Auto + manual .mmbak (fixed) → verify → restore (relaunch) | SHA-256 manifest; pre-restore safety copy |

---

## 5. Usability guardrails (the "don't confuse users" rule)

1. **Default = simple.** Every control feature (approvals, period lock, encryption) ships **OFF** with sensible defaults; enabling is one toggle in Settings. A mahallu with 30 families never sees approval workflows it doesn't need.
2. **One screen, one job.** No new complex pages: vouchers are fields on the existing expense form; the family tree is a read-only card on existing profiles; approvals are a dashboard card.
3. **Explain every block.** Every restriction shows *why* + *what to do instead* (F2).
4. **Warn, don't block (first).** Missing bill number → yellow flag + "No bill" marker, not a refusal. Hard blocks only where law/records demand (deleting a marriage).
5. **Pre-filled everything.** Voucher numbers, receipt sequences, register numbers, the permission matrix, the 65B text — the app fills them; users only correct.
6. **Malayalam everywhere.** New fields/labels/help must exist in both languages like the rest of the app (i18n audit currently flags 29 hardcoded strings — clean those as part of this).

---

## 6. Prioritized roadmap

| Priority | Items | Rough effort |
|---|---|---|
| **P0 — ship-blockers** | ✅ E1 fix backup (await + imports + test); ✅ A1 voucher/bill fields on expenses; ✅ the 3 runtime crashes (Excel export, token delete) | 1–2 days |
| **P1 — core integrity** | ✅ B1 hash-chained audit + verify; ✅ D1 family links; A2 receipt VOID + sequence; B2 65B certificate; B3 certificate QR/verification + DUPLICATE reprint; B4 correction workflow; C1 register exports; A5 audit pack export; F1 permission matrix; F2 lock explanations; G1 demo-data cleanup | ~2–3 weeks |
| **P2 — polish** | A3 approval thresholds (opt-in); A4 period lock; C2 nikah↔member links; D2 tree view; E2 pre-migration backup + retention; E3 encrypted backups | ~1–2 weeks |

**Suggested order:** P0 → B1/B2 → A-pillar (vouchers, VOID, audit pack) → D-pillar (family) → rest.

### ✅ Implemented so far (2026-08-30)

| Item | What was done | Where |
|---|---|---|
| E1 — backup fix | `createBackup` is now `async` and **awaits** `db.backup()` before hashing; removed the ESM `require("fs")`; all 3 call sites (manual, pre-restore safety, auto-backup) await it | `backup.service.ts`, `main.ts` |
| P0 — Excel export fix | Replaced `const XLSX = require("xlsx")` (ReferenceError in ESM) with a top-level `import XLSX from "xlsx"`; added Voucher No / Bill No / Payee columns to the exported sheet | `main.ts` |
| P0 — token delete fix | Replaced the ESM `require("../db/connection.js")` with a proper import; added the **server-side** "only after event date has passed" check (previously UI-only); deletion + audit row now in one transaction (V009 intent) | `security-ipc.ts` |
| A1 — voucher/bill/payee | New `transactions.voucher_no / bill_no / payee` columns (runtime schema + migration V030); expense form has Voucher No. (auto-filled `VOU-YYYY-####`), Bill/Invoice No., Payee; **duplicate bill-number warning** (same bill already used → yellow toast with the earlier entry's date/amount); ledger shows voucher column; search + Excel export cover the new fields; **no file upload anywhere** | `data.service.ts`, `Accounting.tsx`, `connection.ts`, `V030` |
| B1 — tamper-evident audit chain | Every audit event now stores `prev_hash` + `entry_hash` (SHA-256 over the event fields + previous hash); an `audit_chain` anchor table tracks the newest hash + count; **"Verify integrity"** button on the Audit Log page walks the chain and reports intact/broken (+ detects tail truncation via the anchor); legacy pre-hash rows are skipped as anchors; 8 unit tests cover intact/edit/delete/reorder/legacy cases | `audit-chain.ts` (+ tests), `data.service.ts`, `AuditLog.tsx`, `V030` |
| D1 — family links | New `members.father_id / mother_id / spouse_id` columns; member form has "Father/Mother/Spouse (member link)" pickers (father picker also feeds the free-text name); member preview shows a Family card (father / mother / spouse / children, auto-derived children from links); the audited member-update path persists the links and records them in history | `data.service.ts`, `security.service.ts`, `Members.tsx`, `connection.ts`, `V030` |

**Round 2 (2026-08-30):**

| Item | What was done | Where |
|---|---|---|
| E2 — receipt VOID + sequence continuity | `transactions.status` (`Posted`/`Void`) + `voided_at/voided_by/void_reason` columns; **delete replaced by VOID** (admin-only, reason required, already-void rejected, entry kept for audit with its receipt number); ledger hides voided entries from sums but shows a VOID badge with strikethrough; receipt numbers use suffix-max across ALL rows (never `MAX(id)+1`, so typed manual numbers can't cause reuse); **"Receipts"** button opens a continuity dialog listing every receipt in order and flagging **missing numbers** (only possible via manual DB edits, since deletion is blocked); duplicate-bill detection ignores voided entries | `data.service.ts`, `security-ipc.ts`, `Accounting.tsx`, `connection.ts`, `V031` |
| F1 — annual audit pack | **"Annual Audit Pack"** on Reports: picks a financial year (Apr 1 → Mar 31), computes opening/closing balance across all 5 ledger sources, receipts & payments by category, 7% Waqf contribution (indicative), and exports a printable PDF with **Receipts & Payments**, **Income & Expenditure**, **Voucher Register** (date/voucher/receipt/bill/payee/amount, VOID rows marked) and a **§65B-style certificate page** (source system, hash-protected audit trail, generated-on) with President/Secretary/Auditor signature lines; bilingual (EN/ML) | `data.service.ts` (`accounting.auditPack`), `main.ts`, `audit-pack.template.ts`, `Reports.tsx` |
| F2 — certificate anti-forgery | Every issued certificate gets a **verification code** (3×4 ambiguity-free chars, no 0/O/1/I/L); the PDF and in-app preview print the code in a verify box; a **Verify** lookup on the Certificates page checks a code or certificate number (case-insensitive) and returns holder/type/date/status/reprint count; **reprints are watermarked "DUPLICATE — REPRINT #n"** (diagonal, tamper-evident) — the count increments only when the PDF is actually saved, so a copy can never pass as the original | `codes.ts` (+tests), `data.service.ts`, `security-ipc.ts`, `main.ts`, `certificate.template.ts`, `Certificates.tsx`, `V031` |
| G2 — register-book printing | **Print Register** on Marriages and Deaths: paginated A4-landscape official register with sequential numbers, chronological order, signature lines and an integrity line ("N entries, no deletions — permanent deletion is disabled, every entry is recorded in the tamper-evident audit trail"); bilingual headers | `main.ts`, `register-book.template.ts` (+tests), `data.service.ts`, `Marriages.tsx`, `Deaths.tsx` |

**Not done (next rounds):** 65B certificate page on ordinary Excel exports, correction-only edits for registers (register edits currently overwrite history), approval thresholds, period lock, demo-data cleanup, encrypted backups.

---

## 7. Sources (for the legal/compliance claims)

- Waqf Act 1995 §46–47 (accounts & audit), S.77 (contribution): Kerala State Waqf Board — keralastatewakfboard.in/act6.html; lawgist.in/waqf-act/47
- 2025 Unified Waqf Management Rules (portal upload of audit reports): lawgist.in (S.108B notes); Waqf (Amendment) Act 2025
- Kerala Societies Registration Act, 2025 (Act 14 of 2025) replacing the 1955 Travancore-Cochin Act; annual returns/audit: lukeandluka.in/society-registration-kerala-2025; prsindia.org (1955 Act text, §12–13 books & audit)
- Kerala Registration of Marriages (Common) Rules, 2008 (45-day registration; local registrar): itzeazy.in/blog/2026/03/21/marriage-registration-kerala
- §65B Evidence Act / §63 BSA, Anvar P.V. v. P.K. Basheer (2014) 10 SCC 473, Arjun Panditrao (2020): advocategandhi.com; legalserviceindia.com
- Internal controls / segregation of duties (cash receipts, AP, approval thresholds): finance.syr.edu; ramp.com/blog/accounts-payable/segregation-of-duties-in-accounts-payable
- Tamper-evident hash-chained audit logs (append-only + SHA-256 chain + verification + anchored roots): designgurus.io; c-sharpcorner.com; sachith.co.uk
- Family-tree data modeling (self-referencing father/mother/relationship table, recursive queries): stackoverflow.com (genealogy SQL); gist.github.com/1930029; learn.microsoft.com (genealogy table structure)
