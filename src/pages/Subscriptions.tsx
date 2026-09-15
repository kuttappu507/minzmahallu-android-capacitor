import { useState, useEffect } from "react";
import { Edit2, AlertCircle, Wallet, Eye, Ban, History, RefreshCw, FileDown, MessageCircle, Lock } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList, useAsync } from "@/hooks/useList";
import { Card, CardContent, Button, Dialog, Input, Label, Select, Textarea, Badge, SectionLabel } from "@/components/ui";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { formatCurrency, formatDate, statusVariant, todayIST, getCurrencySymbol } from "@/lib/utils";

interface Subscription {
  id: number;
  receipt_number: string;
  family_id: number;
  family_number: string;
  house_name?: string;
  member_id: number;
  member_name: string;
  plan_id: number;
  plan_name?: string;
  amount: number;
  amount_paid: number;
  /** Old unpaid balances accumulated across closed months. */
  arrears?: number;
  /** Prepaid credit that nets against future dues (overpayment). */
  advance?: number;
  period_start: string;
  period_end: string;
  payment_date: string;
  payment_method: string;
  transaction_ref: string;
  status: string;
  collected_by: number;
  remarks: string;
  /** Current month's WhatsApp receipt send state (joined from the ledger). */
  wa_sent_at?: string | null;
  wa_delivered_at?: string | null;
  wa_resends?: number;
  month_cash?: number | null;
  month_arrears_cleared?: number | null;
  month_advance_added?: number | null;
}

interface PaymentRecord {
  id: number;
  receipt_number: string | null;
  period_start: string | null;
  amount: number;
  payment_date: string | null;
  payment_method: string;
  status: string;
  member_name?: string;
  arrears_cleared?: number;
  advance_added?: number;
  receipt_delivered_at?: string | null;
}

const emptyForm: Partial<Subscription> = {
  receipt_number: "", family_id: 0, member_name: "", plan_id: 1, plan_name: "",
  amount: 0, amount_paid: 0, period_start: "", period_end: "", payment_date: "",
  payment_method: "Cash", transaction_ref: "", status: "Pending", remarks: "",
};

const codeFontStyle = "code-text-sm";

const monthLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export function Subscriptions() {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const tx = (en: string, m: string) => (ml ? m : en);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Subscription>>(emptyForm);
  const [families, setFamilies] = useState<any[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<Subscription | null>(null);
  const [historyRows, setHistoryRows] = useState<PaymentRecord[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  // WhatsApp receipt privacy lock: the one admin-authorized re-send gate.
  const [resendOpen, setResendOpen] = useState(false);
  const [resendTarget, setResendTarget] = useState<Subscription | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const { rows, total, totalPages, loading, refetch, setFilters } = useList(
    (filter) => window.mms.subscriptions.list(filter),
    { pageSize: 20, initialFilters: { status: statusFilter !== "All" ? statusFilter : undefined } }
  );

  // Status filter drives the query (and resets to page 1).
  useEffect(() => {
    setFilters({ status: statusFilter !== "All" ? statusFilter : undefined });
    setPage(1);
  }, [statusFilter, setFilters]);

  const { data: totalCollected, refresh: refreshCollected } = useAsync(() => window.mms.subscriptions.totalCollected(), []);
  const { data: totalPending, refresh: refreshPending } = useAsync(() => window.mms.subscriptions.totalPending(), []);

  useEffect(() => {
    window.mms.families.list({ pageSize: 1000 }).then((r) => setFamilies(r.rows || [])).catch(() => {});
  }, []);

  // Keep the recurring rows in step with the current month on every visit.
  useEffect(() => {
    window.mms.subscriptions.ensureCurrentMonth().then(() => refetch()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setForm({ ...emptyForm, payment_date: todayIST() });
    setEditingId(null);
    setDialogOpen(true);
  };

  // Payment recording: only the payment fields are editable — family, head,
  // period and the monthly rate are fixed by the recurring account.
  const handleSave = async () => {
    if (!editingId) {
      // Creating a NEW subscription account (only for families without one).
      if (!form.family_id || !form.amount) {
        toast.error(t("ui_family_amount_required"));
        return;
      }
      try {
        await window.mms.subscriptions.create({
          familyId: form.family_id,
          memberId: form.member_id || null,
          planId: form.plan_id || 1,
          amount: form.amount,
          amountPaid: form.amount_paid ?? 0,
          paymentDate: form.payment_date,
          paymentMethod: form.payment_method,
          transactionRef: form.transaction_ref || "",
          remarks: form.remarks || "",
        });
        toast.success(t("add_subscription"));
        setDialogOpen(false);
        setForm(emptyForm);
        setEditingId(null);
        refetch();
      } catch (err: any) {
        toast.error(err.message || t("ui_failed_save"));
      }
      return;
    }
    if (form.amount_paid == null || Number(form.amount_paid) < 0) {
      toast.error(tx("Enter how much was given", "എത്ര നൽകി എന്ന് നൽകുക"));
      return;
    }
    try {
      const r: any = await window.mms.subscriptions.update(editingId, {
        amountPaid: Number(form.amount_paid),
        paymentDate: form.payment_date,
        paymentMethod: form.payment_method,
        transactionRef: form.transaction_ref || "",
        remarks: form.remarks || "",
      });
      // The receipt (A6) is generated and saved in the app automatically;
      // WhatsApp delivery depends on pairing + the family's number.
      const waNote: string =
        r?.receiptWhatsApp === "delivered" ? tx(" — receipt DELIVERED on WhatsApp (now locked)", " — രസീറ്റ് വാട്ട്സ്ആപ്പിൽ എത്തി (ഇനി ലോക്ക്)")
        : r?.receiptWhatsApp === "already-delivered" ? tx(" — this month's receipt was already delivered (locked for privacy)", " — ഈ മാസത്തെ രസീറ്റ് ഇതിനകം എത്തിയിട്ടുണ്ട് (സ്വകാര്യതയ്ക്കായി ലോക്ക്)")
        : r?.receiptWhatsApp === "sent" ? tx(" — receipt sent on WhatsApp (delivery not confirmed yet)", " — രസീറ്റ് വാട്ട്സ്ആപ്പിൽ അയച്ചു (ഡെലിവറി ഉറപ്പായിട്ടില്ല)")
        : r?.receiptWhatsApp === "no-phone" ? tx(" — receipt saved (no WhatsApp number for this family)", " — രസീറ്റ് സേവ് ചെയ്തു (ഈ കുടുംബത്തിന് വാട്ട്സ്ആപ്പ് നമ്പർ ഇല്ല)")
        : r?.receiptWhatsApp === "not-connected" ? tx(" — receipt saved (WhatsApp not connected)", " — രസീറ്റ് സേവ് ചെയ്തു (വാട്ട്സ്ആപ്പ് കണക്റ്റ് അല്ല)")
        : r?.receiptWhatsApp === "failed" ? tx(` — receipt not sent: ${r.receiptError || "failed"}`, ` — രസീറ്റ് അയച്ചില്ല: ${r.receiptError || "പരാജയം"}`)
        : "";
      toast.success(tx(
        `Payment saved — ${r.status}${r.receiptNumber ? ` (receipt ${r.receiptNumber})` : ""}${waNote}`,
        `പേയ്‌മെന്റ് സേവ് ചെയ്തു — ${r.status}${r.receiptNumber ? ` (രസീറ്റ് ${r.receiptNumber})` : ""}${waNote}`
      ));
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      refetch();
      refreshCollected();
      refreshPending();
    } catch (err: any) {
      toast.error(err.message || t("ui_failed_save"));
    }
  };

  const handleEdit = async (id: number) => {
    const s = await window.mms.subscriptions.get(id);
    setForm({ ...emptyForm, ...s, payment_date: s?.payment_date || todayIST() });
    setEditingId(id);
    setDialogOpen(true);
  };

  const openCancel = (row: Subscription) => {
    setCancelTarget(row);
    setCancelOpen(true);
  };

  const executeCancel = async ({ reason, password }: { reason: string; password: string }) => {
    if (!cancelTarget) return;
    await window.mms.subscriptions.cancelPayment(cancelTarget.id, reason, password);
    toast.success(tx("Payment cancelled — the subscription stays with the family", "പേയ്‌മെന്റ് റദ്ദാക്കി — വരിസംഖ്യ കുടുംബത്തിനൊപ്പം തുടരും"));
    refetch();
    refreshCollected();
    refreshPending();
  };

  // ===== A6 payment receipts (PDF / WhatsApp) — always saved as PDF files,
  // never sent straight to a printer. =====
  const saveReceipt = async (id: number) => {
    try {
      const r: any = await window.mms.receipts.saveSubscriptionPdf(id);
      if (r?.success) toast.success(tx("Receipt PDF saved", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d PDF \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d24\u0d41"));
    } catch (e: any) { toast.error(e?.message || tx("Could not save the receipt PDF", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d PDF \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d3e\u0d28\u0d3e\u0d2f\u0d3f\u0d32\u0d4d\u0d32")); }
  };
  const sendReceipt = async (id: number, adminPassword?: string) => {
    if (sendingId != null) return; // one message at a time, per privacy rule
    setSendingId(id);
    try {
      const r: any = await window.mms.whatsapp.sendSubscriptionReceipt(id, adminPassword);
      // The lock flips ONLY on confirmed delivery — a send that WhatsApp
      // accepted but the phone never confirmed stays open, exactly as the
      // mahallu asked (no false "already sent").
      if (r?.status === "delivered" || (r?.success && r?.delivered)) {
        toast.success(tx("Receipt delivered to the recipient — it is now locked (one admin re-send remains available)", "രസീറ്റ് സ്വീകർത്താവിന് ലഭിച്ചു — ഇനി ലോക്ക് ചെയ്തിരിക്കുന്നു (ഒരു അഡ്മിൻ റീ-സെൻഡ് ലഭ്യമാണ്)"));
      } else if (r?.status === "sent" || r?.success) {
        toast.warning(tx("Receipt sent — delivery not confirmed yet (the phone may be offline). Not locked; you can send again after confirming it did not arrive.", "രസീറ്റ് അയച്ചു — ഡെലിവറി ഉറപ്പാക്കിയിട്ടില്ല (ഫോൺ ഓഫലൈൻ ആകാം). ലോക്ക് ചെയ്തിട്ടില്ല; വന്നെത്തിയില്ലെന്ന് ഉറപ്പായാൽ വീണ്ടും അയക്കാം."));
      } else if (r?.status === "already-delivered") {
        toast.info(tx("Already sent to the recipient — the receipt is locked for their privacy.", "സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — സ്വകാര്യതയ്ക്കായി രസീറ്റ് ലോക്ക് ചെയ്തിരിക്കുന്നു."));
      } else {
        toast.error(r?.error || tx("Could not send the receipt", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d \u0d05\u0d2f\u0d2f\u0d4d\u0d15\u0d4d\u0d15\u0d3e\u0d28\u0d3e\u0d2f\u0d3f\u0d32\u0d4d\u0d32"));
      }
      refetch();
    } catch (e: any) {
      toast.error(e?.message || tx("Could not send the receipt", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d \u0d05\u0d2f\u0d2f\u0d4d\u0d15\u0d4d\u0d15\u0d3e\u0d28\u0d3e\u0d2f\u0d3f\u0d32\u0d4d\u0d32"));
      refetch();
    } finally {
      setSendingId(null);
    }
  };
  // A delivered receipt is LOCKED (privacy): one admin-password re-send ever,
  // re-verified in the main process before the message leaves the app.
  const openAdminResend = (row: Subscription) => {
    if (Number(row.wa_resends || 0) >= 1) {
      toast.info(tx("Already sent to the recipient — the one admin re-send was already used.", "സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ഉപയോഗിച്ചു കഴിഞ്ഞു."));
      return;
    }
    setResendTarget(row);
    setResendOpen(true);
  };
  const executeAdminResend = async ({ password }: { reason: string; password: string }) => {
    if (!resendTarget) return;
    await sendReceipt(resendTarget.id, password);
    setResendTarget(null);
  };
  const saveReceiptsPdf = async () => {
    try {
      const list: any = await window.mms.subscriptions.list({
        search: search || undefined,
        status: statusFilter !== "All" ? statusFilter : undefined,
        page: 1, pageSize: 500,
      });
      const ids = (list?.rows || []).filter((r: any) => Number(r.amount_paid || 0) > 0).map((r: any) => r.id);
      if (!ids.length) { toast.error(tx("No paid subscriptions to save", "\u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d3e\u0d28\u0d4d \u0d05\u0d1f\u0d1a\u0d4d\u0d1a \u0d38\u0d2c\u0d4d\u200c\u0d38\u0d4d\u0d15\u0d4d\u0d30\u0d3f\u0d2a\u0d4d\u0d36\u0d28\u0d41\u0d15\u0d33\u0d3f\u0d32\u0d4d\u0d32")); return; }
      const r: any = await window.mms.receipts.saveSubscriptionBatchPdf(ids);
      if (r?.cancelled) { /* closed the save dialog */ }
      else if (r?.success) toast.success(tx(`Saved ${r.count} receipts as one PDF (4 per A4 sheet)`, `${r.count} \u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d41\u0d15\u0d33\u0d4d \u0d12\u0d30\u0d41 PDF \u0d86\u0d2f\u0d3f \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d24\u0d41 (\u0d12\u0d30\u0d41 A4 \u0d37\u0d40\u0d31\u0d4d\u0d1f\u0d3f\u0d7d 4 \u0d0e\u0d23\u0d4d\u0d23\u0d02)`));
      else toast.error(r?.reason || tx("Could not save the receipts PDF", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d41\u0d15\u0d33\u0d4d \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d3e\u0d28\u0d3e\u0d2f\u0d3f\u0d32\u0d4d\u0d32"));
    } catch (e: any) { toast.error(e?.message || tx("Could not save the receipts PDF", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d41\u0d15\u0d33\u0d4d \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d3e\u0d28\u0d3e\u0d2f\u0d3f\u0d32\u0d4d\u0d32")); }
  };

  const handleRowDoubleClick = async (row: Subscription) => {
    setPreviewRow(row);
    setPreviewOpen(true);
    setHistoryRows([]);
    try {
      const h = await window.mms.subscriptions.paymentsHistory(row.family_id);
      setHistoryRows(h || []);
    } catch { setHistoryRows([]); }
  };

  const switchToEdit = async () => {
    if (!previewRow) return;
    const id = previewRow.id;
    setPreviewOpen(false);
    setPreviewRow(null);
    await handleEdit(id);
  };

  const handleMarkOverdue = async () => {
    try {
      const count = await window.mms.subscriptions.markOverdue();
      toast.success(`${count} ${tx("subscriptions marked overdue", "വരിസംഖ്യകൾ കാലാവധി കഴിഞ്ഞതായി")}`);
      refetch();
      refreshCollected();
      refreshPending();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const columns: Column<Subscription>[] = [
    {
      header: t("member_family"),
      accessor: (r) => <span className="font-medium">{r.house_name || r.family_number || "—"}</span>,
    },
    { header: tx("Head", "തലവൻ"), accessor: (r) => r.member_name || "—" },
    { header: tx("Month", "മാസം"), accessor: (r) => monthLabel(r.period_start) },
    { header: t("sub_amount"), accessor: (r) => formatCurrency(r.amount) },
    {
      // TRUE dues — the multi-month view: old arrears ("3 months") + this
      // month's uncovered part − advance credit. Overdue families see the
      // whole stack here, not just the current month.
      header: tx("Due (all months)", "ബാക്കി (എല്ലാ മാസവും)"),
      accessor: (r) => {
        const rate = Number(r.amount || 0);
        const arrears = Number(r.arrears || 0);
        const advance = Number(r.advance || 0);
        const monthOpen = Math.max(0, rate - Number(r.amount_paid || 0));
        const due = Math.max(0, arrears + monthOpen - advance);
        const monthsDue = rate > 0 ? Math.ceil((due + advance) / rate) : 0;
        const sym = getCurrencySymbol();
        if (due <= 0 && advance > 0) {
          return <Badge variant="success">{tx(`Paid ahead ${sym}${advance.toLocaleString("en-IN")}`, `മുൻകൂട്ടി അടച്ചു ${sym}${advance.toLocaleString("en-IN")}`)}</Badge>;
        }
        if (due <= 0) return <Badge variant="success">{tx("Paid", "അടച്ചു")}</Badge>;
        return (
          <span className="inline-flex flex-col leading-tight">
            <b className="text-danger">{formatCurrency(due)}</b>
            {monthsDue > 1 && (
              <small className="text-muted">{tx(`${monthsDue} months due (incl. ${sym}${arrears.toLocaleString("en-IN")} old)`, `${monthsDue} മാസം ബാക്കി (പഴയവ ${sym}${arrears.toLocaleString("en-IN")} ഉൾപ്പെടെ)`)}{advance > 0 ? tx(` · less ${sym}${advance.toLocaleString("en-IN")} advance`, ` · അഡ്വാൻസ് ${sym}${advance.toLocaleString("en-IN")} കുറച്ചു`) : ""}</small>
            )}
          </span>
        );
      },
    },
    {
      header: t("sub_receipt"),
      accessor: (r) => (
        <span className={codeFontStyle + " text-primary"}>
          {r.receipt_number || "—"}
        </span>
      ),
    },
    {
      header: t("family_status"),
      accessor: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge>,
    },
    {
      header: "",
      accessor: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {Number(r.amount_paid) > 0 && <>
            <button className="act-btn" title={tx("Save A6 receipt PDF", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d PDF \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d41\u0d15")} onClick={() => saveReceipt(r.id)}>
              <FileDown className="h-4 w-4 text-primary" />
            </button>
            {r.wa_delivered_at ? (
              <button
                className={`act-btn${Number(r.wa_resends || 0) >= 1 ? " opacity-60" : ""}`}
                title={Number(r.wa_resends || 0) >= 1
                  ? tx("Already sent to recipient — the one admin re-send was used", "സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ഉപയോഗിച്ചു കഴിഞ്ഞു")
                  : tx("Already sent to recipient — one admin re-send available", "സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ലഭ്യമാണ്")}
                onClick={() => openAdminResend(r)}
              >
                <Lock className="h-4 w-4 text-emerald-500" />
              </button>
            ) : (
              <button
                className="act-btn"
                disabled={sendingId === r.id}
                title={r.wa_sent_at
                  ? tx("Sent earlier but delivery was never confirmed — sending again is allowed", "ഇതിനകം അയച്ചെങ്കിലും ഡെലിവറി ഉറപ്പായില്ല — വീണ്ടും അയക്കാം")
                  : tx("Send receipt on WhatsApp", "\u0d35\u0d3e\u0d1f\u0d4d\u0d38\u0d3e\u0d2a\u0d4d\u0d2a\u0d3f\u0d7d \u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d \u0d05\u0d2f\u0d2f\u0d4d\u0d15\u0d4d\u0d15\u0d41\u0d15")}
                onClick={() => sendReceipt(r.id)}
              >
                <MessageCircle className="h-4 w-4 text-primary" />
              </button>
            )}
          </>}
          <button className="act-btn act-edit" title={tx("Record payment", "പേയ്‌മെന്റ് രേഖപ്പെടുത്തുക")} onClick={() => handleEdit(r.id)}>
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            className="act-btn act-del"
            title={tx("Cancel this month's payment", "ഈ മാസത്തെ പേയ്‌മെന്റ് റദ്ദാക്കുക")}
            disabled={!r.amount_paid}
            style={{ opacity: r.amount_paid ? 1 : 0.35, cursor: r.amount_paid ? "pointer" : "not-allowed" }}
            onClick={() => r.amount_paid && openCancel(r)}
          >
            <Ban className="h-4 w-4 text-danger" />
          </button>
        </div>
      ),
      align: "right",
    },
  ];

  const previewDetails = previewRow
    ? [
        { k: t("member_family"), v: previewRow.house_name || previewRow.family_number || "—" },
        { k: t("member_name"), v: previewRow.member_name || "—" },
        { k: tx("Month", "മാസം"), v: monthLabel(previewRow.period_start) },
        { k: t("sub_amount"), v: formatCurrency(previewRow.amount) },
        { k: t("sub_amount_paid"), v: formatCurrency(previewRow.amount_paid) },
        { k: tx("Old arrears (previous months)", "പഴയ കുടിശ്ശിക (മുൻ മാസങ്ങൾ)"), v: formatCurrency(Number(previewRow.arrears || 0)) },
        { k: tx("Advance credit", "അഡ്വാൻസ് ക്രെഡിറ്റ്"), v: formatCurrency(Number(previewRow.advance || 0)) },
        {
          k: tx("Total due now", "ഇപ്പോഴത്തെ മൊത്തം ബാക്കി"),
          v: formatCurrency(Math.max(0, Number(previewRow.arrears || 0) + Math.max(0, Number(previewRow.amount || 0) - Number(previewRow.amount_paid || 0)) - Number(previewRow.advance || 0))),
        },
        { k: t("sub_receipt"), v: previewRow.receipt_number || "—" },
        { k: tx("Receipt on WhatsApp", "വാട്ട്സ്ആപ്പിലെ രസീറ്റ്"), v: previewRow.wa_delivered_at ? tx("Delivered — locked (privacy)", "എത്തിഞ്ഞു — ലോക്ക് ചെയ്തിരിക്കുന്നു (സ്വകാര്യത)") : previewRow.wa_sent_at ? tx("Sent — delivery not confirmed", "അയച്ചു — ഡെലിവറി ഉറപ്പായിട്ടില്ല") : tx("Not sent", "അയച്ചിട്ടില്ല") },
        { k: t("sub_payment_date"), v: formatDate(previewRow.payment_date) },
        { k: t("sub_method"), v: previewRow.payment_method || "—" },
        { k: t("ui_transaction_ref"), v: previewRow.transaction_ref || "—" },
        { k: t("family_status"), v: previewRow.status },
        { k: t("ui_remarks"), v: previewRow.remarks || "—", full: true },
      ]
    : [];

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em">
          <Wallet size={20} />
        </div>
        <div>
          <h1>{t("sub_title")}</h1>
          <div className="vs">{tx(
            "Recurring monthly subscription — one row per family (head), rolled over each month",
            "മാസിക വരിസംഖ്യ — ഓരോ കുടുംബത്തിനും (തലവന്) ഒരു വരി, ഓരോ മാസവും അതേ വരിയിൽ തന്നെ"
          )}</div>
        </div>
        <div className="vr">
          <Button variant="secondary" onClick={saveReceiptsPdf} title={tx("Save A6 payment receipts as one PDF \u2014 4 per A4 sheet (paid rows, current filter)", "\u0d05\u0d1f\u0d1a\u0d4d\u0d1a \u0d38\u0d2c\u0d4d\u200c\u0d38\u0d4d\u0d15\u0d4d\u0d30\u0d3f\u0d2a\u0d4d\u0d36\u0d28\u0d4d \u0d30\u0d38\u0d40\u0d1f\u0d41\u0d15\u0d7e \u0d12\u0d30\u0d41 PDF \u0d86\u0d2f\u0d3f \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d41\u0d15")}>
            <FileDown className="h-4 w-4" />
            {tx("Save receipts", "\u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d41\u0d15\u0d7d \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d41\u0d15")}
          </Button>
          <Button variant="secondary" onClick={handleMarkOverdue}>
            <AlertCircle className="h-4 w-4" />
            {t("sub_mark_overdue")}
          </Button>
          <Button variant="secondary" onClick={() => { window.mms.subscriptions.ensureCurrentMonth().then(() => refetch()).catch(() => {}); }}>
            <RefreshCw className="h-4 w-4" />
            {tx("Sync month", "മാസം സമന്വയിക്കുക")}
          </Button>
          <Button onClick={openNew}>
            <Edit2 className="h-4 w-4" />
            {tx("New subscription", "പുതിയ വരിസംഖ്യ")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-grid stat-grid-2">
        <div className="stat t-em">
          <div className="srow">
            <span className="sic"><Wallet size={18} /></span>
            <span className="delta">{t("sub_collected")}</span>
          </div>
          <div className="val">{formatCurrency(totalCollected ?? 0)}</div>
          <div className="slab">{tx("Total collected (all months)", "മൊത്തം ശേഖരിച്ചത് (എല്ലാ മാസങ്ങളും)")}</div>
        </div>
        <div className="stat t-rose">
          <div className="srow">
            <span className="sic"><AlertCircle size={18} /></span>
            <span className="delta">{t("sub_dues")}</span>
          </div>
          <div className="val">{formatCurrency(totalPending ?? 0)}</div>
          <div className="slab">{tx("Total dues — old arrears + this month − advance", "മൊത്തം ബാക്കി — പഴയ കുടിശ്ശിക + ഈ മാസം − അഡ്വാൻസ്")}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows as Subscription[]}
        loading={loading}
        total={total}
        page={page}
        pageSize={20}
        totalPages={totalPages}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        rowKey={(r) => r.id}
        onRowDoubleClick={handleRowDoubleClick}
        toolbar={
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="All">{t("filter_all")}</option>
            <option value="Paid">{t("status_paid")}</option>
            <option value="Pending">{t("status_pending")}</option>
            <option value="Overdue">{t("status_overdue")}</option>
            <option value="Partial">{t("status_partial")}</option>
          </Select>
        }
      />

      {/* Preview Dialog (read-only) + payment history */}
      <Dialog
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewRow(null); }}
        title={t("sub_title")}
        className="max-w-2xl"
      >
        <div className="dlg-pad">
          {previewRow && (
            <>
              <div className="dlg-hero t-em">
                <div className="dlg-hero-ic">
                  <Eye size={20} />
                </div>
                <div className="dlg-hero-body">
                  <div className="dlg-hero-title">
                    {previewRow.house_name || previewRow.family_number} — {previewRow.member_name}
                  </div>
                  <div className="dlg-hero-sub">
                    {monthLabel(previewRow.period_start)} · {formatCurrency(previewRow.amount)} / {tx("month", "മാസം")}
                  </div>
                </div>
                <Badge variant={statusVariant(previewRow.status)}>{previewRow.status}</Badge>
              </div>
              <div className="dlg-sec"><b>{tx("Subscription", "വരിസംഖ്യ")}</b></div>
              <div className="det-grid">
                {previewDetails.slice(0, 6).map((d, i) => (
                  <div key={i} className={`det${d.full ? " full" : ""}`}>
                    <span className="k">{d.k}</span>
                    <span className="v">{d.v}</span>
                  </div>
                ))}
              </div>
              <div className="dlg-sec"><b>{tx("Payment & status", "പേയ്മെന്റും അവസ്ഥയും")}</b></div>
              <div className="det-grid">
                {previewDetails.slice(6).map((d, i) => (
                  <div key={i} className={`det${d.full ? " full" : ""}`}>
                    <span className="k">{d.k}</span>
                    <span className="v">{d.v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <div className="flex items-center gap-2 mb-3">
                  <History size={16} />
                  <strong>{tx("Payment history", "പേയ്‌മെന്റ് ചരിത്രം")}</strong>
                </div>
                <div className="space-y-2 max-h-56 overflow-auto">
                  {historyRows.length ? historyRows.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
                      <div>
                        <div className="text-sm font-medium">
                          {monthLabel(h.period_start)} · {formatCurrency(h.amount)}
                          {Number(h.arrears_cleared || 0) > 0 && (
                            <span className="text-xs text-muted"> · {tx(`incl. ${formatCurrency(Number(h.arrears_cleared || 0))} old dues`, `പഴയ ബാക്കി ${formatCurrency(Number(h.arrears_cleared || 0))} ഉൾപ്പെടെ`)}</span>
                          )}
                          {Number(h.advance_added || 0) > 0 && (
                            <span className="text-xs text-muted"> · {tx(`${formatCurrency(Number(h.advance_added || 0))} advance`, `${formatCurrency(Number(h.advance_added || 0))} അഡ്വാൻസ്`)}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted">
                          {h.receipt_number || "—"} · {formatDate(h.payment_date)} · {h.payment_method}
                          {h.receipt_delivered_at ? ` · ${tx("receipt delivered", "രസീറ്റ് എത്തി")}` : ""}
                        </div>
                      </div>
                      <Badge variant={h.status === "Cancelled" ? "danger" : "success"}>{h.status}</Badge>
                    </div>
                  )) : (
                    <div className="text-sm text-muted">{tx("No payments recorded yet", "ഇതുവരെ പേയ്‌മെന്റുകളില്ല")}</div>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="dlg-actions">
            <Button variant="secondary" onClick={() => { setPreviewOpen(false); setPreviewRow(null); }}>
              {t("ui_close")}
            </Button>
            {Number(previewRow?.amount_paid) > 0 && <>
              <Button variant="secondary" onClick={() => previewRow && saveReceipt(previewRow.id)}>
                <FileDown size={14} />{tx("Save A6 PDF", "A6 PDF \u0d38\u0d47\u0d35\u0d4d \u0d1a\u0d46\u0d2f\u0d4d\u0d2f\u0d41\u0d15")}
              </Button>
              {previewRow?.wa_delivered_at ? (
                <Button variant="secondary" onClick={() => previewRow && openAdminResend(previewRow)} disabled={sendingId === previewRow.id}>
                  <Lock size={14} />{tx("Already sent to recipient", "സ്വീകർത്താവിന് ഇതിനകം അയച്ചു")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => previewRow && sendReceipt(previewRow.id)} disabled={sendingId === previewRow?.id}>
                  <MessageCircle size={14} />{tx("WhatsApp receipt", "\u0d35\u0d3e\u0d1f\u0d4d\u0d38\u0d3e\u0d2a\u0d4d\u0d2a\u0d4d \u0d30\u0d38\u0d40\u0d1f\u0d4d\u0d1f\u0d4d")}
                </Button>
              )}
            </>}
            <Button onClick={switchToEdit}>
              <Edit2 size={14} />
              {tx("Record payment", "പേയ്‌മെന്റ് രേഖപ്പെടുത്തുക")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Record-payment / new-account Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? tx("Record payment", "പേയ്‌മെന്റ് രേഖപ്പെടുത്തുക") : tx("New subscription account", "പുതിയ വരിസംഖ്യ അക്കൗണ്ട്")}
        className="max-w-2xl"
      >
        <div className="p-6 space-y-4">
          {editingId ? (
            <>
              <div className="rounded-lg border border-border-subtle bg-surface-hover/40 px-4 py-3 text-sm flex items-center gap-2">
                <Wallet size={14} className="text-primary" />
                <span className="text-muted">
                  {tx("Recurring subscription for", "ഇതിന്റെ ആവർത്തിക്കുന്ന വരിസംഖ്യ")} <b className="text-text-primary">{form.house_name || form.family_number}</b>
                  {" — "}{tx("recorded in the name of", "ഇവരുടെ പേരിൽ രേഖപ്പെടുത്തിയത്")} <b className="text-text-primary">{form.member_name || "—"}</b>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>{tx("Month", "മാസം")}</Label>
                  <Input value={monthLabel(form.period_start)} readOnly className="bg-surface-muted" />
                </div>
                <div>
                  <Label>{tx("Monthly due", "പ്രതിമാസ തുക")}</Label>
                  <Input value={formatCurrency(form.amount || 0)} readOnly className="bg-surface-muted" />
                </div>
                <div>
                  <Label>{tx("Total due now", "മൊത്തം ബാക്കി")}</Label>
                  <Input value={formatCurrency(Math.max(0, Number(form.arrears || 0) + Math.max(0, Number(form.amount || 0) - Number(form.amount_paid || 0)) - Number(form.advance || 0)))} readOnly className="bg-surface-muted" />
                  <div className="text-xs text-muted mt-1.5">
                    {Number(form.arrears || 0) > 0 && tx(`includes ${formatCurrency(Number(form.arrears || 0))} from previous months`, `മുൻ മാസങ്ങളിൽ നിന്ന് ${formatCurrency(Number(form.arrears || 0))} ഉൾപ്പെടുന്നു`)}
                    {Number(form.advance || 0) > 0 && (Number(form.arrears || 0) > 0 ? " · " : "") + tx(`${formatCurrency(Number(form.advance || 0))} advance credit applies`, `${formatCurrency(Number(form.advance || 0))} അഡ്വാൻസ് ക്രെഡിറ്റ് ബാധകം`)}
                  </div>
                </div>
              </div>
              {/* How the cash given this month will be applied (oldest-first):
                  old arrears → this month → advance. The hint updates live as
                  the operator types the amount — "due 150, paid 200" shows the
                  ₹50 becoming advance BEFORE saving. */}
              {(() => {
                const rate = Number(form.amount || 0);
                const oldArrears = Number(form.arrears || 0);
                const oldAdvance = Number(form.advance || 0);
                const cash = Number(form.amount_paid || 0);
                const arrearsTake = Math.min(oldArrears, cash);
                const afterArrears = cash - arrearsTake;
                const monthTake = Math.min(rate, afterArrears);
                const advanceAdded = Math.max(0, afterArrears - monthTake);
                const remaining = Math.max(0, (oldArrears - arrearsTake) + Math.max(0, rate - monthTake) - oldAdvance);
                if (cash <= 0) return null;
                return (
                  <div className="rounded-lg border border-border-subtle bg-surface-hover/40 px-4 py-3 text-xs text-muted leading-relaxed">
                    <b className="text-text-primary">{tx("How this payment will be applied", "ഈ പേയ്‌മെന്റ് എങ്ങനെ കണക്കാക്കും")}</b>
                    <div className="mt-1">
                      {arrearsTake > 0 && <div>· {tx(`${formatCurrency(arrearsTake)} clears previous months' balance`, `${formatCurrency(arrearsTake)} പഴയ മാസങ്ങളുടെ ബാക്കി അടയ്ക്കും`)}</div>}
                      <div>· {tx(`${formatCurrency(monthTake)} for this month`, `${formatCurrency(monthTake)} ഈ മാസത്തേക്ക്`)}</div>
                      {advanceAdded > 0 && <div>· {tx(`${formatCurrency(advanceAdded)} becomes advance — next month's due will be ${formatCurrency(Math.max(0, rate - advanceAdded))}`, `${formatCurrency(advanceAdded)} അഡ്വാൻസ് ആകും — അടുത്ത മാസത്തെ ബാക്കി ${formatCurrency(Math.max(0, rate - advanceAdded))} ആകും`)}</div>}
                      <div className="mt-1">{remaining > 0
                        ? tx(`Balance after this payment: ${formatCurrency(remaining)}`, `ഈ പേയ്‌മെന്റിന് ശേഷം ബാക്കി: ${formatCurrency(remaining)}`)
                        : tx("Fully settled after this payment", "ഇതിനു ശേഷം പൂർണമായി തീരും")}</div>
                    </div>
                  </div>
                );
              })()}
              <div className="sec-divider">
                <SectionLabel>{tx("Payment details (editable)", "പേയ്‌മെന്റ് വിവരങ്ങൾ (തിരുത്താവുന്നത്)")}</SectionLabel>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{tx("How much was given", "എത്ര നൽകി")} *</Label>
                    <Input type="number" min="0" value={form.amount_paid ?? 0} onChange={(e) => setForm({ ...form, amount_paid: Number(e.target.value) })} />
                    <div className="text-xs text-muted mt-1.5">{tx("Family, head, month and rate are fixed — only this can be edited.", "കുടുംബം, തലവൻ, മാസം, നിരക്ക് എന്നിവ മാറ്റാനാവില്ല — ഇത് മാത്രം തിരുത്താം.")}</div>
                  </div>
                  <div>
                    <Label>{t("sub_payment_date")}</Label>
                    <Input type="date" value={form.payment_date || ""} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
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
                  <div>
                    <Label>{t("ui_transaction_ref")}</Label>
                    <Input value={form.transaction_ref || ""} onChange={(e) => setForm({ ...form, transaction_ref: e.target.value })} />
                  </div>
                </div>
                <div className="mt-3">
                  <Label>{t("ui_remarks")}</Label>
                  <Textarea rows={2} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-border-subtle bg-surface-hover/40 px-4 py-2.5 text-sm text-muted">
                {tx("Use this only for a family that has no subscription yet. Existing families already have their recurring row.", "വരിസംഖ്യ ഇല്ലാത്ത കുടുംബത്തിന് മാത്രം ഉപയോഗിക്കുക. നിലവിലുള്ള കുടുംബങ്ങൾക്ക് അവരുടെ ആവർത്തിക്കുന്ന വരി ഉണ്ട്.")}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("member_family")} *</Label>
                  <Select value={form.family_id || ""} onChange={(e) => setForm({ ...form, family_id: Number(e.target.value) })}>
                    <option value="">{t("ui_select")}</option>
                    {families.map((f) => (
                      <option key={f.id} value={f.id}>{f.house_name} ({f.family_number})</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>{tx("Monthly due", "പ്രതിമാസ തുക")} *</Label>
                  <Input type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>{tx("First payment (optional)", "ആദ്യ പേയ്‌മെന്റ് (ഓപ്ഷണൽ)")}</Label>
                  <Input type="number" min="0" value={form.amount_paid ?? 0} onChange={(e) => setForm({ ...form, amount_paid: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>{t("sub_payment_date")}</Label>
                  <Input type="date" value={form.payment_date || ""} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
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
                <div>
                  <Label>{t("ui_transaction_ref")}</Label>
                  <Input value={form.transaction_ref || ""} onChange={(e) => setForm({ ...form, transaction_ref: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>{t("ui_remarks")}</Label>
                <Textarea rows={2} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={handleSave}>{editingId ? tx("Save payment", "പേയ്‌മെന്റ് സേവ് ചെയ്യുക") : t("action_save")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Cancel payment — secure gate (reason + admin password) */}
      <SecureActionDialog
        open={cancelOpen}
        onClose={() => { setCancelOpen(false); setCancelTarget(null); }}
        onConfirm={executeCancel}
        title={tx("Cancel payment", "പേയ്‌മെന്റ് റദ്ദാക്കുക")}
        description={
          cancelTarget
            ? tx(
                `Cancel the ${monthLabel(cancelTarget.period_start)} payment of ${formatCurrency(cancelTarget.amount_paid)} for ${cancelTarget.house_name || cancelTarget.family_number}?`,
                `${cancelTarget.house_name || cancelTarget.family_number} ന്റെ ${monthLabel(cancelTarget.period_start)} പേയ്‌മെന്റ് (${formatCurrency(cancelTarget.amount_paid)}) റദ്ദാക്കണോ?`
              )
            : ""
        }
        confirmLabel={tx("Cancel payment", "പേയ്‌മെന്റ് റദ്ദാക്കുക")}
      />

      {/* WhatsApp receipt privacy lock — the ONE admin-authorized re-send for
          a receipt already delivered to the family. The password is re-verified
          in the MAIN process before the message leaves the app. */}
      <SecureActionDialog
        open={resendOpen}
        onClose={() => { setResendOpen(false); setResendTarget(null); }}
        onConfirm={executeAdminResend}
        title={tx("Re-send receipt (administrator)", "രസീറ്റ് വീണ്ടും അയക്കുക (അഡ്മിനിസ്ട്രേറ്റർ)")}
        description={
          resendTarget
            ? tx(
                `This month's receipt for ${resendTarget.house_name || resendTarget.family_number} was already DELIVERED on WhatsApp and is locked for their privacy. Re-send it once more? This is the only re-send this receipt ever gets.`,
                `${resendTarget.house_name || resendTarget.family_number} ന്റെ ഈ മാസത്തെ രസീറ്റ് വാട്ട്സ്ആപ്പിൽ എത്തിയിട്ടുണ്ട്; സ്വകാര്യതയ്ക്കായി അത് ലോക്ക് ചെയ്തിരിക്കുന്നു. ഒരിക്കൽ കൂടി അയക്കണോ? ഇതാണ് ഈ രസീറ്റിന് ലഭിക്കുന്ന ഒരേയൊരു റീ-സെൻഡ്.`
              )
            : ""
        }
        confirmLabel={tx("Re-send once", "ഒരിക്കൽ കൂടി അയക്കുക")}
        danger={false}
      />
    </div>
  );
}
