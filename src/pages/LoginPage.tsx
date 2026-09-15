import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, Loader2, Eye, EyeOff, ShieldCheck, Database, AlertTriangle, UserPlus } from "lucide-react";
import { useAuth, type AuthUser } from "@/lib/auth";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";

export function LoginPage() {
  const { t, lang } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const ml = lang === "ml";
  const [setup, setSetup] = useState(false); const [checkedSetup, setCheckedSetup] = useState(false);
  const [mustRotate, setMustRotate] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState(""); const [fullName, setFullName] = useState(""); const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const copy = {
    bridge: ml ? "ആപ്പ് വേണ്ടവിധം ലോഡ് ആയില്ല. ആപ്പ് അടച്ച് വീണ്ടും തുറക്കുക." : "The app failed to load properly. Please close and reopen the app.", loginFailed: ml ? "ലോഗിൻ പരാജയപ്പെട്ടു. വിവരങ്ങൾ പരിശോധിക്കുക." : "Login failed. Please check your credentials.", unexpected: ml ? "അപ്രതീക്ഷിത പിശക് സംഭവിച്ചു." : "An unexpected error occurred.", welcome: ml ? "സ്വാഗതം" : "Welcome", welcomeBack: ml ? "വീണ്ടും സ്വാഗതം." : "Welcome back.", setupTitle: ml ? "ആദ്യ സജ്ജീകരണം" : "Initial Setup", setupSub: ml ? "ആദ്യ Administrator അക്കൗണ്ട് സൃഷ്ടിക്കുക." : "Create the first Administrator account.", fullName: ml ? "പൂർണ്ണ പേര്" : "Full name", username: ml ? "ഉപയോക്തൃനാമം" : "Username", password: ml ? "പാസ്‌വേഡ്" : "Password", confirm: ml ? "പാസ്‌വേഡ് സ്ഥിരീകരിക്കുക" : "Confirm password", create: ml ? "Administrator അക്കൗണ്ട് സൃഷ്ടിക്കുക" : "Create Administrator Account", creating: ml ? "സൃഷ്ടിക്കുന്നു..." : "Creating...", mismatch: ml ? "പാസ്‌വേഡുകൾ പൊരുത്തപ്പെടുന്നില്ല." : "Passwords do not match.", requirements: ml ? "കുറഞ്ഞത് 8 അക്ഷരങ്ങൾ, വലിയക്ഷരം, ചെറിയക്ഷരം, സംഖ്യ, പ്രത്യേക ചിഹ്നം." : "At least 8 characters, uppercase, lowercase, number and special character.", manageTitle: ml ? "നിങ്ങളുടെ മഹല്ല്\nവ്യക്തതയോടെ നിയന്ത്രിക്കുക." : "Manage your mahallu\nwith clarity.", manageText: ml ? "കുടുംബങ്ങൾ, അംഗങ്ങൾ, സംഭാവനകൾ, സർട്ടിഫിക്കറ്റുകൾ എന്നിവ ഒരിടത്ത് കൈകാര്യം ചെയ്യാനുള്ള ആധുനിക ആപ്പ്." : "A modern app for families, members, donations, certificates, and more — all in one place.", secured: ml ? "PBKDF2 സുരക്ഷിതം" : "PBKDF2 secured", offline: ml ? "ഓഫ്‌ലൈൻ SQLite" : "Offline SQLite", signing: ml ? "സൈൻ ഇൻ ചെയ്യുന്നു..." : "Signing in...", minimize: ml ? "ചുരുക്കുക" : "Minimize", maximize: ml ? "വലുതാക്കുക" : "Maximize", close: ml ? "അടയ്ക്കുക" : "Close", rotateTitle: ml ? "പാസ്‌വേഡ് അപ്ഡേറ്റ് ചെയ്യുക" : "Update your password", rotateSub: ml ? "ഈ അക്കൗണ്ട് പൊതുവിൽ അറിയപ്പെടുന്ന ഒരു സ്ഥിര പാസ്‌വേഡ് ആണ് ഉപയോഗിക്കുന്നത്. സുരക്ഷയ്ക്ക് ഇപ്പോൾ പുതിയ പാസ്‌വേഡ് സജ്ജമാക്കുക." : "This account still uses a publicly-known default password. For security, set a new one now.", rotateNew: ml ? "പുതിയ പാസ്‌വേഡ്" : "New password", rotateSaved: ml ? "പാസ്‌വേഡ് അപ്ഡേറ്റ് ചെയ്തു. സ്വാഗതം!" : "Password updated. Welcome!", rotate: ml ? "പാസ്‌വേഡ് സജ്ജമാക്കുക" : "Set new password"
  };
  useEffect(() => { (async () => { try { const r = await (window as any).mms?.auth?.setupStatus?.(); setSetup(!!r?.required); } catch {} finally { setCheckedSetup(true); } })(); }, []);
  const handleLogin = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); setError(null); if (!(window as any).mms) { setError(copy.bridge); setLoading(false); return; } try { const result = await (window as any).mms.auth.login(username, password); if (result.success && result.user) {
        // V035 rotation gate: accounts still carrying a publicly-committed demo
        // password are flagged must_change_pwd — force a new password first.
        if (result.user.mustChangePwd) { setMustRotate(result.user); setPassword(""); setConfirmPassword(""); setLoading(false); return; }
        setUser(result.user); toast.success(`${copy.welcome}, ${result.user.fullName}`); navigate("/");
      } else { const msg=result.error||copy.loginFailed; setError(msg); toast.error(msg); } } catch(err:any) { const msg=err?.message||copy.unexpected; setError(msg); toast.error(msg); } finally { setLoading(false); } };
  const handleRotate = async (e: React.FormEvent) => { e.preventDefault(); if (password !== confirmPassword) { setError(copy.mismatch); return; } setLoading(true); setError(null); try { await (window as any).mms.auth.changePassword(mustRotate!.id, password); setUser({ ...mustRotate!, mustChangePwd: false }); toast.success(copy.rotateSaved); navigate("/"); } catch(err:any){ setError(err?.message||copy.unexpected); } finally { setLoading(false); } };
  const handleSetup = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); setError(null); if (password !== confirmPassword) { setError(copy.mismatch); setLoading(false); return; } try { const result=await (window as any).mms.auth.createInitialAdministrator(username,fullName,password); if(result.success&&result.user){setUser(result.user);toast.success(copy.welcome);navigate("/");}else{setError(result.error||copy.unexpected);} } catch(err:any){setError(err?.message||copy.unexpected);} finally{setLoading(false);} };
  return (
    <div className="login-wrap">
      <div className="login-win-controls">
        <button className="win-btn" onClick={()=>window.mms.win.minimize()} title={copy.minimize}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14"/></svg></button>
        <button className="win-btn" onClick={()=>window.mms.win.maximize()} title={copy.maximize}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="5" width="14" height="14" rx="2"/></svg></button>
        <button className="win-btn win-close" onClick={()=>window.mms.win.close()} title={copy.close}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>

      {/* Brand panel */}
      <div className="login-left">
        <div className="login-deco-1"/><div className="login-deco-2"/><div className="login-deco-3"/>
        <div className="login-grid-overlay"/>
        <div className="login-pattern" aria-hidden="true"/>
        <div className="login-content">
          <div className="login-logo-row">
            <div className="login-logo-box"><img src="./logo.png" alt="MMS" /></div>
            <div><h1 className="login-brand-name">MMS</h1><p className="login-brand-sub">{t("app_name")}</p></div>
          </div>
          <div>
            <h2 className="login-hero-title">{copy.manageTitle.split("\n").map((line,i)=><span key={i}>{i>0&&<br/>}{line}</span>)}</h2>
            <p className="login-hero-text">{t("app_subtitle")}. {copy.manageText}</p>
            <div className="login-feature-row">
              <div className="login-feature"><span className="login-feature-ic"><ShieldCheck size={14}/></span><b>{copy.secured}</b></div>
              <div className="login-feature"><span className="login-feature-ic"><Database size={14}/></span><b>{copy.offline}</b></div>
            </div>
          </div>
          <div className="login-stats">
            <div className="login-stat"><b>20+</b><small>{t("login_stat_registers")}</small></div>
            <div className="login-stat"><b>100%</b><small>{t("login_stat_offline")}</small></div>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-mobile-logo-row lg:hidden"><div className="login-logo-box-sm"><img src="./logo.png" alt="MMS" /></div><div><h1 className="login-brand-name">MMS</h1><p className="login-brand-sub">{t("app_name")}</p></div></div>
          {checkedSetup && setup ? <>
            <div className="mb-4"><h2 className="login-form-title"><UserPlus size={21} className="inline mr-2 align-[-3px]"/>{copy.setupTitle}</h2><p className="login-form-sub">{copy.setupSub}</p></div>
            {error&&<div className="login-error"><AlertTriangle size={16} className="toast-ic-err flex-shrink-0 mt-1"/><p>{error}</p></div>}
            <form onSubmit={handleSetup} className="login-form">
              <div><label className="lbl">{copy.fullName}</label><input className="inp login-submit" value={fullName} onChange={e=>setFullName(e.target.value)} required autoFocus/></div>
              <div><label className="lbl">{copy.username}</label><input className="inp login-submit" value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={32} autoComplete="username" required/></div>
              <div><label className="lbl">{copy.password}</label><input className="inp login-submit" type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" required/></div>
              <div><label className="lbl">{copy.confirm}</label><input className="inp login-submit" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" required/></div>
              <p className="text-xs opacity-70">{copy.requirements}</p>
              <button type="submit" className="btn bp bblock login-submit" disabled={loading}>{loading?<><Loader2 size={16} className="animate-spin"/>{copy.creating}</>:<><UserPlus size={16}/>{copy.create}</>}</button>
            </form>
          </> : mustRotate ? <>
            <div className="mb-4"><h2 className="login-form-title"><ShieldCheck size={21} className="inline mr-2 align-[-3px]"/>{copy.rotateTitle}</h2><p className="login-form-sub">{copy.rotateSub}</p></div>
            {error&&<div className="login-error"><AlertTriangle size={16} className="toast-ic-err flex-shrink-0 mt-1"/><p>{error}</p></div>}
            <form onSubmit={handleRotate} className="login-form">
              <div><label className="lbl">{copy.rotateNew}</label><input className="inp login-submit" type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" required autoFocus/></div>
              <div><label className="lbl">{copy.confirm}</label><input className="inp login-submit" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} autoComplete="new-password" required/></div>
              <p className="text-xs opacity-70">{copy.requirements}</p>
              <button type="submit" className="btn bp bblock login-submit" disabled={loading}>{loading?<><Loader2 size={16} className="animate-spin"/>...</>:<><ShieldCheck size={16}/>{copy.rotate}</>}</button>
            </form>
          </> : <>
            <div className="mb-4"><h2 className="login-form-title">{t("login_title")}</h2><p className="login-form-sub">{copy.welcomeBack}</p></div>
            {error&&<div className="login-error"><AlertTriangle size={16} className="toast-ic-err flex-shrink-0 mt-1"/><p>{error}</p></div>}
            <form onSubmit={handleLogin} className="login-form">
              <div><label className="lbl">{t("login_username")}</label><input className="inp login-submit" value={username} onChange={e=>setUsername(e.target.value)} autoFocus autoComplete="username" required/></div>
              <div><label className="lbl">{t("login_password")}</label><div className="login-pwd-wrap"><input className="inp login-submit" type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/><button type="button" onClick={()=>setShowPassword(!showPassword)} className="login-pwd-toggle">{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></div>
              <button type="submit" className="btn bp bblock login-submit" disabled={loading}>{loading?<><Loader2 size={16} className="animate-spin"/>{copy.signing}</>:<><LogIn size={16}/>{t("login_button")}</>}</button>
            </form>
          </> }
          <p className="login-foot">{t("app_name")} · v2.0.0</p>
        </div>
      </div>
    </div>
  );
}
