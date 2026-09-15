import { useState, useEffect } from "react";
import { Building2, Wallet, Palette, Database, Save, Tags, Plus, Pencil, Trash2, Power, Award, MapPin, FolderOpen, Info, RefreshCw, AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n";
import { useTheme } from "@/lib/theme";
import { useFx } from "@/lib/fx";
import { Card, CardContent, Button, Input, Label, Select, Textarea, Switch, SectionLabel } from "@/components/ui";
import { MalayalamInput } from "@/components/MalayalamInput";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SecureActionDialog } from "@/components/SecureActionDialog";
import { toast } from "@/lib/toast";
import { setCurrencySymbol } from "@/lib/utils";

interface Settings {
  mahallu_name:string; phone:string; address:string; financial_year_start:string;
  currency_symbol:string; receipt_prefix:string; language:string; theme:string; auto_backup:boolean;
  backup_interval_hours:number; backup_mirror_dir:string; backup_keep_count:number; subscription_monthly_amount:number; subscription_frequency:"Monthly"|"Quarterly";
  affiliation_number:string;
  wakf_reg_no:string; society_reg_no:string;
  village:string; panchayath:string; taluk:string; district:string; pincode:string; state:string;
}
interface Category { id:number; name:string; description?:string; is_active:number; donation_count:number; }
const emptySettings: Settings = {
  mahallu_name:"", phone:"", address:"", financial_year_start:"04-01", currency_symbol:"₹",
  receipt_prefix:"RCP", language:"en", theme:"light", auto_backup:false, backup_interval_hours:24, backup_mirror_dir:"", backup_keep_count:30,
  subscription_monthly_amount:100, subscription_frequency:"Monthly",
  affiliation_number:"",
  wakf_reg_no:"", society_reg_no:"", village:"", panchayath:"", taluk:"", district:"", pincode:"", state:"",
};

export function Settings(){
  const {t,setLang,lang}=useI18n();
  const {theme,setTheme}=useTheme();
  const {pref:fxPref,setPref:setFxPref}=useFx();
  const ml=lang==="ml"; const tx=(en:string,m:string)=>ml?m:en;
  const [clearOpen,setClearOpen]=useState(false);
  const [settings,setSettings]=useState<Settings>(emptySettings);
  const [categories,setCategories]=useState<Category[]>([]);
  const [categoryName,setCategoryName]=useState("");
  const [categoryDescription,setCategoryDescription]=useState("");
  const [editingCategory,setEditingCategory]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [pendingCat,setPendingCat]=useState<Category|null>(null);
  const [catConfirmOpen,setCatConfirmOpen]=useState(false);
  const [appInfo,setAppInfo]=useState<{ version:string }|null>(null);
  const [updState,setUpdState]=useState<"idle"|"checking"|"latest"|"new"|"error">("idle");
  const [updVersion,setUpdVersion]=useState<string>("");
  const [updHasDl,setUpdHasDl]=useState(false);

  const checkUpdatesNow=async()=>{
    setUpdState("checking");
    try{
      const r=await window.mms.updates.checkNow();
      if(r.ok){ if(r.updateAvailable){setUpdState("new");setUpdVersion(r.latestVersion||"");setUpdHasDl(!!r.downloadUrl);} else setUpdState("latest"); }
      else setUpdState("error");
    }catch{setUpdState("error");}
  };

  const confirmDeleteCategory=async()=>{
    if(!pendingCat)return;
    try{await window.mms.donations.removeCategory(pendingCat.id);await loadCategories();toast.success(t("set_cat_deleted"));}
    catch(err:any){toast.error(err.message);}
    finally{setCatConfirmOpen(false);setPendingCat(null);}
  };

  const loadCategories=async()=>{try{setCategories(await window.mms.donations.categoriesAll()||[]);}catch{setCategories([]);}};
  useEffect(()=>{
    Promise.all([window.mms.settings.load(),window.mms.donations.categoriesAll()]).then(([s,c])=>{
      if(s){setSettings({...emptySettings,...s,language:s.language||lang,theme:s.theme||theme,subscription_monthly_amount:Number(s.subscription_monthly_amount??100),subscription_frequency:(s.subscription_frequency==="Quarterly"?"Quarterly":"Monthly"),backup_keep_count:Number(s.backup_keep_count??30)});setCurrencySymbol(s.currency_symbol);}
      setCategories(c||[]);
    }).catch(()=>{}).finally(()=>setLoading(false));
    window.mms.app?.info?.().then(setAppInfo).catch(()=>setAppInfo(null));
  },[]);
  const pickMirrorDir=async()=>{
    try{
      const r=await window.mms.backup.chooseMirrorDir();
      if(r?.success&&r.path)setSettings(s=>({...s,backup_mirror_dir:r.path}));
    }catch(err:any){toast.error(err.message||t("ui_failed_save"));}
  };
  const handleSave=async()=>{
    setSaving(true);
    try{
      await window.mms.settings.save({
        mahalluName:settings.mahallu_name,address:settings.address,phone:settings.phone,
        financialYearStart:settings.financial_year_start,currencySymbol:settings.currency_symbol,
        subscriptionMonthlyAmount:Number(settings.subscription_monthly_amount||0),subscriptionFrequency:settings.subscription_frequency,
        theme:settings.theme,language:settings.language,autoBackup:settings.auto_backup,backupIntervalHours:settings.backup_interval_hours,
        backupMirrorDir:settings.backup_mirror_dir||"",backupKeepCount:Number(settings.backup_keep_count||30),
        receiptPrefix:settings.receipt_prefix,
        affiliationNumber:settings.affiliation_number,
        wakfRegNo:settings.wakf_reg_no, societyRegNo:settings.society_reg_no,
        village:settings.village, panchayath:settings.panchayath, taluk:settings.taluk,
        district:settings.district, pincode:settings.pincode, state:settings.state
      });
      // Currency symbol takes effect across every screen immediately.
      setCurrencySymbol(settings.currency_symbol);
      toast.success(t("ui_save_changes"));
    }catch(err:any){toast.error(err.message||t("ui_failed_save"));}
    finally{setSaving(false);}
  };
  const saveCategory=async()=>{
    if(!categoryName.trim())return toast.error(t("set_cat_name_required"));
    try{
      if(editingCategory) await window.mms.donations.updateCategory(editingCategory,categoryName.trim(),categoryDescription.trim());
      else await window.mms.donations.createCategory(categoryName.trim(),categoryDescription.trim());
      setCategoryName("");setCategoryDescription("");setEditingCategory(null);await loadCategories();toast.success(editingCategory?t("set_cat_updated"):t("set_cat_added"));
    }catch(err:any){toast.error(err.message||t("set_cat_save_failed"));}
  };
  const editCategory=(c:Category)=>{setEditingCategory(c.id);setCategoryName(c.name);setCategoryDescription(c.description||"");};
  const toggleCategory=async(c:Category)=>{try{await window.mms.donations.setCategoryActive(c.id,!c.is_active);await loadCategories();}catch(err:any){toast.error(err.message);}};
  const deleteCategory=async(c:Category)=>{
    if(c.donation_count>0)return toast.error(t("set_cat_has_donations"));
    setPendingCat(c);setCatConfirmOpen(true);
  };
  const handleThemeChange=(value:string)=>{setTheme(value as "light"|"dark");setSettings({...settings,theme:value});};
  const handleLangChange=(value:string)=>{setLang(value as "en"|"ml");setSettings({...settings,language:value});};
  if(loading)return <div className="p-6"><p className="text-sm text-text-tertiary">{t("ui_loading_settings")}</p></div>;
  return <div className="p-6 max-w-5xl space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-medium text-text-primary">{t("set_title")}</h1><p className="text-sm text-text-secondary mt-1">{t("set_subtitle")}</p></div><Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4"/>{saving?t("ui_saving"):t("ui_save_changes")}</Button></div>

    <Card><CardContent className="p-6 space-y-4"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_org_section")}</SectionLabel></div><div className="grid grid-cols-2 gap-4"><div><Label>{t("set_mahallu_name")}</Label><MalayalamInput value={settings.mahallu_name} onChange={value=>setSettings({...settings,mahallu_name:value})}/><p className="text-xs text-muted mt-1">{t("set_ml_enter_hint")}</p></div><div><Label>{t("set_phone")}</Label><Input value={settings.phone} onChange={e=>setSettings({...settings,phone:e.target.value})}/></div><div className="col-span-2"><Label>{t("family_address")}</Label><Textarea rows={2} value={settings.address} onChange={e=>setSettings({...settings,address:e.target.value})}/></div></div>
    <div className="pt-2 border-t border-border"><div className="flex items-center gap-2 mb-3"><Award className="h-4 w-4 text-primary"/><SectionLabel className="mb-0">{t("set_reg_section")}</SectionLabel></div><p className="text-xs text-text-tertiary mb-3">{t("set_reg_hint")}</p><div className="grid grid-cols-3 gap-4"><div><Label>{t("set_smf_reg_no")}</Label><Input value={settings.affiliation_number} onChange={e=>setSettings({...settings,affiliation_number:e.target.value})} placeholder={t("set_smf_reg_no")}/></div><div><Label>{t("set_wakf_reg_no")}</Label><Input value={settings.wakf_reg_no} onChange={e=>setSettings({...settings,wakf_reg_no:e.target.value})} placeholder={t("set_wakf_reg_no")}/></div><div><Label>{t("set_society_reg_no")}</Label><Input value={settings.society_reg_no} onChange={e=>setSettings({...settings,society_reg_no:e.target.value})} placeholder={t("set_society_reg_no")}/></div></div></div>
    <div className="pt-2 border-t border-border"><div className="flex items-center gap-2 mb-3"><MapPin className="h-4 w-4 text-primary"/><SectionLabel className="mb-0">{t("set_location_section")}</SectionLabel></div><p className="text-xs text-text-tertiary mb-3">{t("set_location_hint")}</p><div className="grid grid-cols-3 gap-4"><div><Label>{t("set_village")}</Label><Input value={settings.village} onChange={e=>setSettings({...settings,village:e.target.value})}/></div><div><Label>{t("set_panchayath")}</Label><Input value={settings.panchayath} onChange={e=>setSettings({...settings,panchayath:e.target.value})}/></div><div><Label>{t("set_taluk")}</Label><Input value={settings.taluk} onChange={e=>setSettings({...settings,taluk:e.target.value})}/></div><div><Label>{t("set_district")}</Label><Input value={settings.district} onChange={e=>setSettings({...settings,district:e.target.value})}/></div><div><Label>{t("set_pincode")}</Label><Input value={settings.pincode} onChange={e=>setSettings({...settings,pincode:e.target.value})}/></div><div><Label>{t("set_state")}</Label><Input value={settings.state} onChange={e=>setSettings({...settings,state:e.target.value})}/></div></div></div></CardContent></Card>

    <Card><CardContent className="p-6 space-y-4"><div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_financial_sub_section")}</SectionLabel></div><div className="grid grid-cols-4 gap-4"><div><Label>{t("set_financial_year_start")}</Label><Input value={settings.financial_year_start} onChange={e=>setSettings({...settings,financial_year_start:e.target.value})}/></div><div><Label>{t("set_currency_symbol")}</Label><Input value={settings.currency_symbol} onChange={e=>setSettings({...settings,currency_symbol:e.target.value})}/></div><div><Label>{t("set_receipt_prefix")}</Label><Input value={settings.receipt_prefix} onChange={e=>setSettings({...settings,receipt_prefix:e.target.value})} placeholder="MMJM"/></div><div><Label>{t("set_sub_frequency")}</Label><Select value={settings.subscription_frequency} onChange={e=>setSettings({...settings,subscription_frequency:e.target.value as "Monthly"|"Quarterly"})}><option value="Monthly">{t("set_sub_monthly")}</option><option value="Quarterly">{t("set_sub_quarterly")}</option></Select></div><div><Label>{settings.subscription_frequency === "Quarterly" ? t("set_sub_amount_quarterly") : t("set_sub_amount_monthly")}</Label><Input type="number" min="0" value={settings.subscription_monthly_amount} onChange={e=>setSettings({...settings,subscription_monthly_amount:Number(e.target.value)})}/></div></div><p className="text-xs text-text-tertiary">{t("set_sub_freq_hint")}</p><p className="text-xs text-text-tertiary">{t("set_receipt_prefix_hint")}</p></CardContent></Card>

    <Card><CardContent className="p-6 space-y-5"><div className="flex items-center gap-2"><Tags className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_cat_section")}</SectionLabel></div><div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end"><div><Label>{t("set_cat_name")}</Label><Input value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder={t("set_cat_name_ph")}/></div><div><Label>{t("set_cat_desc")}</Label><Input value={categoryDescription} onChange={e=>setCategoryDescription(e.target.value)} placeholder={t("set_cat_desc_ph")}/></div><div className="flex gap-2"><Button onClick={saveCategory}><Plus className="h-4 w-4"/>{editingCategory?t("set_cat_update"):t("set_cat_add")}</Button>{editingCategory&&<Button variant="secondary" onClick={()=>{setEditingCategory(null);setCategoryName("");setCategoryDescription("");}}>{t("action_cancel")}</Button>}</div></div><div className="border border-border rounded-lg overflow-hidden"><div className="grid grid-cols-[1fr_1fr_110px_120px] px-4 py-2 text-xs text-text-tertiary bg-surface-muted"><span>{t("set_cat_col_name")}</span><span>{t("set_cat_col_desc")}</span><span>{t("set_cat_col_status")}</span><span className="text-right">{t("set_cat_col_actions")}</span></div>{categories.map(c=><div key={c.id} className="grid grid-cols-[1fr_1fr_110px_120px] px-4 py-3 border-t border-border items-center text-sm"><span className="font-medium">{c.name}</span><span className="text-text-secondary">{c.description||"—"}</span><span className={c.is_active?"text-success":"text-text-tertiary"}>{c.is_active?t("set_cat_active"):t("set_cat_inactive")}</span><div className="flex justify-end gap-1"><button className="act-btn act-edit" title={t("action_edit")} onClick={()=>editCategory(c)}><Pencil className="h-4 w-4"/></button><button className="act-btn" title={c.is_active?t("set_cat_deactivate"):t("set_cat_activate")} onClick={()=>toggleCategory(c)}><Power className="h-4 w-4"/></button><button className="act-btn act-del" title={c.donation_count>0?t("set_cat_cannot_delete"):t("set_cat_delete")} disabled={c.donation_count>0} onClick={()=>deleteCategory(c)}><Trash2 className="h-4 w-4"/></button></div></div>)}</div><p className="text-xs text-text-tertiary">{t("set_cat_delete_hint")}</p></CardContent></Card>

    <Card><CardContent className="p-6 space-y-4"><div className="flex items-center gap-2"><Palette className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_appearance_section")}</SectionLabel></div><div className="grid grid-cols-3 gap-4"><div><Label>{t("set_theme")}</Label><Select value={settings.theme} onChange={e=>handleThemeChange(e.target.value)}><option value="light">{t("set_theme_light")}</option><option value="dark">{t("set_theme_dark")}</option></Select></div><div><Label>{t("set_language")}</Label><Select value={lang} onChange={e=>handleLangChange(e.target.value)}><option value="en">{t("set_lang_english")}</option><option value="ml">{t("set_lang_malayalam")}</option></Select></div><div><Label>{t("set_animations")}</Label><Select value={fxPref} onChange={e=>setFxPref(e.target.value as "auto"|"reduced"|"full")}><option value="auto">{t("set_anim_auto")}</option><option value="reduced">{t("set_anim_reduced")}</option><option value="full">{t("set_anim_full")}</option></Select><p className="text-xs text-muted mt-1">{t("set_anim_hint")}</p></div></div></CardContent></Card>

    <Card><CardContent className="p-6 space-y-4"><div className="flex items-center gap-2"><Database className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_backup_section")}</SectionLabel></div><div className="space-y-4"><div className="flex items-center justify-between"><div><Label className="mb-0">{t("set_auto_backup")}</Label><p className="text-xs text-text-tertiary mt-1">{t("ui_auto_backup_desc")}</p></div><Switch checked={settings.auto_backup} onCheckedChange={v=>setSettings({...settings,auto_backup:v})}/></div><div className="grid grid-cols-2 gap-4"><div><Label>{t("set_backup_interval")}</Label><Input type="number" min="1" value={settings.backup_interval_hours} onChange={e=>setSettings({...settings,backup_interval_hours:Number(e.target.value)})}/></div><div><Label>{t("set_backup_keep")}</Label><Input type="number" min="3" max="200" value={settings.backup_keep_count} onChange={e=>setSettings({...settings,backup_keep_count:Number(e.target.value)})}/><p className="text-xs text-text-tertiary mt-1">{t("set_backup_keep_hint")}</p></div></div><div><Label className="mb-0">{t("set_backup_mirror")}</Label><p className="text-xs text-text-tertiary mt-1">{t("set_backup_mirror_desc")}</p><div className="flex gap-2 mt-2"><Input className="flex-1" value={settings.backup_mirror_dir||""} placeholder={t("set_backup_mirror_none")} onChange={e=>setSettings({...settings,backup_mirror_dir:e.target.value})}/><Button variant="secondary" onClick={pickMirrorDir}><FolderOpen className="h-4 w-4"/>{t("set_backup_mirror_pick")}</Button>{settings.backup_mirror_dir&&<Button variant="secondary" onClick={()=>setSettings({...settings,backup_mirror_dir:""})}>{t("set_backup_mirror_clear")}</Button>}</div></div></div></CardContent></Card>
<Card><CardContent className="p-6 space-y-4"><div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-danger"/><SectionLabel className="mb-0">{t("set_danger_section")}</SectionLabel></div><div className="flex items-center justify-between gap-4"><div className="flex-1"><Label className="mb-0">{t("set_clear_data_title")}</Label><p className="text-xs text-text-tertiary mt-1">{t("set_clear_data_desc")}</p></div><Button variant="danger" onClick={()=>setClearOpen(true)}><Trash2 className="h-4 w-4"/>{t("set_clear_data_btn")}</Button></div></CardContent></Card>
<SecureActionDialog open={clearOpen} onClose={()=>setClearOpen(false)} title={t("set_clear_data_title")} description={t("set_clear_data_desc")} reasonPlaceholder={t("set_clear_data_reason")} confirmLabel={t("set_clear_data_confirm")} onConfirm={async({reason,password}:any)=>{const r:any=await window.mms.system.clearAllData(reason,password);toast.success(t("set_clear_data_done"));setTimeout(()=>window.location.reload(),900);}}/>
    <Card><CardContent className="p-6 space-y-3"><div className="flex items-center gap-2"><Info className="h-5 w-5 text-primary"/><SectionLabel className="mb-0">{t("set_about_section")}</SectionLabel></div><div className="text-sm"><span className="text-text-tertiary">{t("set_app_version")}</span><div className="font-medium">{appInfo?.version || "—"}</div></div><div className="pt-1 border-t border-border/60"><div className="flex items-center gap-2 flex-wrap"><Button variant="secondary" onClick={checkUpdatesNow} disabled={updState==="checking"}>{updState==="checking"?<RefreshCw className="h-4 w-4 animate-spin"/>:<RefreshCw className="h-4 w-4"/>}{updState==="checking"?t("upd_checking"):t("upd_check_now")}</Button>{updState==="latest"&&<span className="text-xs text-text-tertiary">{t("upd_up_to_date")}</span>}{updState==="new"&&<span className="text-xs font-medium text-primary inline-flex items-center gap-1">{t("upd_found_new")}{updVersion?` (v${updVersion})`:""}{updHasDl&&<button className="underline" onClick={()=>window.mms.updates.openDownload().catch(()=>{})}>{t("upd_download")}</button>}<button className="underline" onClick={()=>window.mms.updates.openReleasePage().catch(()=>{})}>{t("upd_open")}</button></span>}{updState==="error"&&<span className="text-xs text-rose-600">{t("upd_check_failed")}</span>}</div><p className="text-xs text-text-tertiary mt-1.5">{t("upd_monthly_note")}</p></div></CardContent></Card>
    <div className="flex justify-end"><Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4"/>{saving?t("ui_saving"):t("ui_save_changes")}</Button></div>
    <ConfirmDialog
      open={catConfirmOpen}
      onClose={()=>{setCatConfirmOpen(false);setPendingCat(null);}}
      onConfirm={confirmDeleteCategory}
      title={t("set_cat_delete_title")}
      confirmLabel={t("set_cat_delete")}
      danger
      description={pendingCat?t("set_cat_delete_confirm"):""}
    />
  </div>;
}
