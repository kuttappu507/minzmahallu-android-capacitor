import { useState, useEffect } from "react";
import { Plus, Edit2, Check, X, Send, Eye, ShieldCheck, Users, MapPin, Phone } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList } from "@/hooks/useList";
import { Card, CardContent, Button, Dialog, Input, Label, Select, Textarea, Badge, SectionLabel } from "@/components/ui";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { formatCurrency, statusVariant, formatDate } from "@/lib/utils";

interface Welfare {
  id: number;
  request_number: string;
  applicant_name: string;
  family_id: number;
  category: string;
  amount_requested: number;
  amount_approved: number;
  reason: string;
  remarks: string;
  status: string;
  request_date: string;
  rejection_reason: string;
  processed_by: number;
  processed_date: string;
  disbursed_date: string;
  minutes_date?: string;
}

interface MemberInfo { name: string; mobile: string; address: string; house_name: string; family_number: string; }

const emptyForm: Partial<Welfare> = {
  request_number: "", applicant_name: "", family_id: 0, category: "",
  amount_requested: 0, amount_approved: 0, reason: "", remarks: "", status: "Pending",
};

const codeFontStyle = "code-text-sm";

export function Welfare() {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const tx = (en: string, m: string) => (ml ? m : en);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Welfare>>(emptyForm);
  const [families, setFamilies] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  // Person-from-mahallu cascade: family FIRST, then the person (same flow as
  // the marriage / death registers). Selecting a member prefills the applicant
  // name, links the family AND shows the prefilled address / contact data.
  const [fromMahallu, setFromMahallu] = useState(false);
  const [familyId, setFamilyId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [memberInfo, setMemberInfo] = useState<MemberInfo | null>(null);
  const [approveAmount, setApproveAmount] = useState(0);
  const [approveRemarks, setApproveRemarks] = useState("");
  const [approveMinutesDate, setApproveMinutesDate] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<Welfare | null>(null);
  // Secure disbursement: reason + administrator password (+ minutes date shown).
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [disburseTarget, setDisburseTarget] = useState<Welfare | null>(null);

  const { rows, total, totalPages, loading, refetch, page, setPage } = useList(
    (filter) => window.mms.welfare.list(filter),
    { pageSize: 20 }
  );

  useEffect(() => {
    window.mms.families.list({ pageSize: 1000 }).then((r) => setFamilies(r.rows || [])).catch(() => {});
    window.mms.welfare.categories().then((r) => setCategories((r || []).map((name: any) => typeof name === "string" ? { name } : name))).catch(() => {});
  }, []);

  // Cascading: load members of the chosen family for the from-mahallu picker.
  useEffect(() => {
    if (!familyId) { setFamilyMembers([]); return; }
    window.mms.members.list({ familyId: Number(familyId), status: "Active", pageSize: 1000 })
      .then((r) => setFamilyMembers(r.rows || []))
      .catch(() => setFamilyMembers([]));
  }, [familyId]);

  // Prefill applicant details from the selected mahallu member — name, family
  // link AND the balance data (address, contact) for verification.
  const selectMember = async (id: string) => {
    setMemberId(id);
    setMemberInfo(null);
    if (!id) return;
    try {
      const m = await window.mms.members.get(Number(id));
      if (!m) return;
      let addr = m.address || "";
      let houseName = "";
      let familyNumber = "";
      if (m.family_id) {
        try {
          const f = await window.mms.families.get(m.family_id);
          if (f) {
            houseName = f.house_name || "";
            familyNumber = f.family_number || "";
            if (!addr) addr = [f.address, f.area, f.ward].filter(Boolean).join(", ") + (f.pincode ? ` - ${f.pincode}` : "");
          }
        } catch {}
      }
      setForm((v) => ({ ...v, applicant_name: m.name || "", family_id: m.family_id || v.family_id }));
      setMemberInfo({ name: m.name || "", mobile: m.mobile || "", address: addr, house_name: houseName, family_number: familyNumber });
    } catch {
      const m = familyMembers.find((x) => String(x.id) === id);
      if (m) setForm((v) => ({ ...v, applicant_name: m.name, family_id: m.family_id || v.family_id }));
    }
  };

  const resetNewRequest = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFromMahallu(false);
    setFamilyId("");
    setMemberId("");
    setMemberInfo(null);
    setFamilyMembers([]);
    setDialogOpen(true);
  };

  const totalRequested = (rows as Welfare[]).reduce((s, r) => s + (r.amount_requested || 0), 0);
  const totalApproved = (rows as Welfare[]).reduce((s, r) => s + (r.amount_approved || 0), 0);

  const handleSave = async () => {
    if (!form.applicant_name || !form.amount_requested) {
      toast.error(t("ui_applicant_amount_required"));
      return;
    }
    try {
      const payload: any = {
        applicantName: form.applicant_name,
        familyId: form.family_id || null,
        category: form.category || "",
        amountRequested: form.amount_requested,
        amountApproved: form.amount_approved ?? 0,
        reason: form.reason || "",
        remarks: form.remarks || "",
        processedBy: 1,
      };
      if (editingId) {
        await window.mms.welfare.update(editingId, payload);
        toast.success(t("ui_save_changes"));
      } else {
        await window.mms.welfare.create(payload);
        toast.success(t("wel_new_request"));
      }
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      setFromMahallu(false);
      setFamilyId("");
      setMemberId("");
      setMemberInfo(null);
      setFamilyMembers([]);
      refetch();
    } catch (err: any) {
      toast.error(err.message || t("ui_failed_save"));
    }
  };

  const handleEdit = async (id: number) => {
    const w = await window.mms.welfare.get(id);
    setForm(w || emptyForm);
    setApproveAmount(w?.amount_approved || w?.amount_requested || 0);
    setApproveRemarks(w?.remarks || "");
    setApproveMinutesDate(w?.minutes_date || "");
    setRejectReason("");
    setEditingId(id);
    setFromMahallu(false);
    setFamilyId("");
    setMemberId("");
    setMemberInfo(null);
    setFamilyMembers([]);
    setDialogOpen(true);
  };

  const handleRowDoubleClick = (row: Welfare) => {
    setPreviewRow(row);
    setPreviewOpen(true);
  };

  const switchToEdit = async () => {
    if (!previewRow) return;
    const id = previewRow.id;
    setPreviewOpen(false);
    setPreviewRow(null);
    await handleEdit(id);
  };

  // Approval records the date of the committee minutes in which the amount was
  // agreed — the foolproof workflow trail verified again at disbursement.
  const handleApprove = async () => {
    if (!editingId) return;
    if (!approveMinutesDate) {
      toast.error(tx("Date of the committee minutes approving this amount is required", "തുക അംഗീകരിച്ച കമ്മിറ്റി മിനിറ്റ്‌സിന്റെ തീയതി ആവശ്യമാണ്"));
      return;
    }
    try {
      await window.mms.welfare.approve(editingId, approveAmount, approveRemarks, approveMinutesDate);
      toast.success(t("ui_request_approved"));
      setDialogOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleReject = async () => {
    if (!editingId) return;
    if (!rejectReason) {
      toast.error(t("ui_rejection_required"));
      return;
    }
    try {
      await window.mms.welfare.reject(editingId, rejectReason);
      toast.success(t("ui_request_rejected"));
      setDialogOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const openDisburse = (row: Welfare) => {
    setDisburseTarget(row);
    setDisburseOpen(true);
  };

  const executeDisburse = async ({ reason, password }: { reason: string; password: string }) => {
    if (!disburseTarget) return;
    await window.mms.welfare.disburse(disburseTarget.id, reason, password);
    toast.success(t("ui_marked_disbursed"));
    refetch();
    setDialogOpen(false);
  };

  const columns: Column<Welfare>[] = [
    {
      header: t("wel_request_no"),
      accessor: (r) => (
        <span className={codeFontStyle + " text-primary"}>
          {r.request_number}
        </span>
      ),
    },
    { header: t("wel_applicant"), accessor: (r) => <span className="font-medium">{r.applicant_name}</span> },
    { header: t("don_category"), accessor: (r) => <Badge variant="muted">{r.category}</Badge> },
    { header: t("wel_amount_requested"), accessor: (r) => formatCurrency(r.amount_requested) },
    { header: t("wel_amount_approved"), accessor: (r) => formatCurrency(r.amount_approved) },
    {
      header: t("family_status"),
      accessor: (r) => {
        const stepMap: Record<string, number> = { Pending: 1, Approved: 2, Disbursed: 3, Rejected: 0, Closed: 3 };
        const step = stepMap[r.status] ?? 0;
        const colors: Record<string, string> = { Pending: "warning", Approved: "info", Disbursed: "success", Rejected: "danger", Closed: "muted" };
        return <div className="flex items-center gap-2"><Badge variant={colors[r.status] || "muted"}>{r.status}</Badge>{step > 0 && <div className="flex gap-0.5">{[1,2,3].map(s=><div key={s} className={`w-1.5 h-1.5 rounded-full ${s<=step?"bg-emerald-500":"bg-gray-300"}`} />)}</div>}</div>;
      },
    },
    {
      header: "",
      accessor: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {r.status === "Approved" && (
            <Button variant="ghost" size="icon" title={t("wel_mark_disbursed")} onClick={() => openDisburse(r)}>
              <Send className="h-4 w-4 text-emerald-600" />
            </Button>
          )}
          <button className="act-btn act-edit" onClick={() => handleEdit(r.id)}>
            <Edit2 className="h-4 w-4" />
          </button>
        </div>
      ),
      align: "right",
    },
  ];

  const previewDetails = previewRow
    ? [
        { k: t("wel_request_no"), v: previewRow.request_number },
        { k: t("wel_applicant"), v: previewRow.applicant_name },
        { k: t("don_category"), v: previewRow.category || "—" },
        { k: t("wel_amount_requested"), v: formatCurrency(previewRow.amount_requested) },
        { k: t("wel_amount_approved"), v: formatCurrency(previewRow.amount_approved) },
        { k: tx("Minutes date", "മിനിറ്റ്‌സ് തീയതി"), v: previewRow.minutes_date ? formatDate(previewRow.minutes_date) : "—" },
        { k: t("family_status"), v: previewRow.status },
        { k: t("ui_request_date"), v: previewRow.request_date || "—" },
        { k: t("ui_processed_date"), v: previewRow.processed_date || "—" },
        { k: t("ui_disbursed_date"), v: previewRow.disbursed_date || "—" },
        { k: t("wel_reason"), v: previewRow.reason || "—", full: true },
        { k: t("ui_remarks"), v: previewRow.remarks || "—", full: true },
        { k: t("ui_rejection_reason"), v: previewRow.rejection_reason || "—", full: true },
      ]
    : [];

  return (
    <div className="view view-enter">
      <div className="vhead">
        <div className="modic t-em">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h1>{t("wel_title")}</h1>
          <div className="vs">{t("wel_subtitle")}</div>
        </div>
        <div className="vr">
          <Button onClick={resetNewRequest}>
            <Plus className="h-4 w-4" />
            {t("wel_new_request")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-grid stat-grid-2">
        <div className="stat t-em">
          <div className="srow">
            <span className="sic"><ShieldCheck size={18} /></span>
            <span className="delta">{t("wel_requested")}</span>
          </div>
          <div className="val">{formatCurrency(totalRequested)}</div>
          <div className="slab">{t("wel_total_requested")}</div>
        </div>
        <div className="stat t-gold">
          <div className="srow">
            <span className="sic"><Check size={18} /></span>
            <span className="delta">{t("wel_approved")}</span>
          </div>
          <div className="val">{formatCurrency(totalApproved)}</div>
          <div className="slab">{t("wel_total_approved")}</div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows as Welfare[]}
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
            <option value="Pending">{t("status_pending")}</option>
            <option value="Approved">{t("status_approved")}</option>
            <option value="Rejected">{t("status_rejected")}</option>
            <option value="Disbursed">{t("status_disbursed")}</option>
          </Select>
        }
      />

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewRow(null); }}
        title={t("wel_title")}
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
                    {previewRow.applicant_name}
                  </div>
                  <div className="dlg-hero-sub">
                    {previewRow.request_number} · {formatCurrency(previewRow.amount_requested)}
                  </div>
                </div>
                <Badge variant={statusVariant(previewRow.status)}>{previewRow.status}</Badge>
              </div>
              <div className="dlg-sec"><b>{tx("Request & approval", "അപേക്ഷയും അംഗീകാരവും")}</b></div>
              <div className="det-grid">
                {previewDetails.slice(0, 7).map((d, i) => (
                  <div key={i} className={`det${d.full ? " full" : ""}`}>
                    <span className="k">{d.k}</span>
                    <span className="v">{d.v}</span>
                  </div>
                ))}
              </div>
              <div className="dlg-sec"><b>{tx("Processing & notes", "നടപടികളും കുറിപ്പുകളും")}</b></div>
              <div className="det-grid">
                {previewDetails.slice(7).map((d, i) => (
                  <div key={i} className={`det${d.full ? " full" : ""}`}>
                    <span className="k">{d.k}</span>
                    <span className="v">{d.v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="dlg-actions">
            <Button variant="secondary" onClick={() => { setPreviewOpen(false); setPreviewRow(null); }}>
              {t("ui_close")}
            </Button>
            <Button onClick={switchToEdit}>
              <Edit2 size={14} />
              {t("action_edit")}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? t("action_edit") : t("wel_new_request")}
        className="max-w-2xl"
      >
        <div className="p-6 space-y-4">
          {/* Person-from-mahallu picker: family first, then member — prefills the applicant */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={fromMahallu}
              onChange={(e) => {
                setFromMahallu(e.target.checked);
                if (!e.target.checked) { setFamilyId(""); setMemberId(""); setMemberInfo(null); setFamilyMembers([]); }
              }}
            />
            <span className="text-sm">{tx("അപേക്ഷകൻ ഈ മഹല്ലിലെ അംഗമാണ്", "Applicant is from this Mahallu")}</span>
          </div>
          {fromMahallu && (
            <div className="space-y-3">
              <div>
                <Label><Users size={14} className="inline" /> {t("member_family")}</Label>
                <Select value={familyId} onChange={(e) => { setFamilyId(e.target.value); setMemberId(""); setMemberInfo(null); }}>
                  <option value="">{t("ui_select")}</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>{f.house_name} ({f.family_number})</option>
                  ))}
                </Select>
              </div>
              {familyId && (
                <div>
                  <Label><Users size={14} className="inline" /> {tx("അംഗത്തെ തിരഞ്ഞെടുക്കുക", "Select member")}</Label>
                  <Select value={memberId} onChange={(e) => selectMember(e.target.value)}>
                    <option value="">{t("ui_select")}</option>
                    {familyMembers.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name}{m.relationship ? ` · ${m.relationship}` : ""}</option>
                    ))}
                  </Select>
                </div>
              )}
              {/* Prefilled member data (balance details) for verification */}
              {memberInfo && (
                <div className="rounded-lg border border-border-subtle bg-surface-hover/40 p-3 text-sm space-y-1.5">
                  <div className="flex items-center gap-2 font-medium">
                    <Users size={14} className="text-primary" /> {memberInfo.name}
                    {memberInfo.house_name && <span className="text-muted">· {memberInfo.house_name} {memberInfo.family_number ? `(${memberInfo.family_number})` : ""}</span>}
                  </div>
                  {memberInfo.mobile && (
                    <div className="flex items-center gap-2 text-muted"><Phone size={13} /> {memberInfo.mobile}</div>
                  )}
                  {memberInfo.address && (
                    <div className="flex items-start gap-2 text-muted"><MapPin size={13} className="mt-0.5" /> {memberInfo.address}</div>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("wel_applicant")} *</Label>
              <Input value={form.applicant_name || ""} readOnly={fromMahallu && !!memberId} onChange={(e) => setForm({ ...form, applicant_name: e.target.value })} />
            </div>
            <div>
              <Label>{t("member_family")} (optional)</Label>
              <Select value={form.family_id || ""} onChange={(e) => setForm({ ...form, family_id: Number(e.target.value) })}>
                <option value="">{t("ui_none")}</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>{f.house_name} ({f.family_number})</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t("don_category")}</Label>
              <Select value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">{t("ui_select")}</option>
                {categories.map((c) => <option key={c.name || c.id} value={c.name}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>{t("wel_amount_requested")} *</Label>
              <Input type="number" value={form.amount_requested || ""} onChange={(e) => setForm({ ...form, amount_requested: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t("wel_amount_approved")}</Label>
              <Input type="number" value={form.amount_approved || ""} onChange={(e) => setForm({ ...form, amount_approved: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t("family_status")}</Label>
              <Input value={form.status || "Pending"} readOnly className="bg-surface-muted" />
            </div>
          </div>
          <div>
            <Label>{t("wel_reason")}</Label>
            <Textarea rows={2} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            <Label>{t("ui_remarks")}</Label>
            <Textarea rows={2} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>

          {/* Workflow actions for pending */}
          {editingId && form.status === "Pending" && (
            <>
              <div className="sec-divider">
                <SectionLabel>{t("wel_approve_request")}</SectionLabel>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>{t("wel_amount_approved")}</Label>
                    <Input type="number" value={approveAmount || ""} onChange={(e) => setApproveAmount(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>{tx("Minutes date", "മിനിറ്റ്‌സ് തീയതി")} *</Label>
                    <Input type="date" value={approveMinutesDate || ""} onChange={(e) => setApproveMinutesDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>{t("ui_remarks")}</Label>
                    <Input value={approveRemarks} onChange={(e) => setApproveRemarks(e.target.value)} />
                  </div>
                </div>
                <div className="text-xs text-muted mt-1.5">{tx("Date of the committee minutes in which this amount was agreed", "ഈ തുക അംഗീകരിച്ച കമ്മിറ്റി മിനിറ്റ്‌സിന്റെ തീയതി")}</div>
                <div className="flex gap-2 mt-3">
                  <Button onClick={handleApprove}>
                    <Check className="h-4 w-4" />
                    {t("action_approve")}
                  </Button>
                </div>
              </div>
              <div className="sec-divider">
                <SectionLabel>{t("wel_reject_request")}</SectionLabel>
                <div>
                  <Label>{t("ui_rejection_reason")} *</Label>
                  <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="danger" onClick={handleReject}>
                    <X className="h-4 w-4" />
                    {t("action_reject")}
                  </Button>
                </div>
              </div>
            </>
          )}

          {editingId && form.status === "Approved" && (
            <div className="sec-divider">
              <SectionLabel>{t("wel_mark_disbursed")}</SectionLabel>
              <div className="text-sm text-muted mb-2">
                {tx(
                  `Disbursement requires a reason and the administrator password. Minutes recorded: ${form.minutes_date ? formatDate(form.minutes_date) : "—"}`,
                  `വിതരണത്തിന് കാരണവും അഡ്മിൻ പാസ്‌വേഡും ആവശ്യമാണ്. രേഖപ്പെടുത്തിയ മിനിറ്റ്‌സ്: ${form.minutes_date ? formatDate(form.minutes_date) : "—"}`
                )}
              </div>
              <Button onClick={() => editingId && openDisburse(form as Welfare)}>
                <Send className="h-4 w-4" />
                {t("action_disburse")}
              </Button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 sec-divider">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={handleSave}>{t("action_save")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Disbursement — secure gate (reason + admin password) */}
      <SecureActionDialog
        open={disburseOpen}
        onClose={() => { setDisburseOpen(false); setDisburseTarget(null); }}
        onConfirm={executeDisburse}
        title={t("wel_mark_disbursed")}
        description={
          disburseTarget
            ? tx(
                `Disburse ${formatCurrency(disburseTarget.amount_approved)} to ${disburseTarget.applicant_name}? Minutes: ${disburseTarget.minutes_date ? formatDate(disburseTarget.minutes_date) : "—"}`,
                `${disburseTarget.applicant_name} ന് ${formatCurrency(disburseTarget.amount_approved)} വിതരണം ചെയ്യണോ? മിനിറ്റ്‌സ്: ${disburseTarget.minutes_date ? formatDate(disburseTarget.minutes_date) : "—"}`
              )
            : ""
        }
        confirmLabel={t("action_disburse")}
      />
    </div>
  );
}
