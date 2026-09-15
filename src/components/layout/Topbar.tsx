import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Moon, Sun, Database, ChevronDown, User, Settings, LogOut, KeyRound, ShieldCheck } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Dialog, Button, Input, Label, Badge } from "@/components/ui";
import { GlobalSearch } from "@/components/layout/GlobalSearch";

const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "nav_dashboard", "/families": "nav_families", "/members": "nav_members", "/staff": "nav_staff", "/committee": "nav_committee", "/subscriptions": "nav_subscriptions", "/donations": "nav_donations", "/accounting": "nav_accounting", "/marriages": "nav_marriage", "/deaths": "nav_death", "/welfare": "nav_welfare", "/certificates": "nav_certificates", "/tokens": "nav_tokens", "/reports": "nav_reports", "/settings": "nav_settings", "/users": "nav_users", "/audit": "nav_audit", "/backup": "nav_backup",
};

export function Topbar() {
  const { theme, toggle } = useTheme();
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = t(PAGE_TITLE_KEYS[location.pathname] || "nav_dashboard");
  const initials = user?.initials ?? "?";
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Close avatar dropdown on outside-click or Escape.
  useEffect(() => {
    const handler = (e: MouseEvent) => { const target = e.target as HTMLElement; if (!target.closest("[data-dropdown]") && !target.closest("[data-global-search]")) { setAvatarOpen(false); } };
    const escHandler = (e: KeyboardEvent) => { if (e.key === "Escape") { setAvatarOpen(false); } };
    document.addEventListener("mousedown", handler); document.addEventListener("keydown", escHandler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", escHandler); };
  }, []);

  const handleQuickBackup = async () => {
    try {
      toast.info(t("tb_creating_backup"));
      const result = await window.mms.backup.create();
      if (result && result.success === false) { if (result.error !== "cancelled") toast.error(result.error || t("tb_backup_failed")); return; }
      const path: string | undefined = typeof result === "string" ? result : result?.path;
      if (path) toast.success(t("tb_backup_saved") + ": " + path.split(/[\\/]/).pop()); else toast.success(t("tb_backup_created"));
    } catch (e: any) { toast.error(e.message || t("tb_backup_failed")); }
  };

  const handleChangePassword = async () => {
    if (!user?.id) { toast.error(t("tb_no_session")); return; }
    if (!newPwd) { toast.error(t("tb_pwd_required")); return; }
    if (newPwd.length < 6) { toast.error(t("tb_pwd_min")); return; }
    if (newPwd !== confirmPwd) { toast.error(t("tb_pwd_mismatch")); return; }
    setSavingPwd(true);
    try {
      const result: any = await window.mms.auth.changePassword(user.id, newPwd);
      if (result && result.success === false) throw new Error(result.error || t("ui_failed_save"));
      toast.success(t("tb_pwd_updated")); setNewPwd(""); setConfirmPwd(""); setProfileOpen(false);
    } catch (e: any) { toast.error(e.message || t("ui_failed_save")); }
    finally { setSavingPwd(false); }
  };

  const handleLogout = async () => { setAvatarOpen(false); await logout(); navigate("/login"); };

  return <>
    <header className="topbar">
      <div className="tb-brand">
        <span className="tb-brand-tile"><img src="./logo-green.png" alt="MMS" /></span>
        <div className="tb-brand-nm"><b>MMS</b><small>{t("app_name")}</small></div>
      </div>
      <div className="tb-title"><b>{pageTitle}</b></div>
      <div className="tb-center">
        <GlobalSearch value={searchQuery} onChange={setSearchQuery} />
      </div>
      <div className="tb-right">
        <div className="langseg"><button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} title={t("set_lang_english")}>EN</button><button type="button" className={lang === "ml" ? "on" : ""} onClick={() => setLang("ml")} title="മലയാളം">മല</button></div>
        <button className="ibtn" onClick={toggle} title={t("tb_toggle_theme")}>{theme === "dark" ? <Sun size={17} strokeWidth={2} /> : <Moon size={17} strokeWidth={2} />}</button>
        <button className="ibtn" title={t("tb_quick_backup")} onClick={handleQuickBackup}><Database size={17} strokeWidth={2} /></button><div className="tbdiv" />
        <div data-dropdown className="relative"><button className="avbtn" onClick={(e) => { e.stopPropagation(); setAvatarOpen(!avatarOpen); }}><span className="av">{initials}</span><b>{user?.username ?? "—"}</b><ChevronDown size={14} className="chev" /></button>
          {avatarOpen && <div className="dropdown-fixed avatar-dropdown"><div className="dropdown-head"><b className="dlg-hero-title">{user?.fullName}</b><small className="dlg-hero-sub">{user?.role}</small></div><button className="menuit-btn" onClick={() => { setAvatarOpen(false); setProfileOpen(true); }}><User size={15} /> {t("tb_profile")}</button><button className="menuit-btn" onClick={() => { setAvatarOpen(false); navigate("/settings"); }}><Settings size={15} /> {t("tb_settings")}</button><div className="menu-divider" /><button className="menuit-btn danger" onClick={handleLogout}><LogOut size={15} /> {t("action_logout")}</button></div>}
        </div>
      </div>
      <div className="win-controls"><button className="win-btn" onClick={() => window.mms.win.minimize()} title={t("tb_minimize")}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg></button><button className="win-btn" onClick={() => window.mms.win.maximize()} title={t("tb_maximize")}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="5" width="14" height="14" rx="2" /></svg></button><button className="win-btn win-close" onClick={() => window.mms.win.close()} title={t("ui_close")}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button></div>
    </header>
    <Dialog open={profileOpen} onClose={() => { setProfileOpen(false); setNewPwd(""); setConfirmPwd(""); }} title={t("tb_my_profile")} className="modal-sm">
      <div className="dlg-pad">{user && <><div className="dlg-hero t-em"><div className="dlg-hero-ic">{user.initials || user.username?.charAt(0).toUpperCase() || "?"}</div><div className="dlg-hero-body"><div className="dlg-hero-title">{user.fullName}</div><div className="dlg-hero-sub">@{user.username}</div></div><Badge variant={user.role === "Administrator" ? "default" : "muted"}>{user.role}</Badge></div><div className="det-grid mb-4"><div className="det"><span className="k">{t("tb_full_name")}</span><span className="v">{user.fullName || "—"}</span></div><div className="det"><span className="k">{t("tb_username")}</span><span className="v">{user.username}</span></div><div className="det"><span className="k">{t("tb_role")}</span><span className="v">{user.role}</span></div><div className="det"><span className="k">{t("tb_status")}</span><span className="v">{user.isActive ? t("tb_active") : t("tb_inactive")}</span></div></div><div className="pwd-section-label t-em"><KeyRound size={14} className="ic" /><b>{t("tb_change_password")}</b></div><div className="flex-col gap-3"><div><Label>{t("tb_new_password")}</Label><Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder={t("tb_new_password")} autoFocus /></div><div><Label>{t("tb_confirm_password")}</Label><Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder={t("tb_confirm_password")} /></div></div><div className="dlg-actions"><Button variant="secondary" onClick={() => { setProfileOpen(false); setNewPwd(""); setConfirmPwd(""); }} disabled={savingPwd}>{t("ui_close")}</Button><Button onClick={handleChangePassword} disabled={savingPwd}>{savingPwd ? t("tb_saving") : <><ShieldCheck size={14} />{t("tb_save_password")}</>}</Button></div></>}</div>
    </Dialog>
  </>;
}
