import { useEffect, useState } from "react";
import { Plus, Edit2, Eye, Home, Archive, RotateCcw, History, Users, MessageCircle } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList } from "@/hooks/useList";
import { Button, Dialog, Label, Input, Textarea, Select, Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { statusVariant } from "@/lib/utils";

interface Family { id:number; family_number:string; house_name:string; house_number:string; ward:string; area:string; address:string; pincode:string; phone:string; alt_phone:string; status:string; member_count:number; notes:string; whatsapp_phone:string; whatsapp_enabled:number; }
interface HistoryRow { id:number; changed_at:string; action:string; username:string; summary:string; changes_json:string; reason:string; }
const emptyForm: Partial<Family> = { house_name:"",house_number:"",ward:"",area:"",address:"",pincode:"",phone:"",alt_phone:"",status:"Active",notes:"",whatsapp_phone:"",whatsapp_enabled:1 };
const normalizeWhatsApp=(value:string)=>{const d=String(value||"").replace(/\D/g,"");return !d?"":d.length===10?`91${d}`:d;};

const formatChangeValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
};

const formatHistoryChanges = (raw: string): Array<{ field:string; oldValue:string; newValue:string }> => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    return Object.entries(parsed).map(([field, change]: [string, any]) => ({
      field: field.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      oldValue: formatChangeValue(change?.old ?? change?.before ?? change?.from),
      newValue: formatChangeValue(change?.new ?? change?.after ?? change?.to),
    }));
  } catch { return []; }
};

export function Families() {
  const { t, isMalayalam } = useI18n();
  const tx=(en:string,ml:string)=>isMalayalam()?ml:en;
  const [search,setSearch]=useState(""); const [statusFilter,setStatusFilter]=useState("All");
  const [dialogOpen,setDialogOpen]=useState(false); const [editingId,setEditingId]=useState<number|null>(null); const [form,setForm]=useState<Partial<Family>>(emptyForm);
  const [previewOpen,setPreviewOpen]=useState(false); const [previewRow,setPreviewRow]=useState<Family|null>(null); const [history,setHistory]=useState<HistoryRow[]>([]); const [members,setMembers]=useState<any[]>([]);
  const [securityOpen,setSecurityOpen]=useState(false); const [pendingAction,setPendingAction]=useState<"archive"|"restore"|null>(null); const [reason,setReason]=useState("");
  const {rows,total,totalPages,loading,refetch,setFilters,page,setPage}=useList((filter)=>window.mms.families.list(filter),{pageSize:20,initialFilters:{status:"All"}});
  useEffect(()=>{ setFilters({status:statusFilter}); },[statusFilter,setFilters]);

  const save=async()=>{ if(!form.house_name||!form.phone){toast.error(t("ui_house_phone_required"));return;} try{const p={houseName:form.house_name,houseNumber:form.house_number||"",ward:form.ward||"",area:form.area||"",address:form.address||"",pincode:form.pincode||"",phone:form.phone,altPhone:form.alt_phone||"",status:"Active",notes:form.notes||"",whatsappPhone:normalizeWhatsApp(form.whatsapp_phone||""),whatsappEnabled:form.whatsapp_enabled!==0?1:0}; if(editingId) await window.mms.families.update(editingId,p); else await window.mms.families.create(p); toast.success(t("ui_save_changes"));setDialogOpen(false);setEditingId(null);setForm(emptyForm);refetch();}catch(e:any){toast.error(e.message||t("ui_failed_save"));} };
  const edit=async(id:number)=>{const f=await window.mms.families.get(id);setForm(f||emptyForm);setEditingId(id);setDialogOpen(true);};
  const openPreview=async(r:Family)=>{setPreviewRow(r);setPreviewOpen(true);setMembers([]);setHistory([]);
    // Fetch members and history separately so a failure in one doesn't
    // wipe the other (previously Promise.all + catch would zero both).
    try{const mem=await window.mms.members.list({familyId:r.id,pageSize:1000});setMembers(mem.rows||[]);}catch(e:any){console.warn("[families] members load failed:",e);setMembers([]);}
    try{const hist=await window.mms.families.history(r.id);setHistory(hist||[]);}catch(e:any){console.warn("[families] history load failed:",e);setHistory([]);}
  };
  const openSecurity=(action:"archive"|"restore")=>{setPendingAction(action);setReason("");setSecurityOpen(true);};
  const executeSecurity=async()=>{if(!previewRow||!pendingAction)return;if(pendingAction==="archive"&&!reason.trim()){toast.error(tx("A reason is required","കാരണം നൽകണം"));return;}try{if(pendingAction==="archive") await window.mms.families.archive(previewRow.id,reason); else await window.mms.families.restore(previewRow.id,reason);toast.success(pendingAction==="archive"?tx("Family archived","കുടുംബം ആർക്കൈവ് ചെയ്തു"):tx("Family restored","കുടുംബം പുനഃസ്ഥാപിച്ചു"));setSecurityOpen(false);setPreviewOpen(false);setPendingAction(null);refetch();}catch(e:any){toast.error(e.message);} };
  const columns:Column<Family>[]=[
    {header:t("family_number"),accessor:r=><span className="code-text text-primary">{r.family_number}</span>},
    {header:t("family_house_name"),accessor:r=><span className="font-medium">{r.house_name}</span>},
    {header:t("family_ward"),accessor:r=>r.ward||"—"},{header:t("family_area"),accessor:r=>r.area||"—"},{header:t("family_phone"),accessor:r=>r.phone},
    {header:tx("WhatsApp","വാട്ട്സ്ആപ്പ്"),accessor:r=>r.whatsapp_phone?<span className="inline-flex items-center gap-1"><MessageCircle size={13} className="text-primary"/><span className="code-text-sm">{r.whatsapp_phone}</span></span>:<span className="text-muted">—</span>},
    {header:t("family_members_count"),accessor:r=><Badge variant="muted">{r.member_count}</Badge>,align:"center"},
    {header:t("family_status"),accessor:r=><Badge variant={statusVariant(r.status)}>{r.status}</Badge>},
    {header:"",accessor:r=><div className="rowact"><button className="act-btn act-edit" onClick={()=>edit(r.id)} title={t("action_edit")}><Edit2 className="h-4 w-4"/></button><button className="act-btn" onClick={()=>openPreview(r)} title={tx("Archive / view","ആർക്കൈവ് / കാണുക")}><Eye className="h-4 w-4"/></button></div>,align:"right"}
  ];
  return <div className="view view-enter">
    <div className="vhead"><div className="modic t-em"><Home size={20}/></div><div><h1>{t("family_title")}</h1><div className="vs">{t("family_subtitle")}</div></div><div className="vr"><Button onClick={()=>{setForm(emptyForm);setEditingId(null);setDialogOpen(true)}}><Plus className="h-4 w-4"/>{t("add_family")}</Button></div></div>
    <DataTable columns={columns} rows={rows as Family[]} loading={loading} total={total} page={page} pageSize={20} totalPages={totalPages} onPageChange={setPage} searchValue={search} onSearchChange={setSearch} rowKey={r=>r.id} onRowDoubleClick={openPreview} toolbar={<Select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="w-40"><option value="All">{tx("All","എല്ലാം")}</option><option value="Active">{tx("Active","സജീവം")}</option><option value="Inactive">{tx("Inactive","നിഷ്‌ക്രിയം")}</option><option value="Archived">{tx("Archived","ആർക്കൈവ് ചെയ്തത്")}</option></Select>}/>

    <Dialog open={previewOpen} onClose={()=>setPreviewOpen(false)} title={t("family_title")}>
      <div className="dlg-pad">{previewRow&&<><div className="dlg-hero t-em"><div className="dlg-hero-ic"><Eye size={20}/></div><div className="dlg-hero-body"><div className="dlg-hero-title">{previewRow.house_name}</div><div className="dlg-hero-sub">{previewRow.family_number} · {previewRow.ward||previewRow.area||"—"}</div></div><Badge variant={statusVariant(previewRow.status)}>{previewRow.status}</Badge></div>
      <div className="dlg-sec"><b>{tx("Household", "കുടുംബം")}</b></div>
      <div className="det-grid">{[[t("family_number"),previewRow.family_number],[t("family_house_name"),previewRow.house_name],[t("family_house_number"),previewRow.house_number||"—"],[t("family_ward"),previewRow.ward||"—"],[t("family_area"),previewRow.area||"—"],[t("family_members_count"),String(previewRow.member_count||0)]].map(([k,v],i)=><div className="det" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>)}</div>
      <div className="dlg-sec"><b>{tx("Contact & Location", "ബന്ധപ്പെടാനുള്ള വിവരങ്ങളും വിലാസവും")}</b></div>
      <div className="det-grid">{[[t("family_phone"),previewRow.phone],[t("family_alt_phone"),previewRow.alt_phone||"—"],[tx("WhatsApp number","വാട്ട്സ്ആപ്പ് നമ്പർ"),previewRow.whatsapp_phone||tx("Not added","ചേർത്തിട്ടില്ല")],[tx("WhatsApp messaging","വാട്ട്സ്ആപ്പ് സന്ദേശങ്ങൾ"),previewRow.whatsapp_enabled?tx("Allowed","അനുവദിച്ചു"):tx("Disabled","നിരോധിച്ചു")],[t("family_pincode"),previewRow.pincode||"—"],[t("family_address"),previewRow.address||"—"],[t("family_notes"),previewRow.notes||"—"]].map(([k,v],i)=><div key={i} className={`det${i>=5?" full":""}`}><span className="k">{k}</span><span className="v">{v}</span></div>)}</div>
      <div className="mt-5"><div className="flex items-center gap-2 mb-3"><Users size={16}/><strong>{t("family_members_list")}</strong><Badge variant="muted">{members.length}</Badge></div><div className="space-y-2 max-h-56 overflow-auto">{members.length?members.map((m,i)=><div key={m.id||i} className="p-3 rounded-lg border border-border flex items-center gap-3"><span className="w-8 h-8 rounded-full bg-surface-hover grid place-items-center text-xs font-semibold text-muted">{(m.name||"?").charAt(0).toUpperCase()}</span><div className="flex-1 min-w-0"><div className="font-medium truncate">{m.name||"—"}</div><div className="text-xs text-muted">{m.member_code}{m.relationship?` · ${m.relationship}`:""}{m.mobile?` · ${m.mobile}`:""}</div></div>{m.is_head===1&&<Badge variant="success">{tx("Head","തലവൻ")}</Badge>}</div>):<div className="text-sm text-muted">{t("family_no_members")}</div>}</div></div>
      <div className="mt-5"><div className="flex items-center gap-2 mb-3"><History size={16}/><strong>{tx("Activity & History","പ്രവർത്തനങ്ങളും ചരിത്രവും")}</strong></div><div className="space-y-2 max-h-56 overflow-auto">{history.length?history.map(h=>{const changes=formatHistoryChanges(h.changes_json);return <div key={h.id} className="p-3 rounded-lg border border-border"><div className="flex justify-between gap-3"><b>{h.summary}</b><span className="text-xs text-muted">{h.changed_at}</span></div><div className="text-xs text-muted mt-1">{h.username} · {h.action}{h.reason?` · ${h.reason}`:""}</div>{changes.length>0&&<div className="mt-2 space-y-1">{changes.map((c,i)=><div key={i} className="grid grid-cols-[minmax(90px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs"><span className="font-medium capitalize">{c.field}</span><span className="rounded bg-muted/30 px-2 py-1 break-words">{c.oldValue}</span><span className="rounded bg-muted/30 px-2 py-1 break-words">{c.newValue}</span></div>)}</div>}{h.reason&&!changes.length&&<div className="text-sm mt-2">{h.reason}</div>}</div>}) : <div className="text-sm text-muted">{tx("No history recorded","ചരിത്ര രേഖകളില്ല")}</div>}</div></div></>}
      <div className="dlg-actions"><Button variant="secondary" onClick={()=>setPreviewOpen(false)}>{t("ui_close")}</Button>{previewRow?.status==="Archived"?<Button onClick={()=>openSecurity("restore")}><RotateCcw size={14}/>{tx("Restore","പുനഃസ്ഥാപിക്കുക")}</Button>:<><Button onClick={()=>edit(previewRow!.id)}><Edit2 size={14}/>{t("action_edit")}</Button><Button variant="secondary" onClick={()=>openSecurity("archive")}><Archive size={14}/>{tx("Archive","ആർക്കൈവ്")}</Button></>}</div>
      </div>
    </Dialog>

    <Dialog open={securityOpen} onClose={()=>setSecurityOpen(false)} title={pendingAction==="archive"?tx("Archive family","കുടുംബം ആർക്കൈവ് ചെയ്യുക"):tx("Restore family","കുടുംബം പുനഃസ്ഥാപിക്കുക")} className="modal-sm">
      <div className="p-6 space-y-4"><p>{pendingAction==="archive"?tx("All active members of this family will also be archived. Their records and history will be preserved.","ഈ കുടുംബത്തിലെ എല്ലാ സജീവ അംഗങ്ങളും ആർക്കൈവ് ചെയ്യപ്പെടും. അവരുടെ രേഖകളും ചരിത്രവും സംരക്ഷിക്കപ്പെടും."):tx("Only members archived because of this family archive will be restored.","ഈ കുടുംബം ആർക്കൈവ് ചെയ്തതിനെ തുടർന്ന് ആർക്കൈവ് ചെയ്ത അംഗങ്ങളെ മാത്രം പുനഃസ്ഥാപിക്കും.")}</p><div><Label>{tx("Reason","കാരണം")}{pendingAction==="archive"?" *":""}</Label><Textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder={tx("Why is this action being performed?","ഈ പ്രവർത്തനം നടത്തുന്നതിനുള്ള കാരണം?")}/></div><div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setSecurityOpen(false)}>{t("action_cancel")}</Button><Button onClick={executeSecurity}>{pendingAction==="archive"?tx("Archive family","കുടുംബം ആർക്കൈവ് ചെയ്യുക"):tx("Restore family","കുടുംബം പുനഃസ്ഥാപിക്കുക")}</Button></div></div>
    </Dialog>

    <Dialog open={dialogOpen} onClose={()=>setDialogOpen(false)} title={editingId?t("action_edit"):t("add_family")} className="max-w-2xl"><div className="p-6 space-y-4"><div className="grid grid-cols-2 gap-4"><div><Label>{t("family_house_name")} *</Label><Input value={form.house_name||""} onChange={e=>setForm({...form,house_name:e.target.value})}/></div><div><Label>{t("family_house_number")}</Label><Input value={form.house_number||""} onChange={e=>setForm({...form,house_number:e.target.value})}/></div><div><Label>{t("family_ward")}</Label><Input value={form.ward||""} onChange={e=>setForm({...form,ward:e.target.value})}/></div><div><Label>{t("family_area")}</Label><Input value={form.area||""} onChange={e=>setForm({...form,area:e.target.value})}/></div><div><Label>{t("family_phone")} * (10 {tx("digits","അക്കങ്ങൾ")})</Label><Input value={form.phone||""} onChange={e=>{const d=e.target.value.replace(/\D/g,'').slice(0,10);setForm({...form,phone:d});}} maxLength={10} inputMode="numeric" placeholder="98XXXXXXXX"/></div><div><Label>{t("family_alt_phone")} (10 {tx("digits","അക്കങ്ങൾ")})</Label><Input value={form.alt_phone||""} onChange={e=>{const d=e.target.value.replace(/\D/g,'').slice(0,10);setForm({...form,alt_phone:d});}} maxLength={10} inputMode="numeric"/></div><div><Label>{t("family_pincode")}</Label><Input value={form.pincode||""} onChange={e=>setForm({...form,pincode:e.target.value})}/></div></div><div className="rounded-lg border border-border bg-surface-muted p-4 space-y-3"><div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-primary"/><strong>{tx("WhatsApp","വാട്ട്സ്ആപ്പ്")}</strong></div><div><Label>{tx("Family head WhatsApp number","കുടുംബനാഥന്റെ വാട്ട്സ്ആപ്പ് നമ്പർ")}</Label><Input value={form.whatsapp_phone||""} onChange={e=>{const d=e.target.value.replace(/\D/g,'').slice(0,15);setForm({...form,whatsapp_phone:d});}} maxLength={15} inputMode="numeric" placeholder="9198XXXXXXXX"/><div className="text-xs text-muted mt-1">{tx("Bulk messages are sent only to the family head.","ബൾക്ക് സന്ദേശങ്ങൾ കുടുംബനാഥന് മാത്രം അയയ്ക്കും.")}</div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.whatsapp_enabled!==0} onChange={e=>setForm({...form,whatsapp_enabled:e.target.checked?1:0})}/>{tx("Allow Mahallu WhatsApp messages","മഹല്ല് വാട്ട്സ്ആപ്പ് സന്ദേശങ്ങൾ അനുവദിക്കുക")}</label></div><div><Label>{t("family_address")}</Label><Textarea rows={2} value={form.address||""} onChange={e=>setForm({...form,address:e.target.value})}/></div><div><Label>{t("family_notes")}</Label><Textarea rows={2} value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})}/></div><div className="flex justify-end gap-2"><Button variant="secondary" onClick={()=>setDialogOpen(false)}>{t("action_cancel")}</Button><Button onClick={save}>{t("action_save")}</Button></div></div></Dialog>
  </div>;
}