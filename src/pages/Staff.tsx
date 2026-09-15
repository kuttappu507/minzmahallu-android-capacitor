import { useEffect, useMemo, useState } from "react";
import { Plus, Edit2, Eye, LogOut, UserX, RotateCcw, History, Wallet, XCircle, Briefcase } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList } from "@/hooks/useList";
import { Button, Dialog, Input, Label, Select, Textarea, Badge } from "@/components/ui";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { statusVariant, formatDate, formatCurrency, todayIST } from "@/lib/utils";

interface StaffRow {
  id: number;
  staff_code: string;
  member_id: number | null;
  name: string;
  role: string;
  phone: string;
  email: string;
  address: string;
  joined_date: string | null;
  salary: number;
  payment_frequency: string;
  status: string;
  notes: string;
  archive_state: number;
  archived_at: string | null;
  archive_reason: string | null;
  linked_member_code?: string;
  linked_member_name?: string;
  linked_member_mobile?: string;
}

interface PaymentRow {
  id: number;
  staff_id: number;
  staff_code: string;
  staff_name: string;
  staff_role: string;
  period_month: number;
  period_year: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  transaction_ref: string;
  status: string;
  notes: string;
  paid_by: number | null;
}

interface HistoryRow { id: number; changed_at: string; action: string; username: string; summary: string; changes_json: string; reason: string; }

const emptyForm: Partial<StaffRow> & { memberId?: number | null } = {
  name: "", role: "Imam", phone: "", email: "", address: "",
  joined_date: "", salary: 0, payment_frequency: "Monthly",
  status: "Active", notes: "", member_id: null
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Staff() {
  const { t, isMalayalam } = useI18n();
  const tx = (en: string, ml: string) => isMalayalam() ? ml : en;
  const ml = isMalayalam();

  const [tab, setTab] = useState<"active" | "archived" | "salary">("active");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [roles, setRoles] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<number>(new Date().getFullYear());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<StaffRow> & { memberId?: number | null }>(emptyForm);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<StaffRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  // Resign / Expel — secure actions with effective date, reason and
  // administrator password (verified in the main process).
  const [statusAction, setStatusAction] = useState<"Resigned" | "Expelled" | null>(null);
  const [statusTarget, setStatusTarget] = useState<StaffRow | null>(null);
  // Salary payment cancellation — reason + administrator password.
  const [cancelPayTarget, setCancelPayTarget] = useState<PaymentRow | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState<any>({
    staffId: 0, periodMonth: new Date().getMonth() + 1, periodYear: new Date().getFullYear(),
    amount: 0, paymentDate: todayIST(), paymentMethod: "Cash",
    transactionRef: "", notes: ""
  });

  // Use the list hook for either active staff or archived staff depending on tab.
  const listFn = (filter: any) => window.mms.staff.list({
    ...filter,
    status: tab === "archived" ? "Archived" : "Active"
  });
  const { rows, total, totalPages, loading, refetch, setFilters, page, setPage } = useList(listFn, { pageSize: 20, initialFilters: { role: "All" } });

  // When tab changes, force a refetch (useList stores listFn in a ref,
  // so changing the tab closure alone doesn't trigger re-fetch).
  useEffect(() => { setPage(1); setFilters({ role: roleFilter }); setTimeout(() => refetch(), 0); }, [tab]);

  // Salary payments list (separate, only when on salary tab).
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const paymentsTotalPages = Math.max(1, Math.ceil(paymentsTotal / 20));

  // Salary summary.
  const [summary, setSummary] = useState<any>(null);

  const refreshRoles = async () => { try { setRoles(await window.mms.staff.roles()); } catch {} };
  const refreshPayments = async () => {
    if (tab !== "salary") return;
    setPaymentsLoading(true);
    try {
      const r = await window.mms.staff.listPayments({ year: yearFilter, page: paymentsPage, pageSize: 20 });
      setPayments(r.rows || []); setPaymentsTotal(r.total || 0);
    } catch (e: any) { toast.error(e.message); }
    finally { setPaymentsLoading(false); }
  };
  const refreshSummary = async () => {
    try { setSummary(await window.mms.staff.salarySummary(yearFilter)); } catch {}
  };

  useEffect(() => { refreshRoles(); }, []);
  useEffect(() => { setFilters({ role: roleFilter }); }, [roleFilter, setFilters]);
  useEffect(() => { refreshPayments(); refreshSummary(); }, [tab, yearFilter, paymentsPage]);

  const save = async () => {
    if (!form.name) { toast.error(t("staff_name_required")); return; }
    try {
      const payload = {
        memberId: form.member_id || null,
        name: form.name,
        role: form.role || "Staff",
        phone: form.phone || "",
        email: form.email || "",
        address: form.address || "",
        joinedDate: form.joined_date || null,
        salary: Number(form.salary || 0),
        paymentFrequency: form.payment_frequency || "Monthly",
        status: form.status || "Active",
        notes: form.notes || ""
      };
      if (editingId) await window.mms.staff.update(editingId, payload);
      else await window.mms.staff.create(payload);
      toast.success(t("staff_saved"));
      setDialogOpen(false); setEditingId(null); setForm(emptyForm); refetch();
    } catch (e: any) { toast.error(e.message || t("ui_failed_save")); }
  };

  const edit = async (id: number) => {
    const s = await window.mms.staff.get(id);
    setForm(s || emptyForm); setEditingId(id); setDialogOpen(true);
  };

  const openPreview = async (s: StaffRow) => {
    setPreview(s); setPreviewOpen(true);
    try { setHistory(await window.mms.staff.history(s.id)); } catch { setHistory([]); }
  };

  const openStatus = (action: "Resigned" | "Expelled", target?: StaffRow) => {
    const t = target || preview;
    if (!t) return;
    setStatusTarget(t);
    setStatusAction(action);
  };

  const executeStatus = async ({ reason, date, password }: { reason: string; date?: string; password: string }) => {
    if (!statusTarget || !statusAction) return;
    await window.mms.staff.setStatus(statusTarget.id, statusAction, date || "", reason, password);
    toast.success(statusAction === "Expelled"
      ? tx(`Expelled effective ${date || "today"} — recorded in the audit log`, `പുറത്താക്കി — ഓഡിറ്റ് ലോഗിൽ രേഖപ്പെടുത്തി`)
      : tx(`Resignation recorded effective ${date || "today"}`, `രാജി രേഖപ്പെടുത്തി — ${date || "ഇന്ന്"} മുതൽ`));
    setPreviewOpen(false); refetch(); refreshSummary();
  };

  const executeRestore = async () => {
    if (!preview) return;
    try {
      await window.mms.staff.restore(preview.id);
      toast.success(t("staff_restored_toast"));
      setPreviewOpen(false); refetch();
    } catch (e: any) { toast.error(e.message); }
  };

  const openPay = (s?: StaffRow) => {
    const target = s || preview;
    if (!target) return;
    setPayForm({
      staffId: target.id,
      staffCode: target.staff_code,
      staffName: target.name,
      periodMonth: new Date().getMonth() + 1,
      periodYear: new Date().getFullYear(),
      amount: target.salary || 0,
      paymentDate: todayIST(),
      paymentMethod: "Cash",
      transactionRef: "",
      notes: ""
    });
    setPayOpen(true);
  };

  const executePay = async () => {
    if (!payForm.staffId || !payForm.periodMonth || !payForm.periodYear) return;
    try {
      await window.mms.staff.paySalary({
        staffId: payForm.staffId,
        periodMonth: payForm.periodMonth,
        periodYear: payForm.periodYear,
        amount: Number(payForm.amount),
        paymentDate: payForm.paymentDate,
        paymentMethod: payForm.paymentMethod,
        transactionRef: payForm.transactionRef,
        notes: payForm.notes,
        status: "Paid"
      });
      toast.success(t("staff_salary_paid"));
      setPayOpen(false);
      if (tab === "salary") refreshPayments();
      refreshSummary();
    } catch (e: any) { toast.error(e.message); }
  };

  const openCancelPayment = (p: PaymentRow) => { setCancelPayTarget(p); };

  const executeCancelPayment = async ({ reason, password }: { reason: string; password: string }) => {
    if (!cancelPayTarget) return;
    await window.mms.staff.cancelPayment(cancelPayTarget.id, reason, password);
    toast.success(t("staff_payment_cancelled"));
    refreshPayments(); refreshSummary();
  };

  const displayStatus = (r: StaffRow) => r.archive_state ? (r.status === "Expelled" ? tx("Expelled", "പുറത്താക്കി") : r.status === "Resigned" ? t("staff_resigned") : t("staff_archived")) : (r.status === "Active" ? t("staff_active") : r.status === "Inactive" ? t("staff_inactive") : r.status === "Expelled" ? tx("Expelled", "പുറത്താക്കി") : t("staff_resigned"));

  const columns: Column<StaffRow>[] = useMemo(() => [
    { header: t("staff_code"), accessor: r => <span className="code-text-sm text-primary">{r.staff_code}</span>, width: "110px" },
    { header: t("staff_name"), accessor: r => <span className="font-medium">{r.name}</span> },
    { header: t("staff_role"), accessor: r => <Badge variant="muted">{r.role}</Badge> },
    { header: t("staff_phone"), accessor: r => r.phone || "—" },
    { header: t("staff_salary"), accessor: r => <span className="font-mono">{formatCurrency(r.salary || 0)}</span> },
    { header: t("staff_joined_date"), accessor: r => r.joined_date ? formatDate(r.joined_date) : "—" },
    { header: t("staff_status"), accessor: r => <Badge variant={statusVariant(displayStatus(r))}>{displayStatus(r)}</Badge> },
    {
      header: "", align: "right", accessor: r => (
        <div className="rowact">
          <button className="act-btn act-edit" onClick={() => edit(r.id)} title={t("action_edit")}><Edit2 className="h-4 w-4" /></button>
          {tab === "active" && <button className="act-btn" onClick={() => openPay(r)} title={t("staff_pay_salary")}><Wallet className="h-4 w-4" /></button>}
          <button className="act-btn" onClick={() => openPreview(r)} title={tx("View", "കാണുക")}><Eye className="h-4 w-4" /></button>
        </div>
      )
    }
  ], [tab, ml, roles]);

  const paymentColumns: Column<PaymentRow>[] = useMemo(() => [
    { header: t("staff_code"), accessor: r => <span className="code-text-sm text-primary">{r.staff_code}</span>, width: "110px" },
    { header: t("staff_name"), accessor: r => <span className="font-medium">{r.staff_name}</span> },
    { header: t("staff_role"), accessor: r => <Badge variant="muted">{r.staff_role}</Badge> },
    { header: tx("Period", "കാലയളവ്"), accessor: r => `${MONTH_NAMES[r.period_month - 1]} ${r.period_year}` },
    { header: t("staff_amount"), accessor: r => <span className="font-mono">{formatCurrency(r.amount)}</span> },
    { header: t("staff_payment_date"), accessor: r => formatDate(r.payment_date) },
    { header: t("staff_payment_method"), accessor: r => r.payment_method },
    { header: t("staff_status"), accessor: r => <Badge variant={r.status === "Paid" ? statusVariant("Active") : r.status === "Pending" ? statusVariant("Pending") : "muted"}>{r.status}</Badge> },
    {
      header: "", align: "right", accessor: r => r.status === "Paid" ? (
        <button className="act-btn" onClick={() => openCancelPayment(r)} title={t("staff_cancel_payment")}><XCircle className="h-4 w-4" /></button>
      ) : <span />
    }
  ], [ml]);

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em"><Briefcase size={20} /></div>
        <div>
          <h1>{t("staff_title")}</h1>
          <div className="vs">{t("staff_subtitle")}</div>
        </div>
        <div className="vr">
          {tab === "active" && <Button onClick={() => { setForm(emptyForm); setEditingId(null); setDialogOpen(true); }}><Plus className="h-4 w-4" />{t("staff_add")}</Button>}
        </div>
      </div>

      {summary && (
        <div className="stat-grid stat-grid-3">
          <div className="stat t-em"><div className="val">{summary.activeStaffCount ?? 0}</div><div className="slab">{t("staff_summary_active")}</div></div>
          <div className="stat t-sky"><div className="val val-sm">{formatCurrency(summary.totalPaid ?? 0)}</div><div className="slab">{t("staff_summary_paid_year")} · {yearFilter}</div></div>
          <div className="stat t-gold"><div className="val val-sm">{formatCurrency(summary.totalPending ?? 0)}</div><div className="slab">{t("staff_summary_pending_year")} · {yearFilter}</div></div>
        </div>
      )}

      <div className="card card-pad-tight">
        <div className="flex items-center gap-2 mb-3 border-b border-border pb-3">
          <button className={tab === "active" ? "btn bp" : "btn"} onClick={() => { setTab("active"); setPage(1); }}>{t("staff_tab_active")}</button>
          <button className={tab === "archived" ? "btn bp" : "btn"} onClick={() => { setTab("archived"); setPage(1); }}>{t("staff_tab_archived")}</button>
          <button className={tab === "salary" ? "btn bp" : "btn"} onClick={() => { setTab("salary"); setPaymentsPage(1); }}>{t("staff_tab_salary")}</button>
          <div className="flex-1" />
          {tab === "salary" && (
            <Select value={String(yearFilter)} onChange={e => { setYearFilter(Number(e.target.value)); setPaymentsPage(1); }} className="w-32">
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          )}
        </div>

        {tab !== "salary" ? (
          <DataTable
            columns={columns}
            rows={rows as StaffRow[]}
            loading={loading}
            total={total}
            page={page}
            pageSize={20}
            totalPages={totalPages}
            onPageChange={setPage}
            searchValue={search}
            onSearchChange={setSearch}
            rowKey={r => r.id}
            onRowDoubleClick={openPreview}
            toolbar={
              <div className="flex gap-2">
                <Select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="w-40">
                  <option value="All">{tx("All Roles", "എല്ലാ റോളുകളും")}</option>
                  {roles.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
            }
          />
        ) : (
          <DataTable
            columns={paymentColumns}
            rows={payments}
            loading={paymentsLoading}
            total={paymentsTotal}
            page={paymentsPage}
            pageSize={20}
            totalPages={paymentsTotalPages}
            onPageChange={setPaymentsPage}
            rowKey={r => r.id}
          />
        )}
      </div>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title={t("staff_title")} className="max-w-2xl">
        <div className="dlg-pad">
          {preview && (
            <>
              <div className="dlg-hero t-em">
                <div className="dlg-hero-ic">{(preview.name || "?").charAt(0).toUpperCase()}</div>
                <div className="dlg-hero-body">
                  <div className="dlg-hero-title">{preview.name}</div>
                  <div className="dlg-hero-sub code-text-sm">{preview.staff_code} · {preview.role}</div>
                </div>
                <Badge variant={statusVariant(displayStatus(preview))}>{displayStatus(preview)}</Badge>
              </div>
              <div className="det-grid">
                {[
                  [t("staff_code"), preview.staff_code],
                  [t("staff_name"), preview.name],
                  [t("staff_role"), preview.role],
                  [t("staff_phone"), preview.phone || "—"],
                  [t("staff_email"), preview.email || "—"],
                  [t("staff_joined_date"), preview.joined_date ? formatDate(preview.joined_date) : "—"],
                  [t("staff_salary"), formatCurrency(preview.salary || 0)],
                  [t("staff_payment_frequency"), preview.payment_frequency],
                  [t("staff_linked_member"), preview.linked_member_code ? `${preview.linked_member_name} (${preview.linked_member_code})` : "—"],
                  [t("staff_address"), preview.address || "—"],
                  [t("staff_notes"), preview.notes || "—"]
                ].map(([k, v], i) => <div className="det" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>)}
              </div>

              <div className="mt-5">
                <div className="flex items-center gap-2 mb-3"><History size={16} /><strong>{t("staff_history")}</strong></div>
                <div className="space-y-2 max-h-56 overflow-auto">
                  {history.length ? history.map(h => (
                    <div key={h.id} className="p-3 rounded-lg border border-border">
                      <div className="flex justify-between gap-3"><b>{h.summary}</b><span className="text-xs text-muted">{h.changed_at}</span></div>
                      <div className="text-xs text-muted mt-1">{h.username} · {h.action}{h.reason ? ` · ${h.reason}` : ""}</div>
                      {h.changes_json && <pre className="text-xs mt-2 whitespace-pre-wrap">{h.changes_json}</pre>}
                    </div>
                  )) : <div className="text-sm text-muted">{t("staff_no_history")}</div>}
                </div>
              </div>
            </>
          )}
          <div className="dlg-actions">
            <Button variant="secondary" onClick={() => setPreviewOpen(false)}>{t("ui_close")}</Button>
            {preview?.archive_state ? (
              <Button onClick={executeRestore}><RotateCcw size={14} />{t("staff_restore")}</Button>
            ) : (
              <>
                <Button onClick={() => edit(preview!.id)}><Edit2 size={14} />{t("action_edit")}</Button>
                <Button variant="secondary" onClick={() => openPay()}><Wallet size={14} />{t("staff_pay_salary")}</Button>
                <Button variant="secondary" onClick={() => openStatus("Resigned")}><LogOut size={14} />{tx("Resign", "രാജി")}</Button>
                <Button variant="danger" onClick={() => openStatus("Expelled")}><UserX size={14} />{tx("Expel", "പുറത്താക്കുക")}</Button>
              </>
            )}
          </div>
        </div>
      </Dialog>

      {/* Resign / Expel — secure gate (effective date + reason + admin password) */}
      <SecureActionDialog
        open={statusAction !== null && !!statusTarget}
        onClose={() => { setStatusAction(null); setStatusTarget(null); }}
        onConfirm={executeStatus}
        title={statusAction === "Expelled" ? tx("Expel staff member", "ജീവനക്കാരനെ പുറത്താക്കുക") : tx("Record resignation", "രാജി രേഖപ്പെടുത്തുക")}
        description={
          statusTarget
            ? (statusAction === "Expelled"
                ? tx(
                    `End the service of ${statusTarget.name} (${statusTarget.staff_code}) as EXPELLED. Salary history is preserved.`,
                    `${statusTarget.name} (${statusTarget.staff_code}) ന്റെ സേവനം പുറത്താക്കി അവസാനിപ്പിക്കുന്നു. ശമ്പള ചരിത്രം സംരക്ഷിക്കും.`
                  )
                : tx(
                    `Record the resignation of ${statusTarget.name} (${statusTarget.staff_code}). Salary history is preserved.`,
                    `${statusTarget.name} (${statusTarget.staff_code}) ന്റെ രാജി രേഖപ്പെടുത്തുന്നു. ശമ്പള ചരിത്രം സംരക്ഷിക്കും.`
                  ))
            : ""
        }
        dateLabel={statusAction === "Expelled" ? tx("Effective date of expulsion", "പുറത്താക്കലിന്റെ തീയതി") : tx("Resignation effective date", "രാജിയുടെ തീയതി")}
        dateDefault={todayIST()}
        confirmLabel={statusAction === "Expelled" ? tx("Expel", "പുറത്താക്കുക") : tx("Record resignation", "രാജി രേഖപ്പെടുത്തുക")}
      />

      {/* Cancel salary payment — secure gate (reason + admin password) */}
      <SecureActionDialog
        open={!!cancelPayTarget}
        onClose={() => setCancelPayTarget(null)}
        onConfirm={executeCancelPayment}
        title={t("staff_cancel_payment")}
        description={
          cancelPayTarget
            ? tx(
                `Cancel the ${MONTH_NAMES[cancelPayTarget.period_month - 1]} ${cancelPayTarget.period_year} salary payment of ${formatCurrency(cancelPayTarget.amount)} to ${cancelPayTarget.staff_name}?`,
                `${cancelPayTarget.staff_name} ന് നൽകിയ ${MONTH_NAMES[cancelPayTarget.period_month - 1]} ${cancelPayTarget.period_year} ശമ്പള പേയ്‌മെന്റ് (${formatCurrency(cancelPayTarget.amount)}) റദ്ദാക്കണോ?`
              )
            : ""
        }
        confirmLabel={t("staff_cancel_payment")}
      />

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? t("staff_edit") : t("staff_add")} className="max-w-3xl">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>{t("staff_name")} *</Label><Input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>{t("staff_role")}</Label>
              <Select value={form.role || "Staff"} onChange={e => setForm({ ...form, role: e.target.value })}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div><Label>{t("staff_phone")}</Label><Input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>{t("staff_email")}</Label><Input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>{t("staff_joined_date")}</Label><Input type="date" value={form.joined_date || ""} onChange={e => setForm({ ...form, joined_date: e.target.value })} /></div>
            <div><Label>{t("staff_salary")}</Label><Input type="number" value={form.salary || 0} onChange={e => setForm({ ...form, salary: Number(e.target.value) })} /></div>
            <div><Label>{t("staff_payment_frequency")}</Label>
              <Select value={form.payment_frequency || "Monthly"} onChange={e => setForm({ ...form, payment_frequency: e.target.value })}>
                <option value="Monthly">{tx("Monthly", "പ്രതിമാസം")}</option>
                <option value="Quarterly">{tx("Quarterly", "ത്രൈമാസികം")}</option>
                <option value="Annually">{tx("Annually", "വാർഷികം")}</option>
                <option value="OnDemand">{tx("On demand", "ആവശ്യാനുസരണം")}</option>
              </Select>
            </div>
            <div><Label>{t("staff_status")}</Label>
              <Select value={form.status || "Active"} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="Active">{t("staff_active")}</option>
                <option value="Inactive">{t("staff_inactive")}</option>
              </Select>
              <div className="text-xs text-muted mt-1.5">{tx("Resignation / expulsion is executed from the member's view with date, reason and admin password.", "രാജി / പുറത്താക്കൽ അംഗത്തിന്റെ വിവരങ്ങൾ തുറന്ന്, തീയതി, കാരണം, അഡ്മിൻ പാസ്‌വേഡ് എന്നിവയോടെ നടത്തുന്നു.")}</div>
            </div>
          </div>
          <div><Label>{t("staff_address")}</Label><Textarea rows={2} value={form.address || ""} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div><Label>{t("staff_notes")}</Label><Textarea rows={2} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={save}>{t("action_save")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Pay salary dialog */}
      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title={t("staff_pay_salary_title")} className="modal-sm">
        <div className="p-6 space-y-4">
          <div className="bg-surface-hover/50 rounded-lg p-3 text-sm">
            <b>{payForm.staffName}</b> · <span className="code-text-sm">{payForm.staffCode}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>{t("staff_period_month")} *</Label>
              <Select value={String(payForm.periodMonth)} onChange={e => setPayForm({ ...payForm, periodMonth: Number(e.target.value) })}>
                {MONTHS.map(m => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}
              </Select>
            </div>
            <div><Label>{t("staff_period_year")} *</Label>
              <Input type="number" value={payForm.periodYear} onChange={e => setPayForm({ ...payForm, periodYear: Number(e.target.value) })} />
            </div>
            <div><Label>{t("staff_amount")} *</Label><Input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: Number(e.target.value) })} /></div>
            <div><Label>{t("staff_payment_date")}</Label><Input type="date" value={payForm.paymentDate} onChange={e => setPayForm({ ...payForm, paymentDate: e.target.value })} /></div>
            <div><Label>{t("staff_payment_method")}</Label>
              <Select value={payForm.paymentMethod} onChange={e => setPayForm({ ...payForm, paymentMethod: e.target.value })}>
                <option value="Cash">{tx("Cash", "പണം")}</option>
                <option value="Bank Transfer">{tx("Bank Transfer", "ബാങ്ക് ട്രാൻസ്ഫർ")}</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">{tx("Cheque", "ചെക്ക്")}</option>
                <option value="Other">{tx("Other", "മറ്റ്")}</option>
              </Select>
            </div>
            <div><Label>{t("staff_transaction_ref")}</Label><Input value={payForm.transactionRef} onChange={e => setPayForm({ ...payForm, transactionRef: e.target.value })} /></div>
          </div>
          <div><Label>{t("staff_payment_notes")}</Label><Textarea rows={2} value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPayOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={executePay}><Wallet size={14} />{t("staff_pay_salary")}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
