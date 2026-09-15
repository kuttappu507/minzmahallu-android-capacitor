import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/i18n";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ToastContainer } from "@/components/ToastContainer";
import { Splash } from "@/components/Splash";
import { CloseConfirmDialog } from "@/components/CloseConfirmDialog";
import UpdateBanner from "@/components/UpdateBanner";
import "@fontsource-variable/anek-malayalam/wght.css";
import "@/styles/globals.css";
import { LoginPage } from "@/pages/LoginPage";
import { UninstallConfirm } from "@/pages/UninstallConfirm";

// Lazy-load all page components so the initial bundle is smaller.
// Each page loads on-demand when first navigated to.
const Dashboard = lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Families = lazy(() => import("@/pages/Families").then(m => ({ default: m.Families })));
const Members = lazy(() => import("@/pages/Members").then(m => ({ default: m.Members })));
const Staff = lazy(() => import("@/pages/Staff").then(m => ({ default: m.Staff })));
const Committee = lazy(() => import("@/pages/Committee").then(m => ({ default: m.Committee })));
const Subscriptions = lazy(() => import("@/pages/Subscriptions").then(m => ({ default: m.Subscriptions })));
const Donations = lazy(() => import("@/pages/Donations").then(m => ({ default: m.Donations })));
const WhatsApp = lazy(() => import("@/pages/WhatsApp").then(m => ({ default: m.WhatsApp })));
const Accounting = lazy(() => import("@/pages/Accounting").then(m => ({ default: m.Accounting })));
const Assets = lazy(() => import("@/pages/Assets").then(m => ({ default: m.Assets })));
const Marriages = lazy(() => import("@/pages/Marriages").then(m => ({ default: m.Marriages })));
const Deaths = lazy(() => import("@/pages/Deaths").then(m => ({ default: m.Deaths })));
const Welfare = lazy(() => import("@/pages/Welfare").then(m => ({ default: m.Welfare })));
const Certificates = lazy(() => import("@/pages/Certificates").then(m => ({ default: m.Certificates })));
const TokensWithPrint = lazy(() => import("@/pages/TokensWithPrint").then(m => ({ default: m.TokensWithPrint })));
const TokenEvents = lazy(() => import("@/pages/TokenEvents").then(m => ({ default: m.TokenEvents })));
const Reports = lazy(() => import("@/pages/Reports").then(m => ({ default: m.Reports })));
const Settings = lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })));
const Users = lazy(() => import("@/pages/Users").then(m => ({ default: m.Users })));
const AuditLog = lazy(() => import("@/pages/AuditLog").then(m => ({ default: m.AuditLog })));
const Backup = lazy(() => import("@/pages/Backup").then(m => ({ default: m.Backup })));
import { useEffect, useState } from "react";
import { transliterateMalayalam } from "@/lib/malayalamTransliteration";
import { setCurrencySymbol } from "@/lib/utils";

function OfflineMalayalamLayer() {
  const { lang } = useI18n();
  useEffect(() => {
    if (lang !== "ml") return;
    const shouldTransliterate = (el: HTMLInputElement | HTMLTextAreaElement) => {
      const text = `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      return /(name|address|house|event|venue|description|family|member|head|father|mother|spouse|groom|bride|witness|place|remarks|reason|mahallu)/.test(text);
    };
    // Manglish → Malayalam on ENTER only. Converting on every keystroke
    // mangles partial words mid-typing ("nan", "mahall") and makes editing
    // impossible — the user types freely and presses Enter to convert.
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing) return;
      const el = event.target as HTMLInputElement | HTMLTextAreaElement;
      if (!el || !shouldTransliterate(el) || el.dataset.mlTransliterateBusy === "1") return;
      if (!/[a-z]/i.test(el.value) || /[\u0D00-\u0D7F]/.test(el.value)) return;
      const next = transliterateMalayalam(el.value);
      if (next === el.value) return;
      event.preventDefault();
      el.dataset.mlTransliterateBusy = "1";
      el.value = next;
      const caret = next.length;
      el.setSelectionRange(caret, caret);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      delete el.dataset.mlTransliterateBusy;
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [lang]);
  return null;
}

function ProtectedLayout() {
  const location = useLocation();
  useEffect(() => { document.body.classList.toggle("route-accounting", location.pathname === "/accounting"); return () => document.body.classList.remove("route-accounting"); }, [location.pathname]);
  return <div id="app" className="app-shell"><Topbar /><div className="app-body"><Sidebar /><div className="maincol"><div id="content"><Suspense fallback={<div className="flex items-center justify-center h-64"><div className="spinner-sm" /></div>}><Routes>
    <Route path="/" element={<Dashboard />} /><Route path="/families" element={<Families />} /><Route path="/members" element={<Members />} /><Route path="/staff" element={<Staff />} /><Route path="/committee" element={<Committee />} /><Route path="/subscriptions" element={<Subscriptions />} /><Route path="/donations" element={<Donations />} /><Route path="/whatsapp" element={<WhatsApp />} /><Route path="/accounting" element={<Accounting />} /><Route path="/assets" element={<Assets />} /><Route path="/marriages" element={<Marriages />} /><Route path="/deaths" element={<Deaths />} /><Route path="/welfare" element={<Welfare />} /><Route path="/certificates" element={<Certificates />} /><Route path="/tokens" element={<TokenEvents />} /><Route path="/tokens/manage" element={<TokensWithPrint />} /><Route path="/reports" element={<Reports />} /><Route path="/settings" element={<Settings />} /><Route path="/users" element={<Users />} /><Route path="/audit" element={<AuditLog />} /><Route path="/backup" element={<Backup />} />
  </Routes></Suspense></div></div></div></div>;
}

function LanguagePersistence() {
  const { lang } = useI18n();
  useEffect(() => { let cancelled = false; (async () => { try { const current = await window.mms.settings.load(); if (!cancelled && current) { setCurrencySymbol(current.currency_symbol); if (current.language !== lang) await window.mms.settings.save({ mahalluName: current.mahallu_name, address: current.address, phone: current.phone, email: current.email, financialYearStart: current.financial_year_start, currencySymbol: current.currency_symbol, theme: current.theme, language: lang, autoBackup: !!current.auto_backup, backupIntervalHours: current.backup_interval_hours, receiptPrefix: current.receipt_prefix }); } } catch (err) { console.warn("Could not persist active language:", err); } })(); return () => { cancelled = true; }; }, [lang]);
  return null;
}

export default function App() {
  const { apply } = useTheme(); const { user } = useAuth(); const [splashDone, setSplashDone] = useState(false);
  useEffect(() => { apply(); }, [apply]); useEffect(() => { if (splashDone) document.body.classList.add("app-loaded"); }, [splashDone]);
  /* Uninstaller mode (?uninstall=1): the NSIS gate launched us with
     --verify-uninstall — render ONLY the admin-password verify page.
     No splash, no login, nothing else boots. The body gets "app-loaded"
     directly because the splash never runs here (globals.css hides
     #root's children until then). */
  const isUninstallMode = new URLSearchParams(window.location.search).get("uninstall") === "1";
  useEffect(() => { if (isUninstallMode) document.body.classList.add("app-loaded"); }, [isUninstallMode]);
  if (isUninstallMode) {
    return <UninstallConfirm />;
  }
  /* The app mounts beneath the splash overlay so the splash can cross-fade
     into it — the transparent frameless window never shows the desktop. */
  return <><LanguagePersistence /><OfflineMalayalamLayer /><Routes><Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} /><Route path="/*" element={user ? <ProtectedLayout /> : <Navigate to="/login" />} /></Routes><ToastContainer /><UpdateBanner />{!splashDone && <Splash onDone={() => setSplashDone(true)} />}<CloseConfirmDialog /></>;
}
