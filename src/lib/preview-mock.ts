/* ============================================================================
 * Preview mock (DEV ONLY) — lets the renderer run in a plain browser so the
 * full UI can be reviewed in the Vite dev server without the Electron bridge.
 *
 * Enabled ONLY when the URL contains ?preview=1 in a DEV build:
 *   http://localhost:5174/?preview=1
 *
 * It installs a Proxy-backed window.mms that returns realistic data for the
 * shell + dashboard and safe empty/default responses for everything else, so
 * every screen renders its design (tables show the empty state, etc.).
 * This file is dead code in production builds (never imported there).
 * ========================================================================== */

export function installPreviewMock() {
  if (typeof window === "undefined") return;
  const anyWin = window as any;
  if (anyWin.mms) return;

  const adminUser = {
    id: 1,
    username: "admin",
    fullName: "System Administrator",
    role: "Administrator",
    isActive: true,
    mustChangePwd: false,
    initials: "SA",
  };

  const dashboard = {
    summary: () => ({
      total_families: 12,
      total_members: 37,
      active_members: 35,
      monthly_collection: 18500,
      pending_dues: 3200,
      monthly_donations: 12400,
      marriages_this_year: 3,
      deaths_this_year: 2,
    }),
    balance: () => 396500,
    monthlyCollections: () => [
      { month: "2026-03", amount: 16800 },
      { month: "2026-04", amount: 17250 },
      { month: "2026-05", amount: 15900 },
      { month: "2026-06", amount: 18100 },
      { month: "2026-07", amount: 17650 },
      { month: "2026-08", amount: 18500 },
    ],
    incomeVsExpense: () => [
      { month: "2026-03", income: 22100, expense: 8900 },
      { month: "2026-04", income: 23400, expense: 10400 },
      { month: "2026-05", income: 19800, expense: 9600 },
      { month: "2026-06", income: 24600, expense: 11300 },
      { month: "2026-07", income: 22900, expense: 10700 },
      { month: "2026-08", income: 26200, expense: 11800 },
    ],
    recentActivity: () => [
      // Field names mirror the real audit_log columns (created_at/description)
      // so the Dashboard's Recent Activity table renders identically here.
      { id: 1, action: "created", entity_type: "member", entity_id: 12, username: "admin", created_at: "2026-08-29 18:42:11", description: "Added member Ayaan Rahman" },
      { id: 2, action: "created", entity_type: "donation", entity_id: 8, username: "treasurer", created_at: "2026-08-29 17:15:03", description: "Recorded donation ₹2,500" },
      { id: 3, action: "updated", entity_type: "family", entity_id: 4, username: "secretary", created_at: "2026-08-28 11:20:47", description: "Updated family FAM-004" },
      { id: 4, action: "created", entity_type: "certificate", entity_id: 5, username: "secretary", created_at: "2026-08-27 15:05:22", description: "Issued certificate CERT-2025-0005" },
    ],
    alerts: () => [
      { type: "subscriptions_overdue", count: 3 },
      { type: "welfare_pending", count: 2 },
    ],
    todayAtGlance: () => ({
      receiptsToday: 6,
      welfarePending: 2,
      fundBalance: 396500,
      backupEnabled: true,
      lastBackup: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      nextBackup: new Date(Date.now() + 19 * 3600 * 1000).toISOString(),
    }),
  };

  const settings = {
    load: () => ({
      mahallu_name: "Minz Mahallu Juma Masjid",
      address: "Moozhikkal, Kozhikode, Kerala 673011",
      phone: "0495-2400000",
      email: "office@minzmahallu.org",
      financial_year_start: "04-01",
      currency_symbol: "₹",
      theme: "light",
      language: "en",
      auto_backup: true,
      backup_interval_hours: 24,
      receipt_prefix: "MMH",
    }),
    save: () => ({ success: true }),
  };

  const auth = {
    setupStatus: () => ({ required: false }),
    login: async () => ({ success: true, user: adminUser }),
    logout: () => ({ success: true }),
    changePassword: () => ({ success: true }),
    verifyAdminPassword: () => ({ success: true }),
    createInitialAdministrator: () => ({ success: true, user: adminUser }),
  };

  const win = {
    minimize: () => ({}),
    maximize: () => ({}),
    close: () => ({}),
    confirmClose: () => ({}),
    onAskClose: (_cb: () => void) => () => ({}),
  };

  // Uninstall-gate window only exists when launched by the NSIS uninstaller;
  // stubbed so the page still renders in a dev browser preview. Dev-only file
  // (never bundled into production) — accepts any password, and deliberately
  // contains NO real or historical credential string.
  const uninstall = {
    dbStatus: () => ({ hasDb: true }),
    verify: (p: string) => (p && p.trim() ? { ok: true, username: "admin" } : { ok: false, reason: "wrong-password" }),
    finish: (_ok: boolean) => ({}),
  };

  // ===== Certificates — anti-forgery (verification code + QR fingerprint) =====
  const certFingerprint = "A1B2C3D4E5F60718";
  const mockCertificates = {
    verify: (code: string) => {
      const clean = String(code || "").trim().toUpperCase();
      if (!clean || !/^[A-Z0-9-]{8,}$/.test(clean)) return Promise.resolve({ valid: false, certificate: null });
      return Promise.resolve({
        valid: true,
        certificate: {
          certificate_number: "CERT-2026-0042",
          type: "Membership",
          issued_to: "Ayaan Rahman",
          issued_date: "2026-08-12",
          status: "Issued",
          reprint_count: 0,
        },
        qrPayload: `MMS|CERT|CERT-2026-0042|${clean}|${certFingerprint}|2026-08-12`,
        deviceFingerprint: certFingerprint,
      });
    },
    verifyQr: (payload: string) => {
      const parts = String(payload || "").trim().split("|");
      if (parts.length !== 6 || parts[0] !== "MMS" || parts[1] !== "CERT") return Promise.resolve({ valid: false, reason: "malformed", certificate: null });
      return Promise.resolve({
        valid: true,
        certificate: { certificate_number: parts[2], type: "Membership", issued_to: "Ayaan Rahman", issued_date: parts[5], status: "Issued", reprint_count: 0 },
        qr: { fingerprint: parts[4], issuedDate: parts[5], certificateNumber: parts[2] },
        issuedOnThisDevice: parts[4].toUpperCase() === certFingerprint.toUpperCase(),
        certificateMatchesRegister: parts[2] === "CERT-2026-0042",
      });
    },
  };

  // ===== Accounting (unified ledger) — realistic demo data =====
  // Dates are generated relative to today so "this month" always has rows,
  // and the period presets (this_month / last_month / …) resolve like the
  // real backend. Rows are module-scoped mutable so add/edit/void flows work.
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const iso = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };

  const resolveRange = (period?: string, from?: string, to?: string): { from: string; to: string } | null => {
    if (!period || period === "all") return null;
    if (period === "custom") return from && to ? { from, to } : null;
    const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
    if (period === "this_month") return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
    if (period === "last_month") return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    if (period === "this_quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(y, q, 1), to: iso(y, q + 3, 0) }; }
    if (period === "last_quarter") { const q = Math.floor(m / 3) * 3 - 3; const cy = q < 0 ? y - 1 : y; const cm = q < 0 ? q + 12 : q; return { from: iso(cy, cm, 1), to: iso(cy, cm + 3, 0) }; }
    if (period === "this_year") return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (period === "last_year") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    return null;
  };
  const inRange = (date: string, r: { from: string; to: string } | null) => !r || (date >= r.from && date <= r.to);

  interface MockLedgerRow {
    source_id: number; source: string; ledger_date: string; type: "Income" | "Expense";
    amount: number; description: string; payment_method: string; transaction_ref: string; receipt_number: string;
    voucher_no?: string | null; bill_no?: string | null; payee?: string | null; account_id?: number | null;
    linked_module?: string | null; linked_id?: number | null; status?: string | null; void_reason?: string | null; voided_at?: string | null;
    category?: string | null; asset_id?: number | null; asset_name?: string | null;
  }
  let mockTxnSeq = 200;
  // ===== Asset register (V036) — stateful sample data for the Assets page. =====
  let mockAssetSeq = 4;
  const assetRows = [
    { id: 1, asset_code: "AST-001", name: "Main Road Shop", category: "Shop", reference_no: "Sy.No. 142/2", location: "Main Road", acquisition_date: "2019-06-12", acquisition_cost: 1800000, current_value: 2600000, status: "Given rent", condition_note: "Good", custodian: "Secretary", income_generating: 1, tenant_name: "Anwar Stores", monthly_rent: 6500, agreement_start: "2025-04-01", agreement_end: "2028-03-31", notes: "", income_total: 78000, expense_total: 3420 },
    { id: 2, asset_code: "AST-002", name: "West Side Plot", category: "Land", reference_no: "Sy.No. 87/1B", location: "West of masjid", acquisition_date: "1998-01-20", acquisition_cost: 250000, current_value: 1900000, status: "Vacant", condition_note: "Good", custodian: "President", income_generating: 0, tenant_name: "", monthly_rent: 0, agreement_start: "", agreement_end: "", notes: "Kept for future madrasa expansion", income_total: 0, expense_total: 0 },
    { id: 3, asset_code: "AST-003", name: "Community Hall", category: "Hall", reference_no: "", location: "First floor", acquisition_date: "2015-03-10", acquisition_cost: 950000, current_value: 1400000, status: "In use", condition_note: "Needs repair", custodian: "Manager", income_generating: 1, tenant_name: "", monthly_rent: 0, agreement_start: "", agreement_end: "", notes: "Booked for weddings via office", income_total: 64000, expense_total: 2750 },
  ];
  const ledgerRows: MockLedgerRow[] = [
    // Manual transactions (source: transactions) — editable / voidable
    { source_id: 1, source: "transactions", ledger_date: daysAgo(3), type: "Income", amount: 5000, description: "Donation — Haji Abdulla", payment_method: "Bank Transfer", transaction_ref: "NEFT-22310", receipt_number: "TXN-2026-0101", voucher_no: "V-2026-118", payee: "Haji Abdulla", account_id: 1, status: "Posted" },
    { source_id: 2, source: "transactions", ledger_date: daysAgo(9), type: "Income", amount: 8000, description: "Community hall rent — July", payment_method: "Cash", transaction_ref: "CASH-00312", receipt_number: "TXN-2026-0098", voucher_no: "V-2026-115", payee: "Moulavi Hassan", account_id: 1, status: "Posted", category: "Hall Rent", asset_id: 3, asset_name: "Community Hall" },
    { source_id: 3, source: "transactions", ledger_date: daysAgo(2), type: "Expense", amount: 3420, description: "Electricity bill (July)", payment_method: "Bank Transfer", transaction_ref: "NEFT-55912", receipt_number: "TXN-2026-0103", voucher_no: "V-2026-120", bill_no: "KSEB-77812", payee: "KSEB Ltd", account_id: 1, status: "Posted", category: "Electricity", asset_id: 1, asset_name: "Main Road Shop" },
    { source_id: 4, source: "transactions", ledger_date: daysAgo(12), type: "Expense", amount: 2750, description: "Maintenance — plumbing repair", payment_method: "Cash", transaction_ref: "CASH-00451", receipt_number: "TXN-2026-0095", voucher_no: "V-2026-112", bill_no: "PL-0881", payee: "Basheer Plumbers", account_id: 1, status: "Posted" },
    { source_id: 5, source: "transactions", ledger_date: daysAgo(20), type: "Income", amount: 1450, description: "FD interest", payment_method: "Bank Transfer", transaction_ref: "NEFT-11022", receipt_number: "TXN-2026-0090", voucher_no: "V-2026-108", payee: "Canara Bank", account_id: 1, status: "Posted" },
    { source_id: 6, source: "transactions", ledger_date: daysAgo(16), type: "Expense", amount: 1200, description: "Stationery", payment_method: "Cash", transaction_ref: "CASH-00418", receipt_number: "TXN-2026-0092", voucher_no: "V-2026-110", bill_no: "ST-041", payee: "City Stationers", account_id: 1, status: "Posted" },
    { source_id: 7, source: "transactions", ledger_date: daysAgo(6), type: "Expense", amount: 1000, description: "Duplicate payment (voided)", payment_method: "Cash", transaction_ref: "CASH-00433", receipt_number: "TXN-2026-0099", voucher_no: "V-2026-116", payee: "Rashid Traders", account_id: 1, status: "Void", void_reason: "Duplicate entry — original already posted", voided_at: daysAgo(5) },
    // Donations (income, auto)
    { source_id: 11, source: "donations", ledger_date: daysAgo(4), type: "Income", amount: 2500, description: "Donation — Amina Beevi — Eid fund", payment_method: "UPI", transaction_ref: "UPI-334455", receipt_number: "RCP-2026-0021" },
    { source_id: 12, source: "donations", ledger_date: daysAgo(18), type: "Income", amount: 1500, description: "Donation — Ramzan relief fund", payment_method: "Cash", transaction_ref: "CASH-00398", receipt_number: "RCP-2026-0014" },
    // Subscription payments (income, auto)
    { source_id: 21, source: "subscriptions", ledger_date: daysAgo(2), type: "Income", amount: 150, description: "Subscription — RCP-2026-0003", payment_method: "UPI", transaction_ref: "UPI-88912033", receipt_number: "RCP-2026-0003" },
    { source_id: 22, source: "subscriptions", ledger_date: daysAgo(5), type: "Income", amount: 150, description: "Subscription — RCP-2026-0002", payment_method: "Cash", transaction_ref: "CASH-000221", receipt_number: "RCP-2026-0002" },
    { source_id: 23, source: "subscriptions", ledger_date: daysAgo(8), type: "Income", amount: 150, description: "Subscription — RCP-2026-0001", payment_method: "UPI", transaction_ref: "UPI-88922144", receipt_number: "RCP-2026-0001" },
    { source_id: 24, source: "subscriptions", ledger_date: daysAgo(11), type: "Income", amount: 100, description: "Subscription — RCP-2026-0007 (partial)", payment_method: "Bank Transfer", transaction_ref: "NEFT-66230", receipt_number: "RCP-2026-0007" },
    { source_id: 25, source: "subscriptions", ledger_date: daysAgo(40), type: "Income", amount: 150, description: "Subscription — RCP-2026-0601", payment_method: "UPI", transaction_ref: "UPI-77110123", receipt_number: "RCP-2026-0601" },
    // Welfare disbursements (expense, auto)
    { source_id: 31, source: "welfare", ledger_date: daysAgo(7), type: "Expense", amount: 5000, description: "Welfare — medical aid — Abdul Khader", payment_method: "Cash", transaction_ref: "", receipt_number: "WLF-2026-0007" },
    { source_id: 32, source: "welfare", ledger_date: daysAgo(21), type: "Expense", amount: 3000, description: "Welfare — funeral assistance", payment_method: "Cash", transaction_ref: "", receipt_number: "WLF-2026-0004" },
    // Staff salary (expense, auto)
    { source_id: 41, source: "salary", ledger_date: daysAgo(1), type: "Expense", amount: 12000, description: "Salary — Office clerk (08/2026)", payment_method: "Bank Transfer", transaction_ref: "NEFT-77001", receipt_number: "" },
    { source_id: 42, source: "salary", ledger_date: daysAgo(35), type: "Expense", amount: 12000, description: "Salary — Office clerk (07/2026)", payment_method: "Bank Transfer", transaction_ref: "NEFT-66990", receipt_number: "" },
  ];

  const accounting = {
    unifiedList: (filter: any = {}) => {
      const range = resolveRange(filter.period || "all", filter.from, filter.to);
      let rows = ledgerRows.filter((r) =>
        inRange(r.ledger_date, range) &&
        (!filter.source || filter.source === "All" || r.source === filter.source) &&
        (!filter.type || filter.type === "All" || r.type === filter.type) &&
        (!filter.search || (r.description + " " + r.receipt_number + " " + (r.voucher_no || "") + " " + (r.bill_no || "")).toLowerCase().includes(String(filter.search).toLowerCase()))
      );
      const total = rows.length;
      const page = filter.page || 1; const pageSize = filter.pageSize || 20;
      rows = rows.slice((page - 1) * pageSize, page * pageSize);
      return Promise.resolve({ rows, total });
    },
    unifiedSummary: (filter: any = {}) => {
      const range = resolveRange(filter.period || "all", filter.from, filter.to);
      const rows = ledgerRows.filter((r) => inRange(r.ledger_date, range) && r.status !== "Void");
      let totalIncome = 0, totalExpense = 0, incomeDonations = 0, incomeSubscriptions = 0, incomeManual = 0, expenseWelfare = 0, expenseSalary = 0, expenseManual = 0;
      for (const r of rows) {
        if (r.type === "Income") {
          totalIncome += r.amount;
          if (r.source === "donations") incomeDonations += r.amount;
          else if (r.source === "subscriptions") incomeSubscriptions += r.amount;
          else incomeManual += r.amount;
        } else {
          totalExpense += r.amount;
          if (r.source === "welfare") expenseWelfare += r.amount;
          else if (r.source === "salary") expenseSalary += r.amount;
          else expenseManual += r.amount;
        }
      }
      return Promise.resolve({
        totalIncome, totalExpense, balance: totalIncome - totalExpense,
        incomeDonations, incomeSubscriptions, incomeManual, expenseWelfare, expenseSalary, expenseManual,
        entryCount: rows.length, period: filter.period || "all", from: range?.from ?? null, to: range?.to ?? null,
      });
    },
    get: (id: number) => {
      const row = ledgerRows.find((r) => r.source === "transactions" && r.source_id === id);
      if (!row) return Promise.resolve(null);
      return Promise.resolve({
        id, receipt_number: row.receipt_number, txn_date: row.ledger_date, type: row.type, amount: row.amount,
        payment_method: row.payment_method, description: row.description, account_id: row.account_id ?? 1,
        transaction_ref: row.transaction_ref, voucher_no: row.voucher_no || "", bill_no: row.bill_no || "",
        payee: row.payee || "", category: row.category || "", asset_id: row.asset_id ?? null,
        linked_module: row.linked_module || "", linked_id: row.linked_id || 0,
      });
    },
    create: (payload: any) => {
      const nextId = ++mockTxnSeq;
      const linkedAsset = payload.assetId ? assetRows.find((a) => a.id === Number(payload.assetId)) : null;
      ledgerRows.unshift({
        source_id: nextId, source: "transactions", ledger_date: payload.txnDate, type: payload.type, amount: payload.amount,
        description: payload.description || "Manual entry", payment_method: payload.paymentMethod || "Cash",
        transaction_ref: payload.transactionRef || "", receipt_number: payload.receiptNumber || "",
        voucher_no: payload.voucherNo || "", bill_no: payload.billNo || "", payee: payload.payee || "",
        account_id: payload.accountId || 1, linked_module: payload.linkedModule || "", linked_id: payload.linkedId || null, status: "Posted",
        category: payload.category || "", asset_id: linkedAsset ? linkedAsset.id : null, asset_name: linkedAsset ? linkedAsset.name : null,
      });
      return Promise.resolve({ success: true, duplicateBill: false });
    },
    update: (id: number, payload: any) => {
      const row = ledgerRows.find((r) => r.source === "transactions" && r.source_id === id);
      if (row) Object.assign(row, {
        ledger_date: payload.txnDate, type: payload.type, amount: payload.amount, description: payload.description,
        payment_method: payload.paymentMethod, transaction_ref: payload.transactionRef, receipt_number: payload.receiptNumber,
        voucher_no: payload.voucherNo, bill_no: payload.billNo, payee: payload.payee,
      });
      return Promise.resolve({ success: true });
    },
    void: (id: number, reason: string) => {
      const row = ledgerRows.find((r) => r.source === "transactions" && r.source_id === id);
      if (row) { row.status = "Void"; row.void_reason = reason; row.voided_at = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()); }
      return Promise.resolve({ success: true, id });
    },
    receiptSequence: () => {
      const receipts = ledgerRows
        .filter((r) => r.receipt_number && /^TXN-/.test(r.receipt_number))
        .map((r) => ({ id: r.source_id, receipt_number: r.receipt_number, txn_date: r.ledger_date, type: r.type, amount: r.amount, status: r.status || "Posted", void_reason: r.void_reason || null }));
      return Promise.resolve({ receipts, missing: [], count: receipts.length });
    },
    exportPdf: (filter: any = {}) => accounting.unifiedList({ ...filter, page: undefined, pageSize: undefined }).then((res: any) => ({ success: true, count: res.total, cancelled: false })),
    exportExcel: (filter: any = {}) => accounting.unifiedList({ ...filter, page: undefined, pageSize: undefined }).then((res: any) => ({ success: true, count: res.total, cancelled: false })),
    // Double-click preview — preview mode returns the underlying ledger row + empty history.
    detail: (source: string, id: number) => {
      const row = ledgerRows.find((r) => r.source === source && r.source_id === id) || null;
      return Promise.resolve({ record: row ? { ...row } : null, changes: [], auditTrail: [] });
    },
  };

  // ===== Assets — stateful register so the Assets page + accounting link QA
  // runs without the main process. =====
  const assets = {
    list: (filter: any = {}) => {
      const q = String(filter.search || "").toLowerCase();
      let rows = assetRows.filter((a) =>
        (!q || [a.asset_code, a.name, a.location, a.reference_no, a.tenant_name, a.custodian].join(" ").toLowerCase().includes(q)) &&
        (!filter.category || filter.category === "All" || a.category === filter.category) &&
        (!filter.status || filter.status === "All" || a.status === filter.status)
      );
      const total = rows.length;
      const page = filter.page || 1; const pageSize = filter.pageSize || 20;
      rows = rows.slice((page - 1) * pageSize, page * pageSize);
      return Promise.resolve({ rows: rows.map((r) => ({ ...r })), total });
    },
    get: (id: number) => Promise.resolve(assetRows.find((a) => a.id === id) ? { ...assetRows.find((a) => a.id === id) } : null),
    create: (payload: any) => {
      const code = `AST-${String(mockAssetSeq++).padStart(3, "0")}`;
      const income = payload.incomeGenerating ? 1 : 0;
      const row: any = {
        id: mockAssetSeq + 100, asset_code: code, name: payload.name, category: payload.category || "Other",
        reference_no: payload.referenceNo || "", location: payload.location || "", acquisition_date: payload.acquisitionDate || "",
        acquisition_cost: Number(payload.acquisitionCost) || 0, current_value: Number(payload.currentValue) || 0,
        status: payload.status || "In use", condition_note: payload.conditionNote || "Good", custodian: payload.custodian || "",
        income_generating: income, tenant_name: income ? (payload.tenantName || "") : "", monthly_rent: income ? (Number(payload.monthlyRent) || 0) : 0,
        agreement_start: income ? (payload.agreementStart || "") : "", agreement_end: income ? (payload.agreementEnd || "") : "",
        notes: payload.notes || "", income_total: 0, expense_total: 0,
      };
      assetRows.push(row);
      return Promise.resolve({ id: row.id, assetCode: code });
    },
    update: (id: number, payload: any) => {
      const row: any = assetRows.find((a) => a.id === id);
      if (row) Object.assign(row, {
        name: payload.name, category: payload.category, reference_no: payload.referenceNo, location: payload.location,
        acquisition_date: payload.acquisitionDate, acquisition_cost: Number(payload.acquisitionCost) || 0,
        current_value: Number(payload.currentValue) || 0, status: payload.status, condition_note: payload.conditionNote,
        custodian: payload.custodian, income_generating: payload.incomeGenerating ? 1 : 0,
        tenant_name: payload.incomeGenerating ? (payload.tenantName || "") : "", monthly_rent: payload.incomeGenerating ? (Number(payload.monthlyRent) || 0) : 0,
        agreement_start: payload.incomeGenerating ? (payload.agreementStart || "") : "", agreement_end: payload.incomeGenerating ? (payload.agreementEnd || "") : "",
        notes: payload.notes,
      });
      return Promise.resolve({ success: true });
    },
    remove: (id: number) => {
      const idx = assetRows.findIndex((a) => a.id === id);
      if (idx >= 0 && (assetRows[idx].income_total || 0) > 0) {
        return Promise.reject(new Error("This asset has accounting entries linked to it, so it cannot be deleted. Change its status to Sold or Demolished instead."));
      }
      if (idx >= 0) assetRows.splice(idx, 1);
      return Promise.resolve({ success: true });
    },
    options: () => Promise.resolve(assetRows.filter((a) => !["Sold", "Demolished", "Transferred"].includes(a.status)).map((a) => ({ id: a.id, asset_code: a.asset_code, name: a.name, category: a.category, income_generating: a.income_generating, monthly_rent: a.monthly_rent }))),
    summary: () => Promise.resolve({
      count: assetRows.length,
      incomeGenerating: assetRows.filter((a) => a.income_generating).length,
      monthlyRentPotential: assetRows.reduce((s, a) => s + (a.income_generating ? a.monthly_rent : 0), 0),
      totalCurrentValue: assetRows.reduce((s, a) => s + a.current_value, 0),
      byCategory: [],
    }),
    statement: (id: number) => {
      const entries = ledgerRows
        .filter((r) => r.source === "transactions" && r.asset_id === id)
        .map((r) => ({ id: r.source_id, txn_date: r.ledger_date, type: r.type, amount: r.amount, description: r.description, category: r.category || null, receipt_number: r.receipt_number, status: r.status || null }));
      const income = entries.filter((e) => e.type === "Income").reduce((s, e) => s + e.amount, 0);
      const expense = entries.filter((e) => e.type === "Expense").reduce((s, e) => s + e.amount, 0);
      return Promise.resolve({ income, expense, net: income - expense, entries });
    },
  };

  // ===== WhatsApp — stateful ToS consent + connect + throttle snapshot so
  // the page's safety-notice flow (checkbox → ackToS → connect → connected
  // view) can be QA'd without the real engine. =====
  let waTosAcked = false;
  let waConnected = false;
  const whatsapp = {
    status: () => Promise.resolve({
      status: waConnected ? "CONNECTED" : "DISCONNECTED",
      connected: waConnected, internet: navigator.onLine,
      service: waConnected ? "RUNNING" : "", number: waConnected ? "919999000000" : "", name: waConnected ? "Mahallu" : "",
      message: waConnected ? "WhatsApp connected" : "WhatsApp pairing is available in the installed desktop app (dev preview).",
      tosAcked: waTosAcked,
      throttle: { sentToday: 0 },
    }),
    connect: (opts?: { acknowledged?: boolean }) => {
      if (!waTosAcked && !opts?.acknowledged) {
        return Promise.reject(new Error("Before connecting, please read and accept the WhatsApp safety notice on this page (tick the box, then press Connect)."));
      }
      waTosAcked = true;
      waConnected = true;
      return Promise.resolve({ success: true });
    },
    ackToS: () => { waTosAcked = true; return Promise.resolve({ success: true }); },
    qr: () => Promise.reject(new Error("QR code is not available yet")),
    disconnect: () => { waConnected = false; return Promise.resolve({ success: true, keptPairing: true }); },
    unlink: () => { waConnected = false; return Promise.resolve({ success: true, unlinked: true }); },
    checkNumber: () => Promise.resolve({ available: false, reason: "Preview mode" }),
    setFamily: () => Promise.resolve({ success: true }),
    getFamily: () => Promise.resolve({ whatsapp_phone: "", whatsapp_enabled: 1 }),
    sendMessage: () => Promise.resolve({ success: true }),
    sendDonationReceipt: () => Promise.resolve({ success: true }),
    sendSubscriptionReceipt: () => Promise.resolve({ status: "skipped", error: "Preview mode" }),
    recipientStats: (type: string) => Promise.resolve({ type, activeFamilies: 0, eligible: 0, missingWhatsApp: 0, disabledWhatsApp: 0, alreadySent: 0, willSend: 0 }),
    createSubscriptionCampaign: () => Promise.resolve({ campaignId: 1, total: 0 }),
    createAnnouncementCampaign: () => Promise.resolve({ campaignId: 1, total: 0 }),
    runCampaign: () => Promise.resolve({ campaignId: 1, sent: 0, failed: 0, skipped: 0, paused: false }),
    getCampaign: () => Promise.resolve(null),
    listCampaigns: () => Promise.resolve([]),
    listHistory: () => Promise.resolve([]),
    retryFailed: () => Promise.resolve({ sent: 0, failed: 0, skipped: 0, paused: false }),
    runtimeState: () => Promise.resolve({ installed: true, running: false, starting: false, state: "STOPPED", pid: null, lastError: "" }),
  };

  // Receipts (A6) — preview-safe stubs; the real PDF work happens in the app.
  const receipts = {
    getDonationPdf: () => Promise.resolve({ success: true, receiptNumber: "PREVIEW", pdfBase64: "", sizeBytes: 0 }),
    getSubscriptionPdf: () => Promise.resolve({ success: true, receiptNumber: "PREVIEW", pdfBase64: "", sizeBytes: 0 }),
    saveDonationPdf: () => Promise.resolve({ success: true, cancelled: false, path: "" }),
    saveSubscriptionPdf: () => Promise.resolve({ success: true, cancelled: false, path: "" }),
    saveDonationBatchPdf: () => Promise.resolve({ success: true, cancelled: false, count: 0, missing: [] }),
    saveSubscriptionBatchPdf: () => Promise.resolve({ success: true, cancelled: false, count: 0, skipped: [] }),
  };

  // Staff — the heuristic fallback answered roles() with {success:true},
  // which crashed the page's roles.map(). Employees only: committee
  // positions (President, Vice President, …) live on the Committee page.
  const staff = {
    list: () => Promise.resolve({ rows: [], total: 0 }),
    roles: () => Promise.resolve(["Imam", "Khatheeb", "Muazzin", "Khadim", "Madrasa Teacher", "Accountant", "Cleaner", "Security", "Other"]),
    get: () => Promise.resolve(null),
    create: () => Promise.resolve({ success: true }),
    update: () => Promise.resolve({ success: true }),
    setStatus: () => Promise.resolve({ success: true }),
    restore: () => Promise.resolve({ success: true }),
    history: () => Promise.resolve([]),
    listPayments: () => Promise.resolve({ rows: [], total: 0 }),
    salarySummary: () => Promise.resolve({}),
    paySalary: () => Promise.resolve({ success: true }),
    cancelPayment: () => Promise.resolve({ success: true }),
  };

  // App info (Settings → About) — preview-safe stub.
  const app = {
    info: () => Promise.resolve({ version: "dev-preview", electron: "-", platform: "browser", dataDir: "(preview mode — no data folder)" }),
  };

  // Monthly GitHub update check (UpdateBanner + Settings → About). Append
  // ?upd=1 to the preview URL to simulate "a new release is available" so the
  // banner/dismiss flow can be QA'd without touching the network.
  const updSimulated = new URLSearchParams(window.location.search).get("upd") === "1";
  const updDlUrl = "https://github.com/kuttappu507/minzmahallu-electron/releases/download/v9.9.9/Minz.Mahallu.Setup.9.9.9.exe";
  const updates = {
    status: () => Promise.resolve(updSimulated
      ? { currentVersion: "dev-preview", lastCheckAt: Date.now(), updateAvailable: true, latestVersion: "9.9.9", url: "https://github.com/kuttappu507/minzmahallu-electron/releases/latest", downloadUrl: updDlUrl }
      : { currentVersion: "dev-preview", lastCheckAt: null, updateAvailable: false, latestVersion: null, url: "https://github.com/kuttappu507/minzmahallu-electron/releases/latest", downloadUrl: null }),
    checkNow: () => Promise.resolve(updSimulated
      ? { ok: true, updateAvailable: true, latestVersion: "9.9.9", currentVersion: "dev-preview", url: "https://github.com/kuttappu507/minzmahallu-electron/releases/latest", downloadUrl: updDlUrl }
      : { ok: true, updateAvailable: false, latestVersion: "dev-preview", currentVersion: "dev-preview", url: "https://github.com/kuttappu507/minzmahallu-electron/releases/latest", downloadUrl: null }),
    openReleasePage: () => Promise.resolve({ success: true }),
    openDownload: () => Promise.resolve({ success: updSimulated }),
  };

  // Push-event surface (real app: ipcRenderer.on). Subscribers return an
  // unsubscribe function — the UpdateBanner cleanup calls it.
  const events = {
    onDownloadFailed: (_cb: (name: string) => void) => () => {},
    onUpdateAvailable: (_cb: (info: { latestVersion: string; url: string; downloadUrl?: string | null; currentVersion: string }) => void) => () => {},
  };

  // Donations module used by Settings (category manager) — the Proxy fallback
  // returns a bare function for unknown modules, so `window.mms.donations
  // .categoriesAll()` would crash the Settings page in preview mode.
  const donationCats = [
    { id: 1, name: "Zakath", description: "Annual zakath", is_active: 1, donation_count: 4 },
    { id: 2, name: "Masjid Fund", description: "", is_active: 1, donation_count: 2 },
    { id: 3, name: "Library", description: "Old library fund", is_active: 0, donation_count: 0 },
  ];
  const donations = {
    categoriesAll: () => Promise.resolve(donationCats),
    categories: () => Promise.resolve(donationCats.filter((c) => c.is_active)),
    createCategory: () => Promise.resolve({ success: true }),
    updateCategory: () => Promise.resolve({ success: true }),
    setCategoryActive: () => Promise.resolve({ success: true }),
    removeCategory: () => Promise.resolve({ success: true }),
    memberBalance: () => Promise.resolve(0),
    totalThisMonth: () => Promise.resolve(0),
  };

  // Backup module used by Settings (mirror folder picker).
  const backup = {
    create: () => Promise.resolve({ success: true, cancelled: false, path: "" }),
    list: () => Promise.resolve({ backups: [] }),
    verify: () => Promise.resolve({ success: true }),
    restore: () => Promise.resolve({ success: false, error: "Preview mode" }),
    chooseMirrorDir: () => Promise.resolve({ success: true, cancelled: true }),
  };

  // Tokens module (token events + distribution) — without it `window.mms
  // .tokens` resolves through the Proxy fallback to a bare function and any
  // `.tokens.X()` call crashes the page in preview mode.
  const previewEvents = [{
    id: 1, event_name: "Annual General Body", event_type: "general",
    event_date: "2027-01-10", event_time: "10:00", venue: "Mahallu Hall",
    description: "", status: "ACTIVE",
  }];
  const mkTokenRow = (i: number, familyId: number, status: string) => ({
    id: i, event_id: 1, family_id: familyId,
    token_code: `TKN-2026-${String(i).padStart(4, "0")}`, status,
    collected_at: status === "COLLECTED" ? "2026-01-05" : null,
    created_at: "2026-01-01", family_number: `F-${100 + familyId}`,
    house_name: `House of family ${familyId}`, house_number: `HN-${familyId}`,
    ward: familyId % 2 ? "Ward A" : "Ward B", phone: "98470000" + familyId,
  });
  const previewTokenRows = [
    mkTokenRow(1, 11, "GENERATED"), mkTokenRow(2, 12, "COLLECTED"),
    mkTokenRow(3, 13, "GENERATED"), mkTokenRow(4, 14, "CANCELLED"),
    mkTokenRow(5, 15, "GENERATED"),
  ];
  const tokens = {
    listEvents: () => Promise.resolve(previewEvents),
    getEvent: (id: number) => Promise.resolve(previewEvents.find((e) => e.id === id) || previewEvents[0]),
    createEvent: () => Promise.resolve({ success: true, id: 2 }),
    updateEvent: () => Promise.resolve({ success: true }),
    removeEvent: () => Promise.resolve({ success: true, deletedTokens: 0 }),
    list: () => Promise.resolve({ rows: previewTokenRows }),
    checkExisting: () => Promise.resolve([11, 12]),
    generate: (_id: number, fs: number[]) => Promise.resolve({ generated: fs.length, skipped: 0 }),
    collect: () => Promise.resolve({ success: true }),
    cancel: () => Promise.resolve({ success: true }),
    replace: () => Promise.resolve({ success: true, tokenCode: "TKN-2026-0099" }),
    remove: () => Promise.resolve({ success: true }),
    stats: () => Promise.resolve({ total: previewTokenRows.length, collected: 1, remaining: previewTokenRows.length - 1, rate: 20 }),
    listForPdf: () => Promise.resolve(previewTokenRows),
    generateTokenPdf: () => Promise.resolve({ success: true, count: previewTokenRows.length }),
    generateCollectionSheet: () => Promise.resolve({ success: true, count: previewTokenRows.length }),
  };

  // Families list used by the token family picker (startSelection).
  const mkFamily = (id: number, ward: string) => ({
    id, family_number: `F-${100 + id}`, house_name: `House of family ${id}`,
    house_number: `HN-${id}`, ward, phone: "98470000" + id,
    status: "Active", member_count: 4,
  });
  const families = {
    list: () => Promise.resolve({
      rows: [mkFamily(11, "Ward A"), mkFamily(12, "Ward B"), mkFamily(13, "Ward A"), mkFamily(14, "Ward B"), mkFamily(15, "Ward A")],
    }),
  };
  /* Unknown MODULES (mms.members, mms.marriages, …) used to fall back to one
   * bare function, so `mms.members.list()` threw "not a function" and every
   * page using the generic useList hook logged console errors in preview.
   * Modules must themselves be callable namespaces: return a callable Proxy
   * whose methods answer the same safe defaults as the top-level heuristic.
   * Explicitly mocked modules are ALSO wrapped (withLoose) so a page calling
   * a real bridge method the mock didn't stub (e.g. certificates.list) gets
   * a safe empty answer instead of "not a function" — production preload
   * exposes it, so preview should behave the same. */
  const looseMethod = (name: string) => {
    const n = name.toLowerCase();
    if (/list|rows|items|history|activity|search|positions|types|categories|notifications|backups|events|payments/.test(n)) {
      return () => Promise.resolve([]);
    }
    return (...args: unknown[]) => Promise.resolve({ success: true });
  };
  const withLoose = <T extends object>(mod: T): any => new Proxy(mod, {
    get(t, p) {
      if (p === "then") return undefined; // avoid thenable detection
      if (p in t) return (t as any)[p];
      return looseMethod(String(p));
    },
  });
  const looseModule = (): any => {
    const fn: any = (...args: unknown[]) => Promise.resolve({ success: true });
    return new Proxy(fn, { get(_t, p) { if (p === "then") return undefined; return looseMethod(String(p)); } });
  };

  const base: Record<string, unknown> = { dashboard: withLoose(dashboard), settings: withLoose(settings), auth: withLoose(auth), win: withLoose(win), uninstall: withLoose(uninstall), accounting: withLoose(accounting), assets: withLoose(assets), certificates: withLoose(mockCertificates), whatsapp: withLoose(whatsapp), receipts: withLoose(receipts), staff: withLoose(staff), app: withLoose(app), updates: withLoose(updates), events: withLoose(events), donations: withLoose(donations), backup: withLoose(backup), tokens: withLoose(tokens), families: withLoose(families) };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (prop === "then") return undefined; // avoid thenable detection
      const key = String(prop);
      if (key in target) return target[key];
      if (typeof window !== "undefined") {
        // Called as mms.<listish>() at top level → same defaults as before;
        // otherwise treat the key as a module namespace.
        const name = key.toLowerCase();
        if (/list|rows|items|history|activity|search|positions|types|categories|notifications|backups|events|payments/.test(name)) {
          return () => Promise.resolve([]);
        }
      }
      return looseModule();
    },
  };

  anyWin.mms = new Proxy(base, handler);
  console.info("[preview-mock] window.mms installed (dev preview only)");
}
