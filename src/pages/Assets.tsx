import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Landmark, TrendingUp, TrendingDown, Wallet, Home, Eye, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Dialog, Input, Label, Select, Textarea, Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { useList } from "@/hooks/useList";
import { formatCurrency, formatDate } from "@/lib/utils";

/** Mirrors the main-process assets service (V036). */
interface Asset {
  id: number;
  asset_code: string;
  name: string;
  category: string;
  reference_no: string;
  location: string;
  acquisition_date: string;
  acquisition_cost: number;
  current_value: number;
  status: string;
  condition_note: string;
  custodian: string;
  income_generating: number;
  tenant_name: string;
  monthly_rent: number;
  agreement_start: string;
  agreement_end: string;
  notes: string;
  income_total?: number;
  expense_total?: number;
}

interface Statement {
  income: number;
  expense: number;
  net: number;
  entries: Array<{ id: number; txn_date: string; type: string; amount: number; description: string; category: string | null; receipt_number: string; status: string | null }>;
}

interface AssetSummary {
  count: number;
  incomeGenerating: number;
  monthlyRentPotential: number;
  totalCurrentValue: number;
  byCategory: Array<{ category: string; count: number; value: number }>;
}

const CATEGORIES = ["Building", "Land", "Shop", "Room", "Hall", "Vehicle", "Furniture", "Equipment", "Other"];
const STATUSES = ["In use", "Given rent", "Vacant", "Under construction", "Sold", "Demolished", "Transferred"];
const CONDITIONS = ["Good", "Needs repair", "Dilapidated"];
const RETIRED = ["Sold", "Demolished", "Transferred"];

const emptyForm: Partial<Asset> = {
  name: "", category: "Building", reference_no: "", location: "", acquisition_date: "",
  acquisition_cost: 0, current_value: 0, status: "In use", condition_note: "Good",
  custodian: "", income_generating: 0, tenant_name: "", monthly_rent: 0,
  agreement_start: "", agreement_end: "", notes: "",
};

function statusVariant(s: string): "success" | "info" | "warning" | "muted" | "danger" | "default" {
  if (s === "In use" || s === "Given rent") return "success";
  if (s === "Vacant") return "warning";
  if (s === "Under construction") return "info";
  if (RETIRED.includes(s)) return "muted";
  return "default";
}

export function Assets() {
  const { t, isMalayalam } = useI18n();
  const tx = (en: string, ml: string) => (isMalayalam() ? ml : en);
  const { rows, total, page, totalPages, loading, search, setSearch, setPage, setFilters, refetch } = useList(
    (f: any) => window.mms.assets.list(f),
    { initialFilters: { category: "All", status: "All" } }
  );
  const [summary, setSummary] = useState<AssetSummary | null>(null);
  const [form, setForm] = useState<Partial<Asset>>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementAsset, setStatementAsset] = useState<Asset | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [catFilter, setCatFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const fetchSummary = async () => {
    try { setSummary(await window.mms.assets.summary()); } catch { /* card stays at zero */ }
  };
  useEffect(() => { fetchSummary(); }, []);

  useEffect(() => { setFilters({ category: catFilter, status: statusFilter }); }, [catFilter, statusFilter, setFilters]);

  const openAdd = () => { setForm({ ...emptyForm, acquisition_date: "" }); setEditingId(null); setDialogOpen(true); };
  const openEdit = async (id: number) => {
    const a = await window.mms.assets.get(id);
    setForm(a || emptyForm);
    setEditingId(id);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.error(tx("Asset name is required", "ആസ്തിയുടെ പേര് ആവശ്യമാണ്")); return; }
    const payload = {
      name: form.name,
      category: form.category || "Other",
      referenceNo: form.reference_no || "",
      location: form.location || "",
      acquisitionDate: form.acquisition_date || "",
      acquisitionCost: Number(form.acquisition_cost) || 0,
      currentValue: Number(form.current_value) || 0,
      status: form.status || "In use",
      conditionNote: form.condition_note || "Good",
      custodian: form.custodian || "",
      incomeGenerating: form.income_generating ? 1 : 0,
      tenantName: form.tenant_name || "",
      monthlyRent: Number(form.monthly_rent) || 0,
      agreementStart: form.agreement_start || "",
      agreementEnd: form.agreement_end || "",
      notes: form.notes || "",
    };
    try {
      if (editingId) { await window.mms.assets.update(editingId, payload); toast.success(t("ui_save_changes")); }
      else { const res = await window.mms.assets.create(payload); toast.success(tx(`Asset saved with code ${res.assetCode}`, `ആസ്തി സേവ് ചെയ്തു — കോഡ് ${res.assetCode}`)); }
      setDialogOpen(false); setForm(emptyForm); setEditingId(null);
      refetch(); fetchSummary();
    } catch (e: any) { toast.error(e.message || t("ui_failed_save")); }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    try {
      await window.mms.assets.remove(deleteId);
      toast.success(tx("Asset deleted", "ആസ്തി നീക്കം ചെയ്തു"));
      setDeleteId(null); refetch(); fetchSummary();
    } catch (e: any) { toast.error(e.message); setDeleteId(null); }
  };

  const openStatement = async (row: Asset) => {
    setStatementAsset(row);
    setStatement(null);
    setStatementOpen(true);
    try { setStatement(await window.mms.assets.statement(row.id)); }
    catch (e: any) { toast.error(e.message); }
  };

  const catLabel = (c: string) => ({
    "Building": tx("Building", "കെട്ടിടം"), "Land": tx("Land", "ഭൂമി"), "Shop": tx("Shop", "കട"),
    "Room": tx("Room", "മുറി"), "Hall": tx("Hall", "ഹാൾ"), "Vehicle": tx("Vehicle", "വാഹനം"),
    "Furniture": tx("Furniture", "ഫർണിച്ചർ"), "Equipment": tx("Equipment", "ഉപകരണങ്ങൾ"), "Other": tx("Other", "മറ്റുള്ളവ"),
  } as Record<string, string>)[c] || c;
  const statusLabel = (s: string) => ({
    "In use": tx("In use", "ഉപയോഗത്തിൽ"), "Given rent": tx("Given rent", "വാടാക്കയ്ക്ക് നൽകിയത്"),
    "Vacant": tx("Vacant", "ശൂന്യം"), "Under construction": tx("Under construction", "നിർമ്മാണത്തിൽ"),
    "Sold": tx("Sold", "വിറ്റു"), "Demolished": tx("Demolished", "പൊളിച്ചു"), "Transferred": tx("Transferred", "കൈമാറി"),
  } as Record<string, string>)[s] || s;
  const condLabel = (c: string) => ({
    "Good": tx("Good", "നല്ല അവസ്ഥ"), "Needs repair": tx("Needs repair", "അറ്റകുറ്റി വേണം"), "Dilapidated": tx("Dilapidated", "തകർന്ന അവസ്ഥ"),
  } as Record<string, string>)[c] || c;

  const columns: Column<Asset>[] = [
    { header: tx("Code", "കോഡ്"), accessor: r => <span className="code-text-sm text-primary">{r.asset_code}</span>, width: "90px" },
    { header: tx("Asset", "ആസ്തി"), accessor: r => (
      <div>
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-muted">{catLabel(r.category)}{r.reference_no ? ` · ${r.reference_no}` : ""}</div>
      </div>
    ) },
    { header: tx("Location", "സ്ഥലം"), accessor: r => r.location || <span className="text-muted">—</span>, width: "140px" },
    { header: tx("Status", "നില"), accessor: r => <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge>, width: "130px" },
    { header: tx("Value", "മൂല്യം"), accessor: r => <span className="font-medium">{formatCurrency(r.current_value)}</span>, width: "120px" },
    { header: tx("Income so far", "വരവ് ഇതുവരെ"), accessor: r => (
      <div className="flex flex-col">
        <span className="text-emerald-600 font-medium">+{formatCurrency(r.income_total ?? 0)}</span>
        {(r.expense_total ?? 0) > 0 && <span className="text-xs text-rose-600">−{formatCurrency(r.expense_total ?? 0)} {tx("upkeep", "ചെലവ്")}</span>}
      </div>
    ), width: "140px" },
    { header: "", accessor: r => (
      <div className="flex items-center gap-1 justify-end">
        <button className="act-btn" onClick={() => openStatement(r)} title={tx("Income & expense statement", "വരവ്-ചെലവ് വിവരം")}><Eye className="h-4 w-4" /></button>
        <button className="act-btn act-edit" onClick={() => openEdit(r.id)} title={t("action_edit")}><Edit2 className="h-4 w-4" /></button>
        <button className="act-btn act-del" onClick={() => setDeleteId(r.id)} title={t("action_delete")}><Trash2 className="h-4 w-4 text-danger" /></button>
      </div>
    ), align: "right", width: "120px" },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="vhead">
        <div className="modic t-teal"><Landmark size={20} /></div>
        <div>
          <h1>{tx("Asset Register", "ആസ്തി രജിസ്റ്റർ")}</h1>
          <div className="vs">{tx("Buildings, lands and rentable goods of the mahallu — with their income linked to Accounting", "മഹല്ലിന്റെ കെട്ടിടങ്ങൾ, ഭൂമി, വാടാക്കക്ക് നൽകുന്ന സാധനങ്ങൾ — വരുമാനം അക്കൗണ്ടിംഗുമായി ബന്ധിപ്പിച്ചിരിക്കുന്നു")}</div>
        </div>
        <div className="vr">
          <Button variant="secondary" onClick={() => { refetch(); fetchSummary(); }}><RefreshCw className="h-4 w-4" />{tx("Refresh", "പുതുക്കുക")}</Button>
          <Button onClick={openAdd}><Plus className="h-4 w-4" />{tx("Add Asset", "ആസ്തി ചേർക്കുക")}</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-grid stat-grid-3">
        <div className="stat t-em">
          <div className="srow"><span className="sic"><Home size={18} /></span><span className="delta">{tx("Register", "രജിസ്റ്റർ")}</span></div>
          <div className="val">{summary?.count ?? 0}</div>
          <div className="slab">{tx("assets recorded", "ആസ്തികൾ രേഖപ്പെടുത്തിയിട്ടുണ്ട്")} · {summary?.incomeGenerating ?? 0} {tx("generate income", "വരുമാനമുണ്ടാക്കുന്നു")}</div>
        </div>
        <div className="stat t-gold">
          <div className="srow"><span className="sic"><TrendingUp size={18} /></span><span className="delta">{tx("Rent potential", "വാടാക്ക സാധ്യത")}</span></div>
          <div className="val">{formatCurrency(summary?.monthlyRentPotential ?? 0)}</div>
          <div className="slab">{tx("expected per month", "പ്രതീക്ഷിക്കുന്നത് ഓരോ മാസവും")}</div>
        </div>
        <div className="stat t-sky">
          <div className="srow"><span className="sic"><Wallet size={18} /></span><span className="delta">{tx("Current value", "നിലবിഹിത മൂല്യം")}</span></div>
          <div className="val">{formatCurrency(summary?.totalCurrentValue ?? 0)}</div>
          <div className="slab">{tx("all assets together", "എല്ലാ ആസ്തികളും കൂടി")}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="w-44">
          <option value="All">{tx("All categories", "എല്ലാ വിഭാഗങ്ങൾ")}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
        </Select>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-44">
          <option value="All">{tx("All statuses", "എല്ലാ നിലകളും")}</option>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        searchValue={search}
        onSearchChange={setSearch}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={total}
        rowKey={r => r.id}
        emptyTitle={tx("No assets yet", "ആസ്തികളില്ല")}
        emptyDescription={tx("Add the first building, land or rentable good of the mahallu", "മഹല്ലിന്റെ ആദ്യത്തെ കെട്ടിടം, ഭൂമി അല്ലെങ്കിൽ വാടാക്കയ്ക്കുള്ള സാധനം ചേർക്കൂ")}
      />

      {/* Add/Edit Asset dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? t("action_edit") : tx("Add Asset", "ആസ്തി ചേർക്കുക")} className="max-w-2xl">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{tx("Asset name", "ആസ്തിയുടെ പേര്")} *</Label>
              <Input value={form.name || ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={tx("e.g. Main Road Shop", "ഉദാ: മെയിൻ റോഡ് കട")} />
            </div>
            <div>
              <Label>{tx("Category", "വിഭാഗം")}</Label>
              <Select value={form.category || "Building"} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
              </Select>
            </div>
            <div>
              <Label>{tx("Survey / deed / document no.", "സർവേ / തീട്ട് / രേഖ നമ്പർ")}</Label>
              <Input value={form.reference_no || ""} onChange={e => setForm({ ...form, reference_no: e.target.value })} placeholder={tx("optional", "ഓപ്ഷണൽ")} />
            </div>
            <div>
              <Label>{tx("Location", "സ്ഥലം")}</Label>
              <Input value={form.location || ""} onChange={e => setForm({ ...form, location: e.target.value })} />
            </div>
            <div>
              <Label>{tx("Acquired on", "സ്വന്തമാക്കിയ തീയതി")}</Label>
              <Input type="date" value={form.acquisition_date || ""} onChange={e => setForm({ ...form, acquisition_date: e.target.value })} />
            </div>
            <div>
              <Label>{tx("Custodian (responsible person)", "പരിപാലകൻ (ഉത്തരവാദി)")}</Label>
              <Input value={form.custodian || ""} onChange={e => setForm({ ...form, custodian: e.target.value })} />
            </div>
            <div>
              <Label>{tx("Acquisition cost (₹)", "വാങ്ങിയ വില (₹)")}</Label>
              <Input type="number" value={form.acquisition_cost || ""} onChange={e => setForm({ ...form, acquisition_cost: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{tx("Current value (₹)", "നിലവിലെ മൂല്യം (₹)")}</Label>
              <Input type="number" value={form.current_value || ""} onChange={e => setForm({ ...form, current_value: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{tx("Status", "നില")}</Label>
              <Select value={form.status || "In use"} onChange={e => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </Select>
            </div>
            <div>
              <Label>{tx("Condition", "അവസ്ഥ")}</Label>
              <Select value={form.condition_note || "Good"} onChange={e => setForm({ ...form, condition_note: e.target.value })}>
                {CONDITIONS.map(c => <option key={c} value={c}>{condLabel(c)}</option>)}
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface-muted p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!form.income_generating} onChange={e => setForm({ ...form, income_generating: e.target.checked ? 1 : 0 })} data-testid="asset-income-check" />
              {tx("This asset brings income to the mahallu (rent etc.)", "ഈ ആസ്തി മഹല്ലിന് വരുമാനം നൽകുന്നു (വാടാക്ക മുതലായവ)")}
            </label>
            {!!form.income_generating && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{tx("Tenant", "വാടാക്കക്കാരൻ")}</Label>
                  <Input value={form.tenant_name || ""} onChange={e => setForm({ ...form, tenant_name: e.target.value })} />
                </div>
                <div>
                  <Label>{tx("Monthly rent (₹)", "പ്രതിമാസ വാടാക്ക (₹)")}</Label>
                  <Input type="number" value={form.monthly_rent || ""} onChange={e => setForm({ ...form, monthly_rent: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>{tx("Agreement from", "കരാർ തുടക്കം")}</Label>
                  <Input type="date" value={form.agreement_start || ""} onChange={e => setForm({ ...form, agreement_start: e.target.value })} />
                </div>
                <div>
                  <Label>{tx("Agreement until", "കരാർ അവസാനം")}</Label>
                  <Input type="date" value={form.agreement_end || ""} onChange={e => setForm({ ...form, agreement_end: e.target.value })} />
                </div>
                <p className="col-span-2 text-xs text-muted">
                  {tx("Record each rent collection in Accounting (Add Income) and pick this asset there — its income and upkeep then total up here automatically.", "ഓരോ വാടാക്ക വാങ്ങലും അക്കൗണ്ടിംഗിൽ രേഖപ്പെടുത്തുക (വരവ് ചേർക്കുക) — അവിടെ ഈ ആസ്തിയെ വിഭാഗമായി തിരഞ്ഞെടുക്കുക. അതോടെ വരവും ചെലവും ഇവിടെ സ്വയം കൂട്ടിക്കാണിക്കും.")}
                </p>
              </div>
            )}
          </div>

          <div>
            <Label>{t("family_notes")}</Label>
            <Textarea rows={2} value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button>
            <Button onClick={save}>{t("action_save")}</Button>
          </div>
        </div>
      </Dialog>

      {/* Asset statement (income & expense from the ledger) */}
      <Dialog open={statementOpen} onClose={() => setStatementOpen(false)} title={statementAsset ? `${statementAsset.asset_code} · ${statementAsset.name}` : ""} className="max-w-2xl">
        <div className="p-6 space-y-4">
          {!statement && <div className="flex items-center justify-center h-24"><div className="spinner-sm" /></div>}
          {statement && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted">{tx("Income received", "ലഭിച്ച വരവ്")}</div>
                  <div className="text-emerald-600 font-semibold">+{formatCurrency(statement.income)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted">{tx("Expenses (upkeep)", "ചെലവ് (പരിപാലനം)")}</div>
                  <div className="text-rose-600 font-semibold">−{formatCurrency(statement.expense)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted">{tx("Net for the mahallu", "മഹല്ലിനുള്ള ശുദ്ധം")}</div>
                  <div className={`font-semibold ${statement.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(statement.net)}</div>
                </div>
              </div>
              {statementAsset && (statementAsset.tenant_name || statementAsset.monthly_rent) && (
                <div className="text-sm text-muted">
                  {statementAsset.tenant_name ? <>{tx("Tenant", "വാടാക്കക്കാരൻ")}: <b className="text-foreground">{statementAsset.tenant_name}</b> · </> : null}
                  {statementAsset.monthly_rent ? <>{tx("Monthly rent", "പ്രതിമാസ വാടാക്ക")}: <b className="text-foreground">{formatCurrency(statementAsset.monthly_rent)}</b></> : null}
                </div>
              )}
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {statement.entries.length === 0 && (
                  <div className="text-sm text-muted text-center py-6">{tx("No accounting entries tagged to this asset yet — tag rent collections and repair bills in Accounting.", "ഈ ആസ്തിയുമായി ബന്ധിപ്പിച്ച അക്കൗണ്ടിംഗ് എൻട്രികളില്ല — വാടാക്ക വാങ്ങലുകളും അറ്റകുറ്റി ബില്ലുകളും അക്കൗണ്ടിംഗിൽ ഈ ആസ്തിയുമായി ബന്ധിപ്പിക്കൂ.")}</div>
                )}
                {statement.entries.map(en => (
                  <div key={en.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{en.description || en.receipt_number || "—"}</div>
                      <div className="text-xs text-muted">{formatDate(en.txn_date)}{en.category ? ` · ${en.category}` : ""}{en.status === "Void" ? ` · ${tx("VOID", "റദ്ദാക്കി")}` : ""}</div>
                    </div>
                    <div className={`text-sm font-medium whitespace-nowrap ${en.type === "Income" ? "text-emerald-600" : "text-rose-600"}`}>
                      {en.type === "Income" ? "+" : "−"}{formatCurrency(en.amount)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">{tx("Entries come from the Accounting page — add income or expense there and pick this asset.", "എൻട്രികൾ അക്കൗണ്ടിംഗ് പേജിൽ നിന്നാണ് — അവിടെ വരവ് / ചെലവ് ചേർക്കുമ്പോൾ ഈ ആസ്തിയെ തിരഞ്ഞെടുക്കുക.")}</p>
            </>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setStatementOpen(false)}>{tx("Close", "അടയ്ക്കുക")}</Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteId != null}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title={tx("Delete asset", "ആസ്തി നീക്കം ചെയ്യുക")}
        description={tx("Remove this asset from the register? Assets that already have accounting entries cannot be deleted.", "ഈ ആസ്തി രജിസ്റ്ററിൽ നിന്ന് നീക്കം ചെയ്യണോ? അക്കൗണ്ടിംഗ് എൻട്രികളുള്ള ആസ്തികൾ നീക്കം ചെയ്യാനാവില്ല.")}
        confirmLabel={t("action_delete")}
      />
    </div>
  );
}
