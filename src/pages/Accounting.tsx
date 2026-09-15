import { useEffect, useRef, useState } from "react";
import { Plus, Edit2, Ban, ReceiptText, TrendingUp, TrendingDown, Scale, Eye, Calendar, FileDown, Loader2, History } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Dialog, Input, Label, Select, Textarea, Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { formatCurrency, formatDate, formatDateTime, todayIST } from "@/lib/utils";

interface Transaction {
  id: number;
  receipt_number: string;
  txn_date: string;
  type: string;
  amount: number;
  payment_method: string;
  description: string;
  account_id: number;
  transaction_ref: string;
  voucher_no: string;
  bill_no: string;
  payee: string;
  category?: string;
  asset_id?: number | null;
  linked_module: string;
  linked_id: number;
  created_by_name?: string;
}

interface UnifiedRow {
  source_id: number;
  source: "transactions" | "donations" | "subscriptions" | "welfare" | "salary";
  ledger_date: string;
  type: "Income" | "Expense";
  amount: number;
  description: string;
  payment_method: string;
  transaction_ref: string;
  receipt_number: string;
  voucher_no?: string | null;
  bill_no?: string | null;
  payee?: string | null;
  category?: string | null;
  asset_name?: string | null;
  account_id: number | null;
  linked_module: string | null;
  linked_id: number | null;
  status?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  has_history?: number | null;
}

interface UnifiedSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  incomeDonations: number;
  incomeSubscriptions: number;
  incomeManual: number;
  expenseWelfare: number;
  expenseSalary: number;
  expenseManual: number;
  entryCount: number;
  period: string;
  from: string | null;
  to: string | null;
}

const emptyForm: Partial<Transaction> = {
  receipt_number: "", txn_date: "", type: "Income", amount: 0, payment_method: "Cash",
  description: "", account_id: 1, transaction_ref: "", voucher_no: "", bill_no: "", payee: "", category: "",
  asset_id: null,
  linked_module: "", linked_id: 0,
};

const PERIOD_OPTIONS = [
  { value: "all", key: "filter_all" },
  { value: "this_month", key: "filter_this_month" },
  { value: "last_month", key: "filter_last_month" },
  { value: "this_quarter", key: "filter_this_quarter" },
  { value: "last_quarter", key: "filter_last_quarter" },
  { value: "this_year", key: "filter_this_year" },
  { value: "last_year", key: "filter_last_year" },
  { value: "custom", key: "filter_custom" },
] as const;

const SOURCE_OPTIONS = [
  { value: "All", key: "acc_source_all" },
  { value: "transactions", key: "acc_source_transactions" },
  { value: "donations", key: "acc_source_donations" },
  { value: "subscriptions", key: "acc_source_subscriptions" },
  { value: "welfare", key: "acc_source_welfare" },
  { value: "salary", key: "acc_source_salary" },
] as const;

function sourceBadgeVariant(source: UnifiedRow["source"]): string {
  switch (source) {
    case "donations": return "success";
    case "subscriptions": return "info";
    case "welfare": return "warning";
    case "salary": return "muted";
    default: return "default";
  }
}

/** Friendly labels for the fields shown in the double-click preview. */
const PREVIEW_FIELD_LABELS: Record<string, { en: string; ml: string }> = {
  txn_date: { en: "Date", ml: "തീയതി" },
  type: { en: "Type", ml: "തരം" },
  amount: { en: "Amount", ml: "തുക" },
  payment_method: { en: "Payment method", ml: "പേയ്മെന്റ് രീതി" },
  description: { en: "Description", ml: "വിവരണം" },
  category: { en: "Category", ml: "വിഭാഗം" },
  payee: { en: "Paid to (Payee)", ml: "സ്വീകർത്താവ് (Payee)" },
  voucher_no: { en: "Voucher No.", ml: "വൗച്ചർ നമ്പർ" },
  bill_no: { en: "Bill / Invoice No.", ml: "ബിൽ / ഇൻവോയ്സ് നമ്പർ" },
  transaction_ref: { en: "Reference", ml: "റഫറൻസ്" },
  receipt_number: { en: "Receipt No.", ml: "രസീത് നമ്പർ" },
  account_id: { en: "Account", ml: "അക്കൗണ്ട്" },
  amount_paid: { en: "Amount paid", ml: "അടച്ച തുക" },
  status: { en: "Status", ml: "നില" },
  remarks: { en: "Remarks", ml: "കുറിപ്പുകൾ" },
  purpose: { en: "Purpose", ml: "ആവശ്യം" },
};

/** Parse a changes JSON string ({field:{old,new}}) defensively. */
function parseChanges(json: string | null | undefined): Record<string, { old: unknown; new: unknown }> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
  } catch { /* legacy rows carry plain text */ }
  return null;
}

/** Category suggestions for manual ledger entries — Malayalam-aware and
 *  themed (a native datalist popup can't be styled and shows English only).
 *  The stored value stays the English name so reports/exports stay stable;
 *  the dropdown shows the app language with the other language as a hint. */
const TXN_CATEGORIES: Record<string, { en: string; ml: string }[]> = {
  Income: [
    { en: "Shop Rent", ml: "കട വാടകം" },
    { en: "Goods Rent", ml: "സാധന വാടകം" },
    { en: "Hall Rent", ml: "ഹാൾ വാടകം" },
    { en: "Parking", ml: "പാർക്കിംഗ്" },
    { en: "Other Income", ml: "മറ്റ് വരവുകൾ" },
  ],
  Expense: [
    { en: "Electricity", ml: "കറണ്ട്" },
    { en: "Water", ml: "വാട്ടർ ബിൽ" },
    { en: "Fuel", ml: "ഇന്ധനം" },
    { en: "Maintenance", ml: "അറ്റകുറ്റപ്പണി" },
    { en: "Stationery", ml: "സ്റ്റേഷനറി" },
    { en: "Conveyance", ml: "യാത്രാ ചെലവ്" },
    { en: "Refreshments", ml: "ചായ-പലഹാരം" },
    { en: "Other Expense", ml: "മറ്റ് ചെലവുകൾ" },
  ],
};

export function Accounting() {
  const { t, isMalayalam } = useI18n();
  const tx = (en: string, ml: string) => isMalayalam() ? ml : en;

  // Unified ledger state.
  const [period, setPeriod] = useState<string>("this_month");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [customOpen, setCustomOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<UnifiedSummary | null>(null);

  // Manual transaction dialog (still uses legacy list/create/update).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const catWrapRef = useRef<HTMLDivElement | null>(null);
  // Close the themed category dropdown on any click/focus outside it — keeps
  // the Save action reachable and matches normal combobox behaviour.
  useEffect(() => {
    if (!catOpen) return;
    const close = (e: Event) => {
      const wrap = catWrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) setCatOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("focusin", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("focusin", close);
    };
  }, [catOpen]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Transaction>>(emptyForm);
  // Asset register link (V036) — optional asset to tag the entry with.
  const [assetOptions, setAssetOptions] = useState<Array<{ id: number; asset_code: string; name: string }>>([]);
  useEffect(() => { window.mms.assets?.options?.().then((o: any[]) => setAssetOptions(o || [])).catch(() => setAssetOptions([])); }, []);
  // VOID workflow: entries are never deleted — they are voided with a reason.
  // Both EDIT and VOID of ledger entries are gated by the SecureActionDialog
  // (reason + administrator password, re-verified in the main process).
  const [voidGateOpen, setVoidGateOpen] = useState(false);
  const [pendingVoidId, setPendingVoidId] = useState<number | null>(null);
  const [editGateOpen, setEditGateOpen] = useState(false);
  const [pendingEditId, setPendingEditId] = useState<number | null>(null);
  const [editAuth, setEditAuth] = useState<{ password: string; reason: string } | null>(null);
  // Receipt sequence continuity check.
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [receiptsData, setReceiptsData] = useState<any>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  // Double-click preview: full record + change history for one ledger row.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<UnifiedRow | null>(null);
  const [previewDetail, setPreviewDetail] = useState<{ record: any; changes: any[]; auditTrail: any[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  const fetchUnified = async () => {
    setLoading(true);
    try {
      const filter: any = { period, source: sourceFilter, type: typeFilter, search: search || undefined, page, pageSize: 20 };
      if (period === "custom") {
        if (!from || !to) { setLoading(false); return; }
        filter.from = from; filter.to = to;
      }
      const [listRes, sumRes] = await Promise.all([
        window.mms.accounting.unifiedList(filter),
        window.mms.accounting.unifiedSummary({ period, from: period === "custom" ? from : undefined, to: period === "custom" ? to : undefined })
      ]);
      setRows(listRes.rows || []);
      setTotal(listRes.total || 0);
      setSummary(sumRes);
    } catch (e: any) {
      toast.error(e.message || tx("Failed to load ledger", "ലെഡ്ജർ ലോഡ് ചെയ്യാനായില്ല"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUnified(); }, [period, sourceFilter, typeFilter, page, from, to]);

  // Manual transaction save (calls the legacy create/update endpoints).
  const openAdd = (type: "Income" | "Expense") => {
    setForm({ ...emptyForm, type, txn_date: todayIST() });
    setEditingId(null);
    setEditAuth(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.amount || !form.txn_date) {
      toast.error(t("ui_amount_date_required"));
      return;
    }
    try {
      const payload: any = {
        txnDate: form.txn_date,
        accountId: form.account_id || 1,
        type: form.type,
        amount: form.amount,
        paymentMethod: form.payment_method || "Cash",
        description: form.description || "",
        linkedModule: form.linked_module || "",
        linkedId: form.linked_id || null,
        receiptNumber: form.receipt_number || "",
        transactionRef: form.transaction_ref || "",
        voucherNo: form.voucher_no || "",
        billNo: form.bill_no || "",
        payee: form.payee || "",
        category: form.category || "",
        assetId: form.asset_id || null,
        createdBy: 1,
      };
      if (editingId) {
        // Backend re-verifies the administrator password and requires the reason.
        await window.mms.accounting.update(editingId, payload, editAuth?.password || "", editAuth?.reason || "");
        toast.success(t("ui_save_changes"));
      } else {
        const res = await window.mms.accounting.create(payload);
        if (res?.duplicateBill) {
          toast.warning(
            tx(
              `Bill no. "${form.bill_no}" was already used on ${formatDate(res.duplicateBill.txn_date)} (${formatCurrency(res.duplicateBill.amount)}). Please verify this is not a duplicate payment.`,
              `ബിൽ നമ്പർ "${form.bill_no}" ${formatDate(res.duplicateBill.txn_date)}-ന് ഇതിനകം ഉപയോഗിച്ചിട്ടുണ്ട് (${formatCurrency(res.duplicateBill.amount)}). ഇത് തനിപ്പകർപ്പ് പേയ്മെന്റ് അല്ലെന്ന് ഉറപ്പാക്കുക.`
            )
          );
        }
        toast.success(t("add_transaction"));
      }
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      setEditAuth(null);
      fetchUnified();
    } catch (err: any) {
      toast.error(err.message || t("ui_failed_save"));
    }
  };

  // Editing a ledger entry is gated: SecureActionDialog collects a reason and
  // the administrator password (re-verified in the main process) BEFORE the
  // edit form opens, and both travel with the save request.
  const handleEdit = (id: number) => {
    setPendingEditId(id);
    setEditGateOpen(true);
  };

  const performEdit = async ({ password, reason }: { password: string; reason: string }) => {
    if (pendingEditId == null) return;
    // Only 'transactions' source rows are editable from this UI.
    const txn = await window.mms.accounting.get(pendingEditId);
    setForm(txn || emptyForm);
    setEditingId(pendingEditId);
    setEditAuth({ password, reason });
    setDialogOpen(true);
  };

  const openVoid = (id: number) => {
    setPendingVoidId(id);
    setVoidGateOpen(true);
  };

  const confirmVoid = async ({ reason, password }: { reason: string; password: string }) => {
    if (pendingVoidId == null) return;
    // Backend re-verifies the administrator password; errors propagate to the
    // SecureActionDialog which shows them.
    await window.mms.accounting.void(pendingVoidId, reason, password);
    toast.success(tx("Entry voided — kept for audit", "എൻട്രി റദ്ദാക്കി — ഓഡിറ്റിനായി സൂക്ഷിച്ചു"));
    setPendingVoidId(null);
    fetchUnified();
  };

  const fetchReceipts = async () => {
    try {
      setReceiptsData(await window.mms.accounting.receiptSequence());
      setReceiptsOpen(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Double-click (or eye button) opens the full preview of a ledger entry —
  // including every recorded edit: what changed, who changed it, when and why.
  const openPreview = async (row: UnifiedRow) => {
    setPreviewRow(row);
    setPreviewDetail(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      setPreviewDetail(await window.mms.accounting.detail(row.source, row.source_id));
    } catch (e: any) {
      toast.error(e.message || tx("Could not load entry details", "എൻട്രി വിവരങ്ങൾ ലോഡ് ചെയ്യാനായില്ല"));
    } finally {
      setPreviewLoading(false);
    }
  };

  // Export handlers — both respect the current period/source/type filters.
  const buildExportFilter = () => {
    const filter: any = { period, source: sourceFilter, type: typeFilter };
    if (period === "custom") { filter.from = from; filter.to = to; }
    return filter;
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const result = await window.mms.accounting.exportPdf(buildExportFilter());
      if (result?.success) toast.success(tx(`PDF exported (${result.count} entries) — saved to ${result.path ?? ""}`, `${result.count} രേഖകളുടെ PDF തയ്യാറാക്കി — ${result.path ?? ""}`));
      else if (!result?.cancelled) toast.error(result?.error || tx("Failed to export PDF", "PDF തയ്യാറാക്കാൻ കഴിഞ്ഞില്ല"));
    } catch (e: any) { toast.error(e.message); }
    finally { setExportingPdf(false); }
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const result = await window.mms.accounting.exportExcel(buildExportFilter());
      if (result?.success) toast.success(tx(`Excel exported (${result.count} entries) — saved to ${result.path ?? ""}`, `${result.count} രേഖകളുടെ എക്സൽ തയ്യാറാക്കി — ${result.path ?? ""}`));
      else if (!result?.cancelled) toast.error(result?.error || tx("Failed to export Excel", "എക്സൽ തയ്യാറാക്കാൻ കഴിഞ്ഞില്ല"));
    } catch (e: any) { toast.error(e.message); }
    finally { setExportingExcel(false); }
  };

  const columns: Column<UnifiedRow>[] = [
    { header: tx("Date", "തീയതി"), accessor: r => formatDate(r.ledger_date), width: "120px" },
    {
      header: t("acc_source"),
      accessor: r => <Badge variant={sourceBadgeVariant(r.source)}>{t(`acc_source_${r.source}`)}</Badge>,
      width: "120px"
    },
    {
      header: t("acc_type"),
      accessor: r => <Badge variant={r.type === "Income" ? "success" : "danger"}>{t(r.type === "Income" ? "acc_income" : "acc_expense")}</Badge>,
      width: "100px"
    },
    { header: t("acc_description"), accessor: r => (
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium ${r.status === "Void" ? "line-through text-muted" : ""}`}>{r.description || "—"}</span>
          {!!r.has_history && r.status !== "Void" && (
            <span title={tx("This entry was edited — double-click to see the change history", "ഈ എൻട്രി തിരുത്തപ്പെട്ടിട്ടുണ്ട് — മാറ്റങ്ങൾ കാണാൻ ഇരട്ട ക്ലിക്ക് ചെയ്യുക")}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 whitespace-nowrap">
              {tx("EDITED", "തിരുത്തി")}
            </span>
          )}
        </div>
        {r.status === "Void" && r.void_reason && (
          <div className="text-xs text-rose-600/80 italic mt-0.5">{tx("Voided:", "റദ്ദാക്കി:")} {r.void_reason}{r.voided_at ? ` · ${formatDate(r.voided_at)}` : ""}</div>
        )}
      </div>
    ) },
    {
      header: tx("Category", "വിഭാഗം"),
      accessor: r => (
        <div className="flex flex-col items-start gap-1">
          {r.category ? <span className="text-xs px-2 py-0.5 rounded-full bg-surface-hover whitespace-nowrap">{r.category}</span> : <span className="text-muted">—</span>}
          {r.asset_name && (
            <span title={tx("Linked to an asset in the Asset Register", "ആസ്തി രജിസ്റ്ററിലെ ആസ്തിയുമായി ബന്ധിപ്പിച്ചിരിക്കുന്നു")} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-400 border border-teal-500/30 whitespace-nowrap">{r.asset_name}</span>
          )}
        </div>
      ),
      width: "150px"
    },
    {
      header: tx("Receipt", "രസീത്"),
      accessor: r => r.receipt_number ? <span className="code-text-sm text-primary">{r.receipt_number}</span> : "—",
      width: "120px"
    },
    {
      header: tx("Voucher", "വൗച്ചർ"),
      accessor: r => (
        <div className="flex flex-col">
          {r.voucher_no ? <span className="code-text-sm text-primary">{r.voucher_no}</span> : <span className="text-muted">—</span>}
          {r.bill_no && <span className="text-xs text-muted">{tx("Bill", "ബിൽ")}: {r.bill_no}</span>}
          {r.payee && <span className="text-xs text-muted">{r.payee}</span>}
        </div>
      ),
      width: "150px"
    },
    {
      header: t("sub_amount"),
      accessor: r => (
        <span className={r.type === "Income" ? "text-emerald-600 font-medium" : "text-rose-600 font-medium"}>
          {r.type === "Income" ? "+" : "−"}{formatCurrency(r.amount)}
        </span>
      ),
      width: "140px"
    },
    {
      header: "",
      accessor: r => r.source === "transactions" ? (
        <div className="flex items-center gap-1 justify-end">
          {r.status === "Void" ? (
            <span title={r.void_reason ? `${tx("Void reason", "റദ്ദാക്കാനുള്ള കാരണം")}: ${r.void_reason}` : ""}><Badge variant="danger">{tx("VOID", "റദ്ദാക്കി")}</Badge></span>
          ) : (
            <>
              <button className="act-btn act-edit" onClick={() => handleEdit(r.source_id)} title={t("action_edit")}><Edit2 className="h-4 w-4" /></button>
              <button className="act-btn act-del" onClick={() => openVoid(r.source_id)} title={tx("Void (keep for audit)", "റദ്ദാക്കുക (ഓഡിറ്റിനായി സൂക്ഷിക്കും)")}><Ban className="h-4 w-4 text-danger" /></button>
            </>
          )}
          <button className="act-btn" onClick={() => openPreview(r)} title={tx("View details & history", "വിവരങ്ങളും ചരിത്രവും കാണുക")}><Eye className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="flex items-center gap-1 justify-end">
          <span className="text-xs text-muted">{tx("auto", "ഓട്ടോ")}</span>
          <button className="act-btn" onClick={() => openPreview(r)} title={tx("View details & history", "വിവരങ്ങളും ചരിത്രവും കാണുക")}><Eye className="h-4 w-4" /></button>
        </div>
      ),
      align: "right",
      width: "130px"
    },
  ];

  const periodLabel = (p: string): string => {
    const opt = PERIOD_OPTIONS.find(o => o.value === p);
    return opt ? t(opt.key) : p;
  };

  const rangeLabel = summary?.from && summary?.to ? `${formatDate(summary.from)} → ${formatDate(summary.to)}` : (summary?.period === "all" ? tx("All time", "എല്ലാ കാലവും") : "");

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em"><Scale size={20} /></div>
        <div>
          <h1>{t("acc_unified_title")}</h1>
          <div className="vs">{t("acc_unified_subtitle")}{rangeLabel ? ` · ${rangeLabel}` : ""}</div>
        </div>
        <div className="vr">
          <Button variant="secondary" onClick={handleExportPdf} disabled={exportingPdf}>
            {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {tx("Export PDF", "PDF എക്സ്പോർട്ട്")}
          </Button>
          <Button variant="secondary" onClick={handleExportExcel} disabled={exportingExcel}>
            {exportingExcel ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {tx("Export Excel", "എക്സൽ എക്സ്പോർട്ട്")}
          </Button>
          <Button onClick={() => openAdd("Income")}><Plus className="h-4 w-4" />{t("acc_add_income")}</Button>
          <Button variant="danger" onClick={() => openAdd("Expense")}><Plus className="h-4 w-4" />{t("acc_add_expense")}</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-grid stat-grid-3">
        <div className="stat t-em">
          <div className="srow">
            <span className="sic"><TrendingUp size={18} /></span>
            <span className="delta">{t("acc_income_delta")}</span>
          </div>
          <div className="val">{formatCurrency(summary?.totalIncome ?? 0)}</div>
          <div className="slab">{t("acc_income")} · {periodLabel(period)}</div>
        </div>
        <div className="stat t-rose">
          <div className="srow">
            <span className="sic"><TrendingDown size={18} /></span>
            <span className="delta">{t("acc_expense_delta")}</span>
          </div>
          <div className="val">{formatCurrency(summary?.totalExpense ?? 0)}</div>
          <div className="slab">{t("acc_expense")} · {periodLabel(period)}</div>
        </div>
        <div className="stat t-sky">
          <div className="srow">
            <span className="sic"><Scale size={18} /></span>
            <span className="delta">{t("acc_balance_delta")}</span>
          </div>
          <div className="val">{formatCurrency(summary?.balance ?? 0)}</div>
          <div className="slab">{t("acc_balance")} · {periodLabel(period)}</div>
        </div>
      </div>

      {/* Source breakdown card — two high-contrast panels with share bars.
          Labels and amounts are deliberately bold, full-contrast and set in
          the UI font (NOT thin mono/muted text) so they read at a glance. */}
      {summary && (
        <div className="card card-pad-tight mt-3">
          <div className="ch-head mb-3">
            <div className="ch-title">{t("acc_breakdown")}</div>
            <div className="text-xs font-medium text-text-secondary">{rangeLabel || periodLabel(period)}</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Income panel */}
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 text-sm font-bold tracking-wide text-emerald-700 dark:text-emerald-300 uppercase">
                  <TrendingUp size={16} strokeWidth={2.5} />{t("acc_income")}
                </span>
                <span className="text-base font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(summary.totalIncome)}</span>
              </div>
              <div className="space-y-3">
                {([
                  { label: t("acc_income_donations"), value: summary.incomeDonations },
                  { label: t("acc_income_subscriptions"), value: summary.incomeSubscriptions },
                  { label: t("acc_income_manual"), value: summary.incomeManual },
                ] as const).map(item => {
                  const pct = summary.totalIncome > 0 ? Math.max(0, Math.min(100, Math.round((item.value / summary.totalIncome) * 100))) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-text-primary">{item.label}</span>
                        <span className="text-sm font-bold text-text-primary tabular-nums">{formatCurrency(item.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-emerald-500/15 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Expense panel */}
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="inline-flex items-center gap-2 text-sm font-bold tracking-wide text-rose-700 dark:text-rose-300 uppercase">
                  <TrendingDown size={16} strokeWidth={2.5} />{t("acc_expense")}
                </span>
                <span className="text-base font-bold text-rose-700 dark:text-rose-300 tabular-nums">{formatCurrency(summary.totalExpense)}</span>
              </div>
              <div className="space-y-3">
                {([
                  { label: t("acc_expense_welfare"), value: summary.expenseWelfare },
                  { label: t("acc_expense_salary"), value: summary.expenseSalary },
                  { label: t("acc_expense_manual"), value: summary.expenseManual },
                ] as const).map(item => {
                  const pct = summary.totalExpense > 0 ? Math.max(0, Math.min(100, Math.round((item.value / summary.totalExpense) * 100))) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-text-primary">{item.label}</span>
                        <span className="text-sm font-bold text-text-primary tabular-nums">{formatCurrency(item.value)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-rose-500/15 overflow-hidden">
                        <div className="h-full rounded-full bg-rose-500/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        total={total}
        page={page}
        pageSize={20}
        totalPages={totalPages}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        rowKey={r => `${r.source}-${r.source_id}`}
        onRowDoubleClick={openPreview}
        toolbar={
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={period} onChange={e => { const v = e.target.value; setPeriod(v); setPage(1); if (v === "custom") setCustomOpen(true); }} className="w-40">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
            <Select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }} className="w-44">
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
            <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }} className="w-32">
              <option value="All">{t("filter_all")}</option>
              <option value="Income">{t("acc_income")}</option>
              <option value="Expense">{t("acc_expense")}</option>
            </Select>
            {period === "custom" && (
              <Button variant="secondary" onClick={() => setCustomOpen(true)}><Calendar size={14} />{rangeLabel || tx("Set dates", "തീയതികൾ സജ്ജമാക്കുക")}</Button>
            )}
            <Button variant="secondary" onClick={fetchReceipts}><ReceiptText size={14} />{tx("Receipts", "രസീതുകൾ")}</Button>
          </div>
        }
      />

      {/* Add/Edit Transaction Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? t("action_edit") : (form.type === "Income" ? t("acc_add_income") : t("acc_add_expense"))}
        className="max-w-xl"
      >
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("don_date")} *</Label>
              <Input type="date" value={form.txn_date || ""} onChange={(e) => setForm({ ...form, txn_date: e.target.value })} />
            </div>
            <div>
              <Label>{t("acc_type")}</Label>
              <Select value={form.type || "Income"} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="Income">{t("acc_income")}</option>
                <option value="Expense">{t("acc_expense")}</option>
              </Select>
            </div>
            <div>
              <Label>{t("sub_amount")} *</Label>
              <Input type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t("sub_method")}</Label>
              <Select value={form.payment_method || "Cash"} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                <option value="Cash">{t("payment_cash")}</option>
                <option value="Cheque">{t("payment_cheque")}</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">{t("payment_bank_transfer")}</option>
                <option value="Card">{t("payment_card")}</option>
                <option value="Other">{t("payment_other")}</option>
              </Select>
            </div>
            <div className="relative" ref={catWrapRef}>
              <Label>{tx("Category", "വിഭാഗം")}</Label>
              <Input
                value={form.category || ""}
                onChange={(e) => { setForm({ ...form, category: e.target.value }); setCatOpen(true); }}
                onFocus={() => setCatOpen(true)}
                onKeyDown={(e) => { if (e.key === "Escape") setCatOpen(false); }}
                placeholder={form.type === "Income" ? tx("e.g. Shop Rent, Goods Rent", "ഉദാ: കട വാടകം, സാധന വാടകം") : tx("e.g. Electricity, Maintenance", "ഉദാ: കറണ്ട്, അറ്റകുറ്റപ്പണി")}
              />
              {dialogOpen && catOpen && (() => {
                const q = String(form.category || "").toLowerCase();
                const opts = (TXN_CATEGORIES[form.type === "Expense" ? "Expense" : "Income"] || [])
                  .filter((c) => !q || c.en.toLowerCase().includes(q) || c.ml.includes(String(form.category || "")));
                return opts.length ? (
                  <div className="absolute z-30 left-0 right-0 mt-1 max-h-52 overflow-auto rounded-lg border border-border bg-surface shadow-lg" onMouseDown={(e) => e.preventDefault()}>
                    {opts.map((c) => (
                      <button
                        key={c.en}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover flex items-baseline justify-between gap-2"
                        onMouseDown={(e) => { e.preventDefault(); setForm({ ...form, category: c.en }); setCatOpen(false); }}
                      >
                        <span className="font-medium">{tx(c.en, c.ml)}</span>
                        <span className="text-xs text-muted whitespace-nowrap">{tx(c.ml, c.en)}</span>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
            <div>
              <Label>{tx("Asset (optional)", "ആസ്തി (ഓപ്ഷണൽ)")}</Label>
              <Select value={form.asset_id ? String(form.asset_id) : ""} onChange={e => setForm({ ...form, asset_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{tx("— Not linked to an asset —", "— ആസ്തിയുമായി ബന്ധമില്ല —")}</option>
                {assetOptions.map(a => <option key={a.id} value={a.id}>{a.asset_code} · {a.name}</option>)}
              </Select>
              <div className="text-xs text-muted mt-1">{tx("Tag rent collections and repair bills with the building/land they belong to.", "വാടാക്ക വാങ്ങലുകളും അറ്റകുറ്റി ബില്ലുകളും അതത് കെട്ടിടത്തുമായി / ഭൂമിയുമായി ബന്ധിപ്പിക്കുക.")}</div>
            </div>
            <div>
              <Label>{t("ui_transaction_ref")}</Label>
              <Input value={form.transaction_ref || ""} onChange={(e) => setForm({ ...form, transaction_ref: e.target.value })} />
            </div>
            {form.type === "Expense" && (
              <>
                <div>
                  <Label>{tx("Voucher No.", "വൗച്ചർ നമ്പർ")}</Label>
                  <Input value={form.voucher_no || ""} onChange={(e) => setForm({ ...form, voucher_no: e.target.value })} placeholder={tx("auto-filled if empty", "ശൂന്യമാണെങ്കിൽ സ്വയം നൽകും")} />
                </div>
                <div>
                  <Label>{tx("Bill / Invoice No.", "ബിൽ / ഇൻവോയ്സ് നമ്പർ")}</Label>
                  <Input value={form.bill_no || ""} onChange={(e) => setForm({ ...form, bill_no: e.target.value })} placeholder={tx("e.g. shop bill no.", "ഉദാ: കടയുടെ ബിൽ നമ്പർ")} />
                </div>
                <div className="col-span-2">
                  <Label>{tx("Paid to (Payee)", "സ്വീകർത്താവ് (Payee)")}</Label>
                  <Input value={form.payee || ""} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder={tx("Who was this payment made to?", "ആർക്കാണ് ഈ പണം നൽകിയത്?")} />
                </div>
                <p className="col-span-2 text-xs text-muted">{tx("Voucher & bill numbers are kept for audit — no files need to be uploaded.", "ഓഡിറ്റിനായി വൗച്ചർ, ബിൽ നമ്പറുകൾ സൂക്ഷിക്കും — ഫയലുകൾ അപ്‌ലോഡ് ചെയ്യേണ്ടതില്ല.")}</p>
              </>
            )}
          </div>
          <div>
            <Label>{t("acc_description")}</Label>
            <Textarea rows={3} value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={handleSave}>{t("action_save")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Custom date range dialog */}
      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} title={t("filter_custom")} className="modal-sm">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("filter_from")} *</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>{t("filter_to")} *</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCustomOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={() => { if (!from || !to) { toast.error(tx("Select both dates", "രണ്ട് തീയതികളും തിരഞ്ഞെടുക്കുക")); return; } setCustomOpen(false); setPage(1); fetchUnified(); }}>{t("filter_apply")}</Button>
          </div>
        </div>
      </Dialog>

      {/* VOID gate — reason + administrator password, re-verified in main process */}
      <SecureActionDialog
        open={voidGateOpen}
        onClose={() => setVoidGateOpen(false)}
        onConfirm={confirmVoid}
        title={tx("Void ledger entry", "ലെഡ്ജർ എൻട്രി റദ്ദാക്കുക")}
        description={tx("The entry is kept for audit (marked VOID). Voiding reverses a financial record — your password and reason are written to the audit log.", "എൻട്രി ഓഡിറ്റിനായി സൂക്ഷിക്കും (VOID അടയാളം). സാമ്പത്തിക രേഖ റദ്ദാക്കുന്നതിനാൽ നിങ്ങളുടെ പാസ്‌വേഡും കാരണവും ഓഡിറ്റ് ലോഗിൽ രേഖപ്പെടുത്തും.")}
        reasonPlaceholder={tx("Why is this entry being voided?", "എന്തുകൊണ്ടാണ് ഈ എൻട്രി റദ്ദാക്കുന്നത്?")}
        confirmLabel={tx("Void entry", "എൻട്രി റദ്ദാക്കുക")}
      />

      {/* EDIT gate — reason + administrator password before the edit form opens */}
      <SecureActionDialog
        open={editGateOpen}
        onClose={() => setEditGateOpen(false)}
        onConfirm={performEdit}
        danger={false}
        title={tx("Edit ledger entry", "ലെഡ്ജർ എൻട്രി തിരുത്തുക")}
        description={tx("Editing recorded income/expense is restricted to administrators. Your password and reason are written to the audit log.", "രേഖപ്പെടുത്തിയ വരവ്/ചെലവ് തിരുത്ത് അഡ്മിനിസ്ട്രേറ്റർമാർക്ക് മാത്രമാണ്. നിങ്ങളുടെ പാസ്‌വേഡും കാരണവും ഓഡിറ്റ് ലോഗിൽ രേഖപ്പെടുത്തും.")}
        reasonPlaceholder={tx("Why is this entry being edited?", "എന്തുകൊണ്ടാണ് ഈ എൻട്രി തിരുത്തുന്നത്?")}
        confirmLabel={tx("Continue to edit", "തിരുത്താൻ തുടരുക")}
      />

      {/* Double-click preview — full entry details + the complete change history */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title={tx("Entry details", "എൻട്രി വിവരങ്ങൾ")} className="max-w-2xl">
        <div className="p-6 space-y-4">
          {previewLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />{tx("Loading…", "ലോഡ് ചെയ്യുന്നു…")}</div>
          )}
          {!previewLoading && previewRow && (() => {
            const rec = previewDetail?.record || {};
            const isTxn = previewRow.source === "transactions";
            // Merge record_history diffs + audit trail into one newest-first timeline.
            type HistEntry = { key: string; when: string; who: string; action: string; summary: string; reason: string; changes: Record<string, { old: unknown; new: unknown }> | null };
            const entries: HistEntry[] = [];
            const seen = new Set<string>();
            for (const c of previewDetail?.changes || []) {
              const changes = parseChanges(c.changes_json);
              entries.push({ key: `c${c.id}`, when: String(c.changed_at || ""), who: String(c.username || ""), action: String(c.action || ""), summary: String(c.summary || ""), reason: String(c.reason || ""), changes });
              if (changes) seen.add(`${c.username || ""}|${String(c.changed_at || "").slice(0, 16)}|${JSON.stringify(changes)}`);
            }
            for (const a of previewDetail?.auditTrail || []) {
              const changes = parseChanges(a.metadata);
              const dedupeKey = `${a.username || ""}|${String(a.created_at || "").slice(0, 16)}|${JSON.stringify(changes)}`;
              if (changes && seen.has(dedupeKey)) continue; // same event already recorded with diffs
              entries.push({ key: `a${a.id}`, when: String(a.created_at || ""), who: String(a.username || ""), action: String(a.action || ""), summary: String(a.description || ""), reason: "", changes });
            }
            entries.sort((x, y) => y.when.localeCompare(x.when));
            const labelOf = (f: string) => { const l = PREVIEW_FIELD_LABELS[f]; return l ? tx(l.en, l.ml) : f; };
            const valueOf = (f: string, v: unknown) => {
              if (v == null || v === "") return "—";
              if (f === "amount" || f === "amount_paid") return formatCurrency(Number(v));
              if (f === "txn_date") return formatDate(String(v));
              return String(v);
            };
            const detailRows: [string, React.ReactNode][] = [
              [tx("Source", "ഉറവിടം"), <Badge key="src" variant={sourceBadgeVariant(previewRow.source)}>{t(`acc_source_${previewRow.source}`)}</Badge>],
              [tx("Date", "തീയതി"), formatDate(previewRow.ledger_date)],
              [tx("Type", "തരം"), <Badge key="typ" variant={previewRow.type === "Income" ? "success" : "danger"}>{t(previewRow.type === "Income" ? "acc_income" : "acc_expense")}</Badge>],
              [t("sub_amount"), <span key="amt" className={`font-bold ${previewRow.type === "Income" ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(previewRow.amount)}</span>],
              [tx("Category", "വിഭാഗം"), rec.category_name || previewRow.category || "—"],
              [t("sub_method"), previewRow.payment_method || "—"],
              [tx("Receipt", "രസീത്"), previewRow.receipt_number ? <span key="rc" className="code-text-sm text-primary">{previewRow.receipt_number}</span> : "—"],
              [tx("Voucher No.", "വൗച്ചർ നമ്പർ"), previewRow.voucher_no || "—"],
              [tx("Bill / Invoice No.", "ബിൽ / ഇൻവോയ്സ് നമ്പർ"), previewRow.bill_no || "—"],
              [tx("Paid to (Payee)", "സ്വീകർത്താവ് (Payee)"), previewRow.payee || "—"],
              [t("ui_transaction_ref"), previewRow.transaction_ref || "—"],
            ];
            if (isTxn && rec.created_by_name) detailRows.push([tx("Created by", "സൃഷ്ടിച്ചത്"), rec.created_by_name]);
            if (previewRow.source === "donations" && rec.donor_name) detailRows.push([tx("Donor", "ദാതാവ്"), rec.donor_name]);
            if (previewRow.source === "donations" && (rec.purpose || previewRow.description)) detailRows.push([tx("Purpose", "ആവശ്യം"), rec.purpose || String(previewRow.description || "").replace(/^[^—]*—\s*/, "")]);
            if (previewRow.source === "subscriptions" && rec.house_name) detailRows.push([tx("Family", "കുടുംബം"), `${rec.house_name || ""}${rec.family_number ? ` (${rec.family_number})` : ""}`]);
            if (previewRow.source === "welfare" && rec.applicant_name) detailRows.push([tx("Applicant", "അപേക്ഷകൻ"), rec.applicant_name]);
            if (previewRow.source === "salary" && rec.staff_name) detailRows.push([tx("Staff", "ജീവനക്കാരൻ"), `${rec.staff_name}${rec.staff_code ? ` (${rec.staff_code})` : ""}`]);
            if (previewRow.status === "Void") detailRows.push([tx("Status", "നില"), <Badge key="void" variant="danger">{tx("VOID", "റദ്ദാക്കി")}</Badge>]);
            return (
              <>
                <div className="det-grid">
                  {detailRows.map(([k, v], i) => <div className="det" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>)}
                </div>
                {previewRow.status === "Void" && previewRow.void_reason && (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    <b>{tx("Void reason", "റദ്ദാക്കാനുള്ള കാരണം")}:</b> {previewRow.void_reason}
                  </div>
                )}
                <div className="dlg-sec dlg-sec-inset"><span className="ds-ic"><History size={13} /></span><b>{tx("Change history", "മാറ്റ ചരിത്രം")}</b></div>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {entries.length ? entries.map((h) => (
                    <div key={h.key} className="p-3 rounded-lg border border-border">
                      <div className="flex justify-between gap-3 items-start">
                        <b className="text-sm">{h.action === "EDIT" || h.action === "UPDATE" ? tx("Entry edited", "എൻട്രി തിരുത്തി") : h.summary || h.action}</b>
                        <span className="text-xs text-muted whitespace-nowrap">{formatDateTime(h.when)}</span>
                      </div>
                      <div className="text-xs text-muted mt-1">{h.who}{h.action ? ` · ${h.action}` : ""}{h.reason ? ` · ${tx("Reason", "കാരണം")}: ${h.reason}` : ""}</div>
                      {h.changes && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(h.changes).map(([f, ch]) => (
                            <span key={f} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-surface-hover border border-border-subtle">
                              <span className="text-text-tertiary font-medium">{labelOf(f)}:</span>
                              <span className="line-through text-rose-600 dark:text-rose-400">{valueOf(f, ch.old)}</span>
                              <span className="text-text-tertiary">→</span>
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">{valueOf(f, ch.new)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {!h.changes && h.summary && h.action !== "EDIT" && h.action !== "UPDATE" && <div className="text-xs text-text-secondary mt-1">{h.summary}</div>}
                    </div>
                  )) : (
                    <div className="text-sm text-muted">{tx("No changes recorded — the entry is exactly as it was created.", "മാറ്റങ്ങൾ രേഖപ്പെടുത്തിയിട്ടില്ല — എൻട്രി സൃഷ്ടിച്ചപ്പോഴുള്ളതാണ്.")}</div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={() => setPreviewOpen(false)}>{t("ui_close")}</Button>
                </div>
              </>
            );
          })()}
        </div>
      </Dialog>

      {/* Receipt sequence continuity */}
      <Dialog open={receiptsOpen} onClose={() => setReceiptsOpen(false)} title={tx("Receipt sequence", "രസീത് ശ്രേണി")} className="max-w-2xl">
        <div className="p-6 space-y-4">
          {receiptsData?.missing?.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {tx("Missing receipt numbers", "കാണാത്ത രസീത് നമ്പറുകൾ")}: {receiptsData.missing.join(", ")} — {tx("permanent deletion is disabled, so gaps mean manual editing of the database.", "സ്ഥിരം ഇല്ലാതാക്കൽ നിർജ്ജീവമാക്കിയതിനാൽ, വിടവുകൾ ഡാറ്റാബേസ് കൈകാര്യം ചെയ്തതിന്റെ സൂചനയാണ്.")}
            </div>
          )}
          {(!receiptsData?.missing || receiptsData.missing.length === 0) && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {tx("Sequence continuous — no gaps", "ശ്രേണി തുടർച്ചയായി — വിടവുകളില്ല")} ({receiptsData?.count || 0} {tx("receipts", "രസീതുകൾ")})
            </div>
          )}
          <div className="max-h-80 overflow-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover sticky top-0">
                <tr><th className="text-left px-3 py-2">{tx("Receipt", "രസീത്")}</th><th className="text-left px-3 py-2">{tx("Date", "തീയതി")}</th><th className="text-left px-3 py-2">{tx("Type", "തരം")}</th><th className="text-right px-3 py-2">{tx("Amount", "തുക")}</th><th className="text-left px-3 py-2">{tx("Status", "നില")}</th></tr>
              </thead>
              <tbody>
                {(receiptsData?.receipts || []).map((r: any) => (
                  <tr key={r.id} className={`border-t border-border-subtle ${r.status === "Void" ? "bg-rose-50/60" : ""}`}>
                    <td className={`px-3 py-1.5 code-text-sm ${r.status === "Void" ? "text-muted line-through" : "text-primary"}`}>{r.receipt_number}</td>
                    <td className="px-3 py-1.5">{formatDate(r.txn_date)}</td>
                    <td className="px-3 py-1.5">{r.type}</td>
                    <td className="px-3 py-1.5 text-right">{formatCurrency(r.amount)}</td>
                    <td className="px-3 py-1.5">{r.status === "Void" ? <Badge variant="danger">{tx("VOID", "റദ്ദാക്കി")}{r.void_reason ? ` — ${r.void_reason}` : ""}</Badge> : <Badge variant="success">{tx("Posted", "പോസ്റ്റ് ചെയ്തു")}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setReceiptsOpen(false)}>{t("ui_close")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
