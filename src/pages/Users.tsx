import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, Lock, Unlock, KeyRound, Users as UsersIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Dialog, Input, Label, Select, Badge } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/utils";

interface UserRow {
  id: number; username: string; full_name: string; role: string;
  is_active: number | boolean; must_change_pwd: number | boolean;
  last_login: string | null; created_at: string | null;
}

const emptyForm = { username: "", full_name: "", role: "Staff", password: "" };
const locked = (u: UserRow) => !u.is_active;

export function Users() {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const roleLabel = (role: string) => ml ? ({ Administrator: "അഡ്മിനിസ്ട്രേറ്റർ", President: "പ്രസിഡന്റ്", Secretary: "സെക്രട്ടറി", Treasurer: "ട്രഷറർ", Imam: "ഇമാം", Staff: "സ്റ്റാഫ്", Auditor: "ഓഡിറ്റർ" } as Record<string, string>)[role] || role : role;
  const activeLabel = ml ? "സജീവം" : "Active";
  const lockedLabel = ml ? "ലോക്ക് ചെയ്തു" : "Locked";
  const yesNo = (v: boolean | number) => v ? (ml ? "അതെ" : "Yes") : (ml ? "ഇല്ല" : "No");

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [preview, setPreview] = useState<UserRow | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try { setRows(await window.mms.users.list() || []); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered = rows.filter(u => !search || u.username?.toLowerCase().includes(search.toLowerCase()) || u.full_name?.toLowerCase().includes(search.toLowerCase()));

  const save = async () => {
    if (!form.username || !form.full_name) { toast.error(t("ui_username_fullname_required")); return; }
    if (!editingId && !form.password) { toast.error(t("ui_password_required")); return; }
    try {
      if (editingId) {
        await window.mms.users.update(editingId, { fullName: form.full_name, role: form.role, isActive: true });
        toast.success(t("ui_save_changes"));
      } else {
        await window.mms.users.create({ username: form.username, fullName: form.full_name, role: form.role, password: form.password });
        toast.success(t("usr_add"));
      }
      setDialogOpen(false); setEditingId(null); setForm({ ...emptyForm }); await fetchUsers();
    } catch (e: any) { toast.error(e.message || t("ui_failed_save")); }
  };

  const toggleLock = async (u: UserRow) => {
    try { await window.mms.users.toggleLock(u.id, !locked(u)); toast.success(!locked(u) ? t("ui_user_locked") : t("ui_user_unlocked")); await fetchUsers(); }
    catch (e: any) { toast.error(e.message); }
  };
  const resetPassword = async () => {
    if (!resetUserId || !newPwd) { toast.error(t("tb_pwd_required")); return; }
    try { await window.mms.users.resetPassword(resetUserId, newPwd); toast.success(t("ui_password_reset")); setResetUserId(null); setNewPwd(""); }
    catch (e: any) { toast.error(e.message); }
  };
  const remove = async () => {
    if (deleteId == null) return;
    try { await window.mms.users.remove(deleteId); toast.success(t("ui_record_deleted")); await fetchUsers(); }
    catch (e: any) { toast.error(e.message); }
    finally { setDeleteId(null); }
  };

  const columns: Column<UserRow>[] = [
    { header: t("usr_username"), accessor: r => <span className="code-text-sm text-primary">{r.username}</span> },
    { header: t("usr_full_name"), accessor: r => r.full_name },
    { header: t("usr_role"), accessor: r => <Badge variant={r.role === "Administrator" ? "default" : "muted"}>{roleLabel(r.role)}</Badge> },
    { header: t("family_status"), accessor: r => <Badge variant={locked(r) ? "danger" : "success"}>{locked(r) ? lockedLabel : activeLabel}</Badge> },
    { header: t("usr_last_login"), accessor: r => formatDate(r.last_login) },
    { header: "", align: "right", accessor: r => <div className="rowact">
      <button className="act-btn act-view" title={locked(r) ? t("ui_unlock") : t("ui_lock")} onClick={() => toggleLock(r)}>{locked(r) ? <Unlock size={14} /> : <Lock size={14} />}</button>
      <button className="act-btn act-view" title={t("usr_reset_password")} onClick={() => setResetUserId(r.id)}><KeyRound size={14} /></button>
      <button className="act-btn act-edit" title={t("action_edit")} onClick={() => { setEditingId(r.id); setForm({ username: r.username, full_name: r.full_name, role: r.role, password: "" }); setDialogOpen(true); }}><Edit2 size={14} /></button>
      <button className="act-btn act-del" title={t("action_delete")} onClick={() => setDeleteId(r.id)}><Trash2 size={14} /></button>
    </div> },
  ];

  return <div className="view view-enter">
    <div className="vhead"><div className="modic t-em"><UsersIcon size={20} /></div><div><h1>{t("usr_title")}</h1><div className="vs">{t("usr_subtitle")}</div></div><div className="vr"><Button onClick={() => { setEditingId(null); setForm({ ...emptyForm }); setDialogOpen(true); }}><Plus size={14} /> {t("usr_add")}</Button></div></div>
    <DataTable columns={columns} rows={filtered} loading={loading} total={filtered.length} page={1} pageSize={filtered.length || 1} totalPages={1} searchValue={search} onSearchChange={setSearch} rowKey={r => r.id} onRowDoubleClick={setPreview} />

    <Dialog open={!!preview} onClose={() => setPreview(null)} title={t("usr_title")}>
      {preview && <div className="m-b"><div className="dlg-hero t-em"><div className="dlg-hero-ic">{preview.username.charAt(0).toUpperCase()}</div><div className="dlg-hero-body"><div className="dlg-hero-title">{preview.full_name}</div><div className="dlg-hero-sub">@{preview.username} · {roleLabel(preview.role)}</div></div><Badge variant={locked(preview) ? "danger" : "success"}>{locked(preview) ? lockedLabel : activeLabel}</Badge></div><div className="det-grid"><div className="det"><span className="k">{t("usr_username")}</span><span className="v">{preview.username}</span></div><div className="det"><span className="k">{t("usr_full_name")}</span><span className="v">{preview.full_name}</span></div><div className="det"><span className="k">{t("usr_role")}</span><span className="v">{roleLabel(preview.role)}</span></div><div className="det"><span className="k">{t("family_status")}</span><span className="v">{locked(preview) ? lockedLabel : activeLabel}</span></div><div className="det"><span className="k">{t("ui_must_change_pwd")}</span><span className="v">{yesNo(preview.must_change_pwd)}</span></div><div className="det"><span className="k">{t("usr_last_login")}</span><span className="v">{formatDate(preview.last_login)}</span></div></div><div className="dlg-actions"><Button variant="secondary" onClick={() => setPreview(null)}>{t("ui_close")}</Button><Button onClick={() => { setEditingId(preview.id); setForm({ username: preview.username, full_name: preview.full_name, role: preview.role, password: "" }); setPreview(null); setDialogOpen(true); }}><Edit2 size={14} /> {t("action_edit")}</Button></div></div>}
    </Dialog>

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editingId ? t("action_edit") : t("usr_add")}>
      <div className="m-b"><div className="grid-2"><div><Label>{t("usr_username")} *</Label><Input value={form.username} disabled={!!editingId} onChange={e => setForm({ ...form, username: e.target.value })} /></div><div><Label>{t("usr_full_name")} *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div><div><Label>{t("usr_role")}</Label><Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="Administrator">{roleLabel("Administrator")}</option><option value="President">{roleLabel("President")}</option><option value="Secretary">{roleLabel("Secretary")}</option><option value="Treasurer">{roleLabel("Treasurer")}</option><option value="Imam">{roleLabel("Imam")}</option><option value="Staff">{roleLabel("Staff")}</option><option value="Auditor">{roleLabel("Auditor")}</option></Select></div>{!editingId && <div><Label>{t("login_password")} *</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>}</div></div><div className="m-f"><Button variant="secondary" onClick={() => setDialogOpen(false)}>{t("action_cancel")}</Button><Button onClick={save}>{t("action_save")}</Button></div>
    </Dialog>

    <Dialog open={resetUserId !== null} onClose={() => { setResetUserId(null); setNewPwd(""); }} title={t("usr_reset_password")} className="modal-sm">
      <div className="m-b"><Label>{t("login_password")}</Label><Input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} autoFocus /></div><div className="m-f"><Button variant="secondary" onClick={() => { setResetUserId(null); setNewPwd(""); }}>{t("action_cancel")}</Button><Button onClick={resetPassword}>{t("ui_reset_btn")}</Button></div>
    </Dialog>

    <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={remove} title={t("ui_confirm_delete")} confirmLabel={t("ui_delete_user_label")} />
  </div>;
}
