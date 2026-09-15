import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, Eye, Gift, UserRoundCheck, MessageCircle, FileDown, Lock, CheckCheck } from "lucide-react";
import { useI18n } from "@/i18n";
import { useList } from "@/hooks/useList";
import { Button, Dialog, Input, Label, Select, Textarea, Badge } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { formatCurrency, formatDate, todayIST } from "@/lib/utils";

// Receipt WhatsApp send-lock fields (V037): delivered ⇒ locked (one
// admin-authorized re-send ever); sent-but-not-delivered stays open.
interface Donation { id:number; receipt_number:string; donor_name:string; donor_phone:string; donor_address:string; family_id:number; member_id:number; category_id:number; category_name:string; amount:number; donation_date:string; purpose:string; payment_method:string; transaction_ref:string; received_by:number; remarks:string; receipt_sent_at?:string|null; receipt_delivered_at?:string|null; receipt_resends?:number; }
const emptyForm:Partial<Donation>={receipt_number:"",donor_name:"",donor_phone:"",donor_address:"",family_id:0,member_id:0,category_id:0,category_name:"",amount:0,donation_date:"",purpose:"",payment_method:"Cash",transaction_ref:"",remarks:""};
const codeFontStyle="code-text-sm";
// WhatsApp numbers are stored in international form (91 + 10 digits) so the
// messaging layer can hand them straight to the WhatsApp engine.
const normalizeWhatsApp=(value:string)=>{const d=String(value||"").replace(/\D/g,"");return !d?"":d.length===10?`91${d}`:d;};

export function Donations(){
  const {t,lang}=useI18n(); const tx=(en:string,ml:string)=>lang==="ml"?ml:en;
  const [search,setSearch]=useState(""); const [categoryFilter,setCategoryFilter]=useState("All");
  const [dialogOpen,setDialogOpen]=useState(false); const [editingId,setEditingId]=useState<number|null>(null); const [form,setForm]=useState<Partial<Donation>>(emptyForm);
  // Editing an issued donation (a financial receipt) is gated: reason +
  // administrator password, re-verified in the main process on save.
  const [editGateOpen,setEditGateOpen]=useState(false); const [pendingEditId,setPendingEditId]=useState<number|null>(null); const [editAuth,setEditAuth]=useState<{password:string;reason:string}|null>(null);
  const [families,setFamilies]=useState<any[]>([]); const [familyMembers,setFamilyMembers]=useState<any[]>([]); const [categories,setCategories]=useState<any[]>([]);
  const [isMahalluMember,setIsMahalluMember]=useState(false); const [otherCategory,setOtherCategory]=useState(""); const [memberBalance,setMemberBalance]=useState(0);
  // Opt-in (not default-on): until WhatsApp is paired, a default-on
  // auto-send would surface a send error on every single donation save.
  const [sendReceiptEnabled,setSendReceiptEnabled]=useState(false);
  const [previewOpen,setPreviewOpen]=useState(false); const [previewRow,setPreviewRow]=useState<Donation|null>(null); const [confirmOpen,setConfirmOpen]=useState(false); const [pendingDeleteId,setPendingDeleteId]=useState<number|null>(null);
  // WhatsApp receipt privacy lock: admin re-send gate for a DELIVERED receipt.
  const [resendOpen,setResendOpen]=useState(false); const [resendRow,setResendRow]=useState<Donation|null>(null); const [sendingId,setSendingId]=useState<number|null>(null);
  const {rows,total,totalPages,loading,refetch,setFilters,page,setPage}=useList((filter)=>window.mms.donations.list(filter),{pageSize:20});
  useEffect(()=>{setFilters(categoryFilter==="All"?{}:{category:categoryFilter});setPage(1);},[categoryFilter,setFilters]);

  const loadFamilies=()=>window.mms.families.list({pageSize:1000}).then(r=>setFamilies(r.rows||[])).catch(()=>{});
  const loadCategories=()=>window.mms.donations.categories().then(r=>setCategories(r||[])).catch(()=>{});
  useEffect(()=>{loadFamilies();loadCategories();},[]);
  const loadMembers=async(fid:number)=>{if(!fid){setFamilyMembers([]);return;}try{const r=await window.mms.members.list({familyId:fid,pageSize:1000});setFamilyMembers(r.rows||[]);}catch{setFamilyMembers([]);}};
  const refreshBalance=async(fid:number,mid:number)=>{if(!fid){setMemberBalance(0);return;}try{const b=await window.mms.donations.memberBalance(fid,mid||undefined);setMemberBalance(Number(b||0));if(b>0)setForm(f=>({...f,amount:Number(b)}));}catch{setMemberBalance(0);}};
  const openNew=()=>{setForm({...emptyForm,donation_date:todayIST()});setEditingId(null);setIsMahalluMember(false);setOtherCategory("");setMemberBalance(0);setSendReceiptEnabled(true);setFamilyMembers([]);setDialogOpen(true);};
  const openEdit=(id:number)=>{setPendingEditId(id);setEditGateOpen(true);};
  const performEdit=async({password,reason}:{password:string;reason:string})=>{try{const d=await window.mms.donations.get(pendingEditId!);if(!d)return;const member=!!d.member_id;setForm(d);setEditingId(pendingEditId!);setSendReceiptEnabled(false);setIsMahalluMember(member);setOtherCategory("");setEditAuth({password,reason});if(d.family_id)await loadMembers(d.family_id);if(member)await refreshBalance(d.family_id,d.member_id);setDialogOpen(true);}catch(err:any){toast.error(err.message);}};
  const handleFamilyChange=async(fid:number)=>{setForm(f=>({...f,family_id:fid,member_id:0,donor_name:""}));setMemberBalance(0);await loadMembers(fid);await refreshBalance(fid,0);};
  // Selecting a mahallu member prefills the balance donor data too — phone and
  // address (member address first, family address as fallback).
  const handleMemberChange=async(mid:number)=>{
    const m=familyMembers.find(x=>x.id===mid);
    setForm(f=>({...f,member_id:mid,donor_name:m?.name||f.donor_name}));
    if(mid){
      try{
        const full=await window.mms.members.get(mid);
        if(full){
          let addr=full.address||"";
          let phone=full.mobile||"";
          if(full.family_id){
            try{
              const fam=await window.mms.families.get(full.family_id);
              if(fam){
                if(!addr)addr=[fam.address,fam.area,fam.ward].filter(Boolean).join(", ")+(fam.pincode?` - ${fam.pincode}`:"");
                if(!phone)phone=fam.phone||"";
              }
            }catch{}
          }
          setForm(f=>({...f,donor_phone:phone||f.donor_phone,donor_address:addr||f.donor_address}));
        }
      }catch{}
    }
    await refreshBalance(form.family_id||0,mid);
  };
  const handleSave=async()=>{let categoryId=Number(form.category_id||0);if(categoryId===-1){if(!otherCategory.trim())return toast.error("Enter the donation category");try{const created=await window.mms.donations.createCategory(otherCategory.trim());categoryId=created.id;await loadCategories();}catch(err:any){toast.error(err.message);return;}}if(!form.donor_name?.trim()||!form.amount||!categoryId){toast.error(t("ui_donor_cat_amount_required"));return;}if(isMahalluMember&&!form.family_id){toast.error("Select the member's family");return;}try{const payload:any={donorName:form.donor_name,donorPhone:normalizeWhatsApp(form.donor_phone||""),donorAddress:form.donor_address||"",familyId:isMahalluMember?form.family_id:null,memberId:isMahalluMember?(form.member_id||null):null,categoryId,amount:form.amount,donationDate:form.donation_date||"",receiptNumber:form.receipt_number||"",purpose:form.purpose||"",paymentMethod:form.payment_method||"Cash",transactionRef:form.transaction_ref||"",receivedBy:1,remarks:form.remarks||""};if(editingId){await window.mms.donations.update(editingId,payload,editAuth?.password||"",editAuth?.reason||"");toast.success(t("ui_save_changes"));}else{const created:any=await window.mms.donations.create(payload);const donationId=Number(created?.id??created?.lastInsertRowid??created);toast.success(t("add_donation"));if(sendReceiptEnabled&&donationId){try{const sent:any=await window.mms.whatsapp.sendDonationReceipt(donationId);toast.success(sent?.delivered?tx("Donation saved — receipt delivered on WhatsApp (now locked)","സംഭാവന സേവ് ചെയ്തു — രസീറ്റ് വാട്ട്സ്ആപ്പിൽ എത്തി (ഇനി ലോക്ക്)"):tx("Donation saved — receipt sent on WhatsApp (delivery not confirmed yet)","സംഭാവന സേവ് ചെയ്തു — രസീറ്റ് വാട്ട്സ്ആപ്പിൽ അയച്ചു (ഡെലിവറി ഉറപ്പായിട്ടില്ല)"));}catch(err:any){toast.error(err.message||tx("Donation saved, but WhatsApp receipt was not sent","സംഭാവന സേവ് ചെയ്തു, പക്ഷേ വാട്ട്സ്ആപ്പ് രസീത് അയച്ചില്ല"));}}}setDialogOpen(false);setForm(emptyForm);setEditingId(null);refetch();}catch(err:any){toast.error(err.message||t("ui_failed_save"));}};
  const sendDonationReceipt=async(id:number,row?:Donation,adminPassword?:string)=>{
    if(row&&!row.donor_phone){toast.error(tx("No WhatsApp number saved for this donor. Add the donor's phone number in the donation record first.","ഈ ദാതാവിന്റെ വാട്ട്സ്ആപ്പ് നമ്പർ സേവ് ചെയ്തിട്ടില്ല. ആദ്യം ദാതാവിന്റെ ഫോൺ നമ്പർ ചേർക്കുക."));return;}
    setSendingId(id);
    try{
      const r:any=await window.mms.whatsapp.sendDonationReceipt(id,adminPassword);
      // The lock flips ONLY on confirmed delivery; otherwise say exactly what happened.
      if(r?.delivered){toast.success(tx("Receipt delivered to the recipient — it is now locked (one admin re-send remains available)","രസീറ്റ് സ്വീകർത്താവിന് ലഭിച്ചു — ഇനി ലോക്ക് ചെയ്തിരിക്കുന്നു (ഒരു അഡ്മിൻ റീ-സെൻഡ് ലഭ്യമാണ്)"));}
      else{toast.warning(tx("Receipt sent — delivery not confirmed yet (the phone may be offline). Not locked; you can send again after confirming it did not arrive.","രസീറ്റ് അയച്ചു — ഡെലിവറി ഉറപ്പാക്കിയിട്ടില്ല (ഫോൺ ഓഫലൈൻ ആകാം). ലോക്ക് ചെയ്തിട്ടില്ല; വന്നെത്തിയില്ലെന്ന് ഉറപ്പായാൽ വീണ്ടും അയക്കാം."));}
      refetch();
    }catch(e:any){toast.error(e.message||tx("Could not send the receipt on WhatsApp","വാട്ട്സ്ആപ്പിൽ രസീത് അയയ്ക്കാനായില്ല"));refetch();}finally{setSendingId(null);}
  };
  // A delivered receipt is LOCKED (privacy): one admin-password re-send is
  // ever allowed, and the main process re-verifies the password itself.
  const openAdminResend=(row:Donation)=>{
    if(Number(row.receipt_resends||0)>=1){toast.info(tx("Already sent to the recipient — the one admin re-send was already used.","സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ഉപയോഗിച്ചു കഴിഞ്ഞു."));return;}
    setResendRow(row);setResendOpen(true);
  };
  const executeAdminResend=async({password}:{reason:string;password:string})=>{
    if(!resendRow)return;
    await sendDonationReceipt(resendRow.id,undefined,password);
    setResendRow(null);
  };
  // A6 receipt PDFs — generated in the app (and kept in the database) even
  // when messaging is not set up. Receipts are always PDF files; the admin
  // prints the saved file from any viewer.
  const saveReceipt=async(id:number)=>{try{const r:any=await window.mms.receipts.saveDonationPdf(id);if(r?.success)toast.success(tx("Receipt PDF saved","രസീറ്റ് PDF സേവ് ചെയ്തു"));}catch(e:any){toast.error(e.message||tx("Could not save the receipt PDF","രസീറ്റ് PDF സേവ് ചെയ്യാനായില്ല"));}};
  const saveReceiptsPdf=async()=>{
    try{
      const list:any=await window.mms.donations.list({search:search||undefined,category:categoryFilter!=="All"?categoryFilter:undefined,page:1,pageSize:500});
      const ids=(list?.rows||[]).map((r:any)=>r.id);
      if(!ids.length){toast.error(tx("No donation receipts to save","സേവ് ചെയ്യാൻ രസീറ്റുകളില്ല"));return;}
      const r:any=await window.mms.receipts.saveDonationBatchPdf(ids);
      if(r?.cancelled){/* closed the save dialog */}
      else if(r?.success)toast.success(tx(`Saved ${r.count} receipts as one PDF (4 per A4 sheet)`,`${r.count} രസീറ്റുകൾ ഒരു PDF ആയി സേവ് ചെയ്തു (ഒരു A4 ഷീറ്റിൽ 4 എണ്ണം)`));
      else toast.error(r?.reason||tx("Could not save the receipts PDF","രസീറ്റുകൾ PDF ആയി സേവ് ചെയ്യാനായില്ല"));
    }catch(e:any){toast.error(e.message||tx("Could not save the receipts PDF","രസീറ്റുകൾ PDF ആയി സേവ് ചെയ്യാനായില്ല"));}
  };
  const handleDeleteClick=(id:number)=>{setPendingDeleteId(id);setConfirmOpen(true);};
  const handleDeleteConfirm=async()=>{if(pendingDeleteId==null)return;try{await window.mms.donations.remove(pendingDeleteId);toast.success(t("ui_record_deleted"));refetch();}catch(err:any){toast.error(err.message);}finally{setConfirmOpen(false);setPendingDeleteId(null);}};
  const handleRowDoubleClick=(row:Donation)=>{setPreviewRow(row);setPreviewOpen(true);};
  const switchToEdit=async()=>{if(!previewRow)return;const id=previewRow.id;setPreviewOpen(false);setPreviewRow(null);await openEdit(id);};
  const columns:Column<Donation>[]=[{header:t("sub_receipt"),accessor:r=><span className={codeFontStyle+" text-primary"}>{r.receipt_number||"—"}</span>},{header:t("don_donor_name"),accessor:r=><span className="font-medium">{r.donor_name}</span>},{header:t("don_category"),accessor:r=><Badge variant="muted">{r.category_name}</Badge>},{header:t("sub_amount"),accessor:r=>formatCurrency(r.amount)},{header:t("don_date"),accessor:r=>formatDate(r.donation_date)},{header:t("don_purpose"),accessor:r=>r.purpose||"—"},{header:"",accessor:r=><div className="flex items-center gap-1 justify-end"><button className="act-btn" onClick={()=>saveReceipt(r.id)} title={tx("Save A6 receipt PDF","A6 രസീറ്റ് PDF സേവ് ചെയ്യുക")}><FileDown className="h-4 w-4 text-primary"/></button>{r.receipt_delivered_at?(<button className={`act-btn${Number(r.receipt_resends||0)>=1?" opacity-60":""}`} onClick={()=>openAdminResend(r)} title={Number(r.receipt_resends||0)>=1?tx("Already sent to recipient — the one admin re-send was used","സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ഉപയോഗിച്ചു കഴിഞ്ഞു"):tx("Already sent to recipient — one admin re-send available","സ്വീകർത്താവിന് ഇതിനകം അയച്ചു — ഒരു അഡ്മിൻ റീ-സെൻഡ് ലഭ്യമാണ്")}><Lock className="h-4 w-4 text-emerald-500"/></button>):(<button className="act-btn" onClick={()=>sendDonationReceipt(r.id,r)} disabled={sendingId===r.id} title={r.receipt_sent_at?tx("Sent earlier but delivery was never confirmed — sending again is allowed","ഇതിനകം അയച്ചെങ്കിലും ഡെലിവറി ഉറപ്പായില്ല — വീണ്ടും അയക്കാം"):r.donor_phone?tx("Send receipt on WhatsApp","വാട്ട്സ്ആപ്പിൽ രസീത് അയയ്ക്കുക"):tx("No WhatsApp number for this donor","ഈ ദാതാവിന് വാട്ട്സ്ആപ്പ് നമ്പർ ഇല്ല")}><MessageCircle className="h-4 w-4 text-primary"/></button>)}<button className="act-btn act-edit" onClick={()=>openEdit(r.id)} title={t("action_edit")}><Edit2 className="h-4 w-4"/></button><button className="act-btn act-del" onClick={()=>handleDeleteClick(r.id)} title={tx("Delete", "ഇല്ലാതാക്കുക")}><Trash2 className="h-4 w-4 text-danger"/></button></div>,align:"right"}];
  const previewDetails=previewRow?[{k:t("sub_receipt"),v:previewRow.receipt_number},{k:t("don_donor_name"),v:previewRow.donor_name},{k:t("don_donor_phone"),v:previewRow.donor_phone||tx("Not added","ചേർത്തിട്ടില്ല")},{k:tx("Mahallu Member","മഹല്ല് അംഗം"),v:previewRow.member_id?tx("Yes","അതെ"):tx("No","ഇല്ല")},{k:t("don_category"),v:previewRow.category_name||"—"},{k:t("sub_amount"),v:formatCurrency(previewRow.amount)},{k:t("don_date"),v:formatDate(previewRow.donation_date)},{k:t("don_purpose"),v:previewRow.purpose||"—"},{k:t("sub_method"),v:previewRow.payment_method||"—"},{k:t("ui_transaction_ref"),v:previewRow.transaction_ref||"—"},{k:t("ui_donor_address"),v:previewRow.donor_address||"—",full:true},{k:t("ui_remarks"),v:previewRow.remarks||"—",full:true}]:[];
  return <div className="view view-enter"><div className="vhead"><div className="modic t-em"><Gift size={20}/></div><div><h1>{t("don_title")}</h1><div className="vs">{t("don_subtitle")}</div></div><div className="vr"><Button variant="secondary" onClick={saveReceiptsPdf} title={tx("Save A6 receipts as one PDF — 4 per A4 sheet (uses the current filter)","A6 രസീറ്റുകൾ ഒരു PDF ആയി സേവ് ചെയ്യുക — ഒരു A4 ഷീറ്റിൽ 4 എണ്ണം (ഇപ്പോഴത്തെ ഫിൽട്ടർ അനുസരിച്ച്)")}><FileDown className="h-4 w-4"/>{tx("Save receipts","രസീറ്റുകൾ സേവ് ചെയ്യുക")}</Button><Button onClick={openNew}><Plus className="h-4 w-4"/>{t("add_donation")}</Button></div></div>
    <DataTable columns={columns} rows={rows as Donation[]} loading={loading} total={total} page={page} pageSize={20} totalPages={totalPages} onPageChange={setPage} searchValue={search} onSearchChange={setSearch} rowKey={r=>r.id} onRowDoubleClick={handleRowDoubleClick} toolbar={<Select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)} className="w-48"><option value="All">{t("ui_all_categories")}</option>{categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</Select>}/>
    <Dialog open={previewOpen} onClose={()=>{setPreviewOpen(false);setPreviewRow(null);}} title={t("don_title")}><div className="dlg-pad">{previewRow&&<><div className="dlg-hero t-em"><div className="dlg-hero-ic"><Eye size={20}/></div><div className="dlg-hero-body"><div className="dlg-hero-title">{previewRow.donor_name}</div><div className="dlg-hero-sub">{previewRow.receipt_number} · {formatCurrency(previewRow.amount)}</div></div><Badge variant="muted">{previewRow.category_name}</Badge></div><div className="dlg-sec"><b>{tx("Donation", "സംഭാവന")}</b></div><div className="det-grid">{previewDetails.slice(0,7).map((d,i)=><div key={i} className={`det${d.full?" full":""}`}><span className="k">{d.k}</span><span className="v">{d.v}</span></div>)}</div><div className="dlg-sec"><b>{tx("Payment & notes", "പേയ്മെന്റും കുറിപ്പുകളും")}</b></div><div className="det-grid">{previewDetails.slice(7).map((d,i)=><div key={i} className={`det${d.full?" full":""}`}><span className="k">{d.k}</span><span className="v">{d.v}</span></div>)}</div></>}<div className="dlg-actions"><Button variant="secondary" onClick={()=>{setPreviewOpen(false);setPreviewRow(null);}}>{t("ui_close")}</Button>{previewRow&&<Button variant="secondary" onClick={()=>saveReceipt(previewRow.id)}><FileDown size={14}/>{tx("Save A6 PDF","A6 PDF സേവ്")}</Button>}{previewRow?.donor_phone&&(previewRow.receipt_delivered_at?<Button variant="secondary" onClick={()=>openAdminResend(previewRow)}><Lock size={14}/>{tx("Already sent to recipient","സ്വീകർത്താവിന് ഇതിനകം അയച്ചു")}</Button>:<Button variant="secondary" onClick={()=>sendDonationReceipt(previewRow.id,previewRow)} disabled={sendingId===previewRow.id}><MessageCircle size={14}/>{tx("WhatsApp Receipt","വാട്ട്സ്ആപ്പ് രസീത്")}</Button>)}<Button onClick={switchToEdit}><Edit2 size={14}/>{t("action_edit")}</Button></div></div></Dialog>
    <Dialog open={dialogOpen} onClose={()=>setDialogOpen(false)} title={editingId?t("action_edit"):t("add_donation")} className="max-w-2xl"><div className="p-6 space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border p-3"><div className="flex items-center gap-2"><UserRoundCheck className="h-4 w-4 text-primary"/><div><div className="text-sm font-medium">{tx("Mahallu Member","മഹല്ല് അംഗം")}</div><div className="text-xs text-text-tertiary">{tx("Link this donation to a family and member","ഈ സംഭാവനയെ കുടുംബവുമായും അംഗവുമായും ബന്ധിപ്പിക്കുക")}</div></div></div><input type="checkbox" checked={isMahalluMember} onChange={async e=>{const checked=e.target.checked;setIsMahalluMember(checked);if(!checked){setForm(f=>({...f,family_id:0,member_id:0}));setMemberBalance(0);}else if(form.family_id){await loadMembers(form.family_id);}}}/></div>
      {isMahalluMember&&<div className="grid grid-cols-2 gap-4 rounded-lg bg-surface-muted p-4"><div><Label>{t("member_family")} *</Label><Select value={form.family_id||""} onChange={e=>handleFamilyChange(Number(e.target.value))}><option value="">{t("ui_select")}</option>{families.map(f=><option key={f.id} value={f.id}>{f.house_name} ({f.family_number})</option>)}</Select></div><div><Label>{t("member_name")}</Label><Select value={form.member_id||""} onChange={e=>handleMemberChange(Number(e.target.value))}><option value="">{t("ui_select")}</option>{familyMembers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>{memberBalance>0&&<div className="col-span-2 text-xs text-text-secondary">{tx("Outstanding subscription balance","കുടിശ്ശിക വരിസംഖ്യ ബാലൻസ്")}: <strong>{formatCurrency(memberBalance)}</strong> — {tx("amount has been pre-filled and can still be adjusted","തുക മുൻകൂട്ടി നിറച്ചിട്ടുണ്ട്, ക്രമീകരിക്കാവുന്നതാണ്")}.</div>}</div>}
      <div className="grid grid-cols-2 gap-4"><div><Label>{t("don_donor_name")} *</Label><Input value={form.donor_name||""} onChange={e=>setForm({...form,donor_name:e.target.value})}/></div><div><Label>{t("don_donor_phone")}</Label><Input value={form.donor_phone||""} onChange={e=>setForm({...form,donor_phone:e.target.value})}/></div><div><Label>{t("don_category")} *</Label><Select value={form.category_id||""} onChange={e=>{const v=Number(e.target.value);const c=categories.find(x=>x.id===v);setForm({...form,category_id:v,category_name:c?.name||""});if(v!==-1)setOtherCategory("");}}><option value="">{t("ui_select")}</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value={-1}>{tx("Other","മറ്റുള്ളവ")}</option></Select>{Number(form.category_id)===-1&&<Input className="mt-2" placeholder={tx("Enter category","വിഭാഗം നൽകുക")} value={otherCategory} onChange={e=>setOtherCategory(e.target.value)}/>}</div><div><Label>{t("sub_amount")} *</Label><Input type="number" value={form.amount||""} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/></div><div><Label>{t("don_date")}</Label><Input type="date" value={form.donation_date||""} onChange={e=>setForm({...form,donation_date:e.target.value})}/></div><div><Label>{t("sub_method")}</Label><Select value={form.payment_method||"Cash"} onChange={e=>setForm({...form,payment_method:e.target.value})}><option value="Cash">{t("payment_cash")}</option><option value="Cheque">{t("payment_cheque")}</option><option value="UPI">UPI</option><option value="Bank Transfer">{t("payment_bank_transfer")}</option><option value="Card">{t("payment_card")}</option><option value="Other">{t("payment_other")}</option></Select></div><div><Label>{t("don_purpose")}</Label><Input value={form.purpose||""} onChange={e=>setForm({...form,purpose:e.target.value})}/></div></div>
      <div><Label>{t("ui_donor_address")}</Label><Textarea rows={2} value={form.donor_address||""} onChange={e=>setForm({...form,donor_address:e.target.value})}/></div><div><Label>{t("ui_remarks")}</Label><Textarea rows={2} value={form.remarks||""} onChange={e=>setForm({...form,remarks:e.target.value})}/></div>{!editingId&&<label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={sendReceiptEnabled} onChange={e=>setSendReceiptEnabled(e.target.checked)}/><MessageCircle className="h-4 w-4 text-primary"/><span><strong>{tx("Send donation receipt via WhatsApp","സംഭാവന രസീത് വാട്ട്സ്ആപ്പിൽ അയയ്ക്കുക")}</strong><span className="block text-xs text-muted mt-0.5">{tx("Uses the donor's WhatsApp number. The donation is saved even if sending fails.","ദാതാവിന്റെ വാട്ട്സ്ആപ്പ് നമ്പർ ഉപയോഗിക്കും. അയയ്ക്കൽ പരാജയപ്പെട്ടാലും സംഭാവന സേവ് ചെയ്യും.")}</span></span></label>}<div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={()=>setDialogOpen(false)}>{t("action_cancel")}</Button><Button onClick={handleSave}>{t("action_save")}</Button></div>
    </div></Dialog><ConfirmDialog open={confirmOpen} onClose={()=>{setConfirmOpen(false);setPendingDeleteId(null);}} onConfirm={handleDeleteConfirm} title={t("ui_confirm_delete")} confirmLabel={t("ui_delete_donation_label")}/><SecureActionDialog open={resendOpen} onClose={()=>{setResendOpen(false);setResendRow(null);}} onConfirm={executeAdminResend} title={tx("Re-send receipt (administrator)","രസീറ്റ് വീണ്ടും അയക്കുക (അഡ്മിനിസ്ട്രേറ്റർ)")} description={resendRow?tx(`This receipt was already DELIVERED to ${resendRow.donor_name} and is locked for their privacy. Re-send it once more? This is the only re-send this receipt ever gets.`,`ഈ രസീറ്റ് ${resendRow.donor_name} എന്ന വ്യക്തിക്ക് ലഭിച്ചിട്ടുണ്ട്; സ്വകാര്യതയ്‌ക്കായി അത് ലോക്ക് ചെയ്തിരിക്കുന്നു. ഒരിക്കൽ കൂടി അയയ്ക്കണോ? ഇതാണ് ഈ രസീറ്റിന് ലഭിക്കുന്ന ഒരേയൊരു റീ-സെൻഡ്.`):""} confirmLabel={tx("Re-send once","ഒരിക്കൽ കൂടി അയക്കുക")} danger={false}/><SecureActionDialog open={editGateOpen} onClose={()=>setEditGateOpen(false)} onConfirm={performEdit} danger={false} title={tx("Edit donation","സംഭാവന തിരുത്തുക")} description={tx("A donation is a financial record (and possibly a delivered receipt). Editing it is restricted to administrators — your password and reason are written to the audit log.","സംഭാവന ഒരു സാമ്പത്തിക രേഖയാണ് (ഒരുപക്ഷേ ഡെലിവറി ചെയ്ത രസീത്). തിരുത്ത് അഡ്മിനിസ്ട്രേറ്റർമാർക്ക് മാത്രം — നിങ്ങളുടെ പാസ്‌വേഡും കാരണവും ഓഡിറ്റ് ലോഗിൽ രേഖപ്പെടുത്തും.")} reasonPlaceholder={tx("Why is this donation being edited?","എന്തുകൊണ്ടാണ് ഈ സംഭാവന തിരുത്തുന്നത്?")} confirmLabel={tx("Continue to edit","തിരുത്താൻ തുടരുക")}/></div>;
}
