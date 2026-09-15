/*
 * Electron main process — window creation + IPC handlers
 */
import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { login, changePassword, needsInitialSetup, createInitialAdministrator, verifyCurrentActorPassword } from "./services/auth.service.js";
import * as data from "./services/data.service.js";
import { todayIST } from "./services/data.service.js";
import { istDateTimeDm } from "./services/ist-date.js";
import { closeDB, getDB } from "./db/connection.js";
import { createBackup, verifyBackup, extractVerifiedBackup, listBackups, mirrorBackup } from "./services/backup.service.js";
import { buildTokenSheetHtml } from "./print/token.template.js";
import { buildCollectionSheetHtml } from "./print/collection-sheet.template.js";
import { buildCertificateHtml } from "./print/certificate.template.js";
import { getPreviewScreenCss } from "./print/utils.js";
import { renderHtmlToPdf } from "./print/pdf-renderer.js";
import { buildAccountStatementHtml } from "./print/account-statement.template.js";
import { buildAuditPackHtml } from "./print/audit-pack.template.js";
import { buildRegisterBookHtml } from "./print/register-book.template.js";
import { getAnekMalayalamCss } from "./print/utils.js";
import { registerSecurityIpc } from "./security-ipc.js";
import { registerWhatsAppIpc } from "./whatsapp-ipc.js";
import { registerReceiptIpc } from "./receipt-ipc.js";
import { verifyUninstallPassword, UNINSTALL_ADMIN_SQL } from "./services/uninstall-guard.js";
import { registerUpdateIpc, scheduleMonthlyUpdateCheck } from "./update-check.js";
// exceljs ships CommonJS only. Under the packaged ESM main process a named
// import ({ Workbook }) crashes at startup because Node's cjs-module-lexer
// cannot see through exceljs's bundled dist. Default-import and destructure
// instead (Node's recommended interop pattern); types stay intact via
// esModuleInterop.
import ExcelJS from "exceljs";
const { Workbook } = ExcelJS;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
const session = { user: null as null | { id: number; username: string; fullName: string; role: string } };

// ---------------------------------------------------------------------------
// Close confirmation: the window's close event is intercepted until the user
// answers an in-app "Close MMS?" dialog. Only a renderer "confirm" (or a
// programmatic before-quit) sets closeConfirmed, so Alt+F4, the custom ✕
// button and the taskbar "Close window" all show the same styled dialog.
// ---------------------------------------------------------------------------
let closeConfirmed = false;

// ---------------------------------------------------------------------------
// Uninstall verification mode. The Windows uninstaller (NSIS customUnInit in
// build/installer.nsh) runs the installed exe with --verify-uninstall BEFORE
// removing any file. The app then shows ONLY a small password window:
//   exit code 0 -> verified, uninstaller proceeds
//   exit code 1 -> declined (wrong password / cancel) -> uninstaller aborts
// A crashed/unlaunchable app fails open (any code other than 1 proceeds) so a
// broken install can always still be removed. Silent uninstalls (updates,
// reinstall-over) skip the gate in NSIS itself.
// ---------------------------------------------------------------------------
const isUninstallVerify = process.argv.includes("--verify-uninstall");

// ---------------------------------------------------------------------------
// Data folder: short "mms" directory inside the OS app-data area (hidden from
// casual browsing on Windows). Must run BEFORE anything touches
// app.getPath("userData") — DB, WhatsApp session, backups and settings all
// resolve through it. Existing test installs are migrated by folder rename,
// so their database, backups and WhatsApp pairing survive the change.
// ---------------------------------------------------------------------------
const DATA_DIR_NAME = "mms";
try {
  const base = app.getPath("appData");
  const desired = path.join(base, DATA_DIR_NAME);
  const legacyNames = ["Minz Mahallu Management System", "minz-mahallu-management"];
  for (const legacyName of legacyNames) {
    const legacy = path.join(base, legacyName);
    if (!fs.existsSync(desired) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, desired);
      console.log(`[paths] Migrated data folder: "${legacyName}" -> "${DATA_DIR_NAME}"`);
    }
  }
  app.setPath("userData", desired);
} catch (e: any) {
  console.warn("[paths] Could not set short data folder (staying on default):", e?.message || e);
}

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  try { dialog.showErrorBox("MMS — Unexpected Error", `The application encountered an error:\n\n${err.message}\n\nStack: ${err.stack || "(no stack)"}`); } catch {}
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  try { dialog.showErrorBox("MMS — Unexpected Error", `An async operation failed:\n\n${String(reason)}`); } catch {}
});

// Verified export writer used by all save-dialog exports: guarantees the file
// extension, writes, then stat-verifies the output so a silent Windows failure
// (antivirus quarantine, Controlled Folder Access, OneDrive sync) can never
// masquerade as success. Error results carry the OS error code for diagnosis.
type ExportWriteResult = { status: "cancelled" } | { status: "written"; path: string; size: number } | { status: "failed"; error: string };
async function saveExportFile(opts: { title: string; defaultName: string; ext: string; filterName: string }, produce: () => Promise<Buffer> | Buffer): Promise<ExportWriteResult> {
  try {
    const saveResult = await dialog.showSaveDialog(mainWindow!, { title: opts.title, defaultPath: opts.defaultName, filters: [{ name: opts.filterName, extensions: [opts.ext] }] });
    if (saveResult.canceled || !saveResult.filePath) return { status: "cancelled" };
    const filePath = /\.[A-Za-z0-9]+$/.test(saveResult.filePath) ? saveResult.filePath : `${saveResult.filePath}.${opts.ext}`;
    const buffer = await produce();
    fs.writeFileSync(filePath, buffer);
    const size = fs.statSync(filePath).size;
    if (!size) throw new Error("Output file is empty - the location may be blocked by antivirus or folder protection");
    return { status: "written", path: filePath, size };
  } catch (err: any) {
    return { status: "failed", error: (err?.code ? `${err.code}: ` : "") + String(err?.message ?? err) };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640, show: false,
    autoHideMenuBar: true, backgroundColor: "#00000000",
    title: "MMS — Minz Mahallu Management System", transparent: true, frame: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "preload.mjs"), contextIsolation: true, nodeIntegration: false, sandbox: false, zoomFactor: 1.0 },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Surface silent download failures (Reports page CSV/Excel/PDF blob downloads
  // go through Chromium's download pipeline). Success needs no extra handling;
  // a failed/interrupted download is reported so the UI can warn the user.
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    item.once("done", (_it, state) => {
      if (state !== "completed") {
        try { mainWindow?.webContents.send("download:failed", item.getFilename()); } catch {}
      }
    });
  });
  // Close gate: ask the renderer to confirm before the window goes away.
  mainWindow.on("close", (e) => {
    if (closeConfirmed || !mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isCrashed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return; // crashed renderer: let it close
    e.preventDefault();
    try { mainWindow.webContents.send("win:ask-close-confirm"); } catch {}
  });
  if (process.env.NODE_ENV === "development" || process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

// Window-control IPC. Registered ONCE here (not inside createWindow) so a
// second createWindow() call — the macOS "activate" re-open path — cannot
// crash with "Attempted to register a second handler".
ipcMain.handle("win:minimize", () => mainWindow?.minimize());
ipcMain.handle("win:maximize", () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
ipcMain.handle("win:close", () => mainWindow?.close());
// Called by the close-confirm dialog after the user picks "Close app".
ipcMain.handle("win:confirm-close", () => { closeConfirmed = true; try { mainWindow?.close(); } catch {} });

// Small frameless window for the uninstaller's admin-password gate.
// Sits top-most so it is visible above the uninstaller wizard.
function createUninstallVerifyWindow() {
  const win = new BrowserWindow({
    width: 470, height: 540, show: false, resizable: false, minimizable: false,
    maximizable: false, fullscreenable: false, autoHideMenuBar: true, frame: false,
    backgroundColor: "#0d9488", title: "MMS — Uninstall protection", hasShadow: true,
    webPreferences: { preload: path.join(__dirname, "preload.mjs"), contextIsolation: true, nodeIntegration: false, sandbox: false, zoomFactor: 1.0 },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.once("ready-to-show", () => { win.show(); win.focus(); });
  // The ?uninstall=1 query makes App.tsx render ONLY the UninstallConfirm page.
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query: { uninstall: "1" } });
  win.on("closed", () => { /* window-all-closed decides the exit code */ });
  return win;
}
// esc() lives in ./print/utils.js; renderHtmlToPdf() in ./print/pdf-renderer.js
// (the duplicates that used to sit here were removed in the dead-code purge).

app.whenReady().then(() => {
  // ===== Uninstall verification mode (launched by the NSIS uninstaller) =====
  // Only the tiny verify window + its IPC run. No main window, no WhatsApp
  // engine, no auto-backup timer, and — crucially — no DB creation: an
  // install that was never run has no database, and the gate must not seed
  // one just to ask for its password.
  if (isUninstallVerify) {
    const exitWith = (code: number) => { try { closeDB(); } catch {} app.exit(code); };
    ipcMain.handle("uninstall:dbStatus", () => {
      try { return { hasDb: fs.existsSync(path.join(app.getPath("userData"), "mms.db")) }; }
      catch { return { hasDb: false }; }
    });
    ipcMain.handle("uninstall:verify", (_e, password: string) => {
      try {
        const dbFile = path.join(app.getPath("userData"), "mms.db");
        if (!fs.existsSync(dbFile)) return { ok: false, reason: "no-database" };
        const rows = getDB().prepare(UNINSTALL_ADMIN_SQL).all() as Array<{ id: number; username: string; password_hash: string }>;
        return verifyUninstallPassword(rows, String(password ?? ""));
      } catch (err: any) {
        console.warn("[uninstall-verify] failed:", err?.message || err);
        return { ok: false, reason: "wrong-password" };
      }
    });
    ipcMain.handle("uninstall:finish", (_e, verified: boolean) => exitWith(verified ? 0 : 1));
    createUninstallVerifyWindow();
    return;
  }

  // Normal boot: bilingual "do not delete" note inside the data folder, so
  // nobody tidies AppData and wipes the mahallu database + backups.
  try {
    const notePath = path.join(app.getPath("userData"), "KEEP-THIS-FOLDER.txt");
    if (!fs.existsSync(notePath)) {
      fs.writeFileSync(notePath, [
        "MMS — Minz Mahallu Management System",
        "======================================",
        "",
        "This folder holds the mahallu's database (mms.db) and .mmbak backups.",
        "",
        "DO NOT DELETE this folder.",
        "Deleting it erases every family, member, subscription and payment record.",
        "",
        "To keep an extra copy on a USB drive or in the cloud:",
        "Settings -> Backup -> Backup mirror folder.",
        "",
        "— — — മലയാളം — — —",
        "ഈ ഫോൾഡറിൽ മഹല്ലുവിന്റെ ഡാറ്റാബേസും (mms.db) ബാക്കപ്പ് ഫയലുകളും സൂക്ഷിച്ചിട്ടുണ്ട്.",
        "ദയവായി ഈ ഫോൾഡർ ഇല്ലാതാക്കരുത് — ഇത് നഷ്ടപ്പെട്ടാൽ എല്ലാ രേഖകളും നഷ്ടപ്പെടും.",
        "അധിക പകർപ്പിനായി: Settings -> Backup -> Backup mirror folder.",
        "",
      ].join("\n"), "utf8");
    }
  } catch {}

  try { data.subscriptions.ensureCurrentMonth(); } catch (err) { console.warn("[subscriptions] monthly generation deferred:", err); }
  // Monthly GitHub release check (Settings → About can also check on demand).
  registerUpdateIpc(() => mainWindow);
  scheduleMonthlyUpdateCheck(() => mainWindow);
  ipcMain.handle("auth:login", (_e, username: string, password: string) => { try { const user = login(username, password); session.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role }; try { data.audit.log(user.id, user.username, "LOGIN", "auth", user.id, "User logged in", ""); } catch {} return { success: true, user }; } catch (err: any) { return { success: false, error: err.message }; } });
  ipcMain.handle("auth:logout", () => { if (session.user) { try { data.audit.log(session.user.id, session.user.username, "LOGOUT", "auth", session.user.id, "User logged out", ""); } catch {} } session.user = null; return { success: true }; });
  ipcMain.handle("auth:currentUser", () => session.user);
  ipcMain.handle("auth:setupStatus", () => ({ required: needsInitialSetup() }));
  ipcMain.handle("auth:createInitialAdministrator", (_e, username: string, fullName: string, password: string) => { try { const user = createInitialAdministrator(username, fullName, password); session.user = { id:user.id, username:user.username, fullName:user.fullName, role:user.role }; return { success:true, user }; } catch (err:any) { return { success:false, error:err.message }; } });
  ipcMain.handle("auth:changePassword", (_e, userId: number, newPassword: string) => { try { changePassword(userId, newPassword); return { success: true }; } catch (err: any) { return { success: false, error: err.message }; } });

  ipcMain.handle("families:list", (_e, filter) => data.families.list(filter || {}));
  ipcMain.handle("families:get", (_e, id) => data.families.get(id));
  ipcMain.handle("families:create", (_e, d) => data.families.create(d));
  ipcMain.handle("families:update", (_e, id, d) => data.families.update(id, d));
  ipcMain.handle("families:remove", (_e, id) => data.families.remove(id));
  ipcMain.handle("members:list", (_e, filter) => data.members.list(filter || {}));
  ipcMain.handle("members:get", (_e, id) => data.members.get(id));
  ipcMain.handle("members:create", (_e, d) => data.members.create(d));
  ipcMain.handle("members:update", (_e, id, d) => data.members.update(id, d));
  ipcMain.handle("members:remove", (_e, id) => data.members.remove(id));
  ipcMain.handle("members:relationships", () => data.members.relationships());
  ipcMain.handle("subscriptions:list", (_e, filter) => data.subscriptions.list(filter || {}));
  ipcMain.handle("subscriptions:get", (_e, id) => data.subscriptions.get(id));
  ipcMain.handle("subscriptions:remove", (_e, id) => data.subscriptions.remove(id));
  // NOTE: subscriptions:update / subscriptions:create are re-registered with
  // the security layer (auth + audit + the A6 receipt/WhatsApp hook) in
  // security-ipc.ts, which runs after this and wins. The registrations below
  // are the fail-closed fallbacks if the security layer is ever disabled —
  // they record payments but do not attempt messaging.
  ipcMain.handle("subscriptions:update", (_e, id, d) => data.subscriptions.update(id, d));
  ipcMain.handle("subscriptions:create", (_e, d) => data.subscriptions.create(d));
  ipcMain.handle("subscriptions:markOverdue", () => data.subscriptions.markOverdue());
  // Fail-closed fallback for the factory reset — the security layer's
  // registration (with admin re-auth) wins when it is active.
  ipcMain.handle("system:clearAllData", (_e, reason: string, adminPassword: string) => {
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    return data.clearAllData(String(reason ?? ""));
  });
  ipcMain.handle("subscriptions:totalCollected", () => data.subscriptions.totalCollected());
  ipcMain.handle("subscriptions:totalPending", () => data.subscriptions.totalPending());
  ipcMain.handle("subscriptions:plans", () => data.subscriptions.plans());
  ipcMain.handle("subscriptions:ensureCurrentMonth", () => data.subscriptions.ensureCurrentMonth());
  ipcMain.handle("donations:list", (_e, filter) => data.donations.list(filter || {}));
  ipcMain.handle("donations:get", (_e, id) => data.donations.get(id));
  ipcMain.handle("donations:create", (_e, d) => data.donations.create(d));
  ipcMain.handle("donations:update", (_e, id, d) => data.donations.update(id, d));
  ipcMain.handle("donations:remove", (_e, id) => data.donations.remove(id));
  ipcMain.handle("donations:categories", () => data.donations.categories());
  ipcMain.handle("donations:categoriesAll", () => data.donations.categoriesAll());
  ipcMain.handle("donations:createCategory", (_e, name, description) => data.donations.createCategory(name, description));
  ipcMain.handle("donations:updateCategory", (_e, id, name, description) => data.donations.updateCategory(id, name, description));
  ipcMain.handle("donations:setCategoryActive", (_e, id, active) => data.donations.setCategoryActive(id, active));
  ipcMain.handle("donations:removeCategory", (_e, id) => data.donations.removeCategory(id));
  ipcMain.handle("donations:memberBalance", (_e, familyId, memberId) => data.donations.memberBalance(familyId, memberId));
  ipcMain.handle("donations:totalThisMonth", () => data.donations.totalThisMonth());
  ipcMain.handle("accounting:list", (_e, filter) => data.accounting.list(filter || {}));
  ipcMain.handle("accounting:get", (_e, id) => data.accounting.get(id));
  ipcMain.handle("accounting:create", (_e, d) => data.accounting.create(d));
  ipcMain.handle("accounting:update", (_e, id, d) => data.accounting.update(id, d));
  ipcMain.handle("accounting:remove", (_e, id) => data.accounting.remove(id));
  ipcMain.handle("accounting:totalIncome", () => data.accounting.totalIncome());
  ipcMain.handle("accounting:totalExpense", () => data.accounting.totalExpense());
  ipcMain.handle("accounting:balance", () => data.accounting.balance());

  // ---- Asset register (V036) — buildings, lands, rentable goods ----
  ipcMain.handle("assets:list", (_e, filter) => data.assets.list(filter || {}));
  ipcMain.handle("assets:get", (_e, id) => data.assets.get(id));
  ipcMain.handle("assets:create", (_e, d) => data.assets.create(d));
  ipcMain.handle("assets:update", (_e, id, d) => data.assets.update(id, d));
  ipcMain.handle("assets:remove", (_e, id) => data.assets.remove(id));
  ipcMain.handle("assets:options", () => data.assets.options());
  ipcMain.handle("assets:summary", () => data.assets.summary());
  ipcMain.handle("assets:statement", (_e, id) => data.assets.statement(id));

  ipcMain.handle("marriages:list", (_e, filter) => data.marriages.list(filter || {}));
  ipcMain.handle("marriages:get", (_e, id) => data.marriages.get(id));
  ipcMain.handle("marriages:create", (_e, d) => data.marriages.create(d));
  ipcMain.handle("marriages:update", (_e, id, d) => data.marriages.update(id, d));
  ipcMain.handle("marriages:remove", () => { throw new Error("Permanent deletion of marriage records is disabled"); });
  ipcMain.handle("deaths:list", (_e, filter) => data.deaths.list(filter || {}));
  ipcMain.handle("deaths:get", (_e, id) => data.deaths.get(id));
  ipcMain.handle("deaths:create", (_e, d) => data.deaths.create(d));
  ipcMain.handle("deaths:update", (_e, id, d) => data.deaths.update(id, d));
  ipcMain.handle("deaths:remove", () => { throw new Error("Permanent deletion of death records is disabled"); });
  ipcMain.handle("welfare:list", (_e, filter) => data.welfare.list(filter || {}));
  ipcMain.handle("welfare:get", (_e, id) => data.welfare.get(id));
  ipcMain.handle("welfare:create", (_e, d) => data.welfare.create(d));
  ipcMain.handle("welfare:update", (_e, id, d) => data.welfare.update(id, d));
  ipcMain.handle("welfare:approve", (_e, id, amount, remarks) => data.welfare.approve(id, amount, remarks, session.user?.id ?? 1));
  ipcMain.handle("welfare:reject", (_e, id, reason) => data.welfare.reject(id, reason, session.user?.id ?? 1));
  ipcMain.handle("welfare:disburse", (_e, id) => data.welfare.disburse(id, session.user?.id ?? 1));
  ipcMain.handle("welfare:remove", (_e, id) => data.welfare.remove(id));
  ipcMain.handle("welfare:categories", () => data.welfare.categories());
  ipcMain.handle("certificates:list", (_e, filter) => data.certificates.list(filter || {}));
  ipcMain.handle("certificates:issueMembership", (_e, code) => data.certificates.issueMembership(code, session.user?.id ?? 1));
  ipcMain.handle("certificates:issueResidence", (_e, familyNum, issuedTo) => data.certificates.issueResidence(familyNum, issuedTo, session.user?.id ?? 1));
  ipcMain.handle("certificates:issueMarriage", (_e, marriageNum) => data.certificates.issueMarriage(marriageNum, session.user?.id ?? 1));
  ipcMain.handle("certificates:issueMarriageNoc", (_e, marriageNum) => data.certificates.issueMarriageNoc(marriageNum, session.user?.id ?? 1));
  ipcMain.handle("certificates:issueDeath", (_e, deathNum) => data.certificates.issueDeath(deathNum, session.user?.id ?? 1));
  ipcMain.handle("certificates:remove", () => { throw new Error("Permanent deletion of certificate records is disabled"); });

  ipcMain.handle("pdf:generate", async (_e, html: string, defaultName: string) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try { const saveResult = await dialog.showSaveDialog(mainWindow!, { title: "Save PDF", defaultPath: defaultName || "document.pdf", filters: [{ name: "PDF Document", extensions: ["pdf"] }] }); if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }; const pdfBuffer = await renderHtmlToPdf(html); fs.writeFileSync(saveResult.filePath, pdfBuffer); return { success: true, path: saveResult.filePath }; } catch (err: any) { return { success: false, error: err.message }; } });
  // Returns the full Anek Malayalam Variable font CSS with all url(...) refs
  // replaced by base64 data URIs. Used by the renderer's TokensWithPrint page
  // to embed the font in client-built HTML so Malayalam glyphs render in the
  // printToPDF BrowserWindow (which doesn't have @fontsource bundled).
  /** Certificates issued before the anti-forgery feature have no security
   *  code yet — it is minted here (lazily, once) so EVERY print carries the
   *  code, and issued codes never change afterwards. */
  function ensureCertCode(cert: any): void {
    data.certificates.ensureVerificationCode(cert);
  }

  ipcMain.handle("pdf:getAnekFontCss", () => {
    if (!session.user) throw new Error("Authentication required");
    return getAnekMalayalamCss();
  });
  ipcMain.handle("certificates:generatePdf", async (_e, certId: number) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const listResult = data.certificates.list({});
      const cert = (listResult?.rows || []).find((c: any) => c.id === certId);
      if (!cert) return { success: false, error: "Certificate not found" };
      const lang = await mainWindow!.webContents.executeJavaScript("document.documentElement.classList.contains('lang-ml') ? 'ml' : 'en'");
      // Anti-forgery: the NEXT print is a reprint, so it carries a bottom-left
      // "Reprinted on <date time>" note even before the count is persisted
      // (the count only increments if the PDF is actually saved).
      const expectedReprint = (cert.reprint_count || 0) + 1;
      ensureCertCode(cert);
      const html = buildCertificateHtml(cert, lang, expectedReprint, istDateTimeDm(new Date()));
      const saveResult = await dialog.showSaveDialog(mainWindow!, { title: "Save Certificate PDF", defaultPath: `certificate-${cert.certificate_number || certId}.pdf`, filters: [{ name: "PDF Document", extensions: ["pdf"] }] });
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true };
      const pdfBuffer = await renderHtmlToPdf(html);
      fs.writeFileSync(saveResult.filePath, pdfBuffer);
      try { data.certificates.markReprint(certId); } catch (e) { console.warn("[certificates] reprint count not updated:", e); }
      return { success: true, path: saveResult.filePath, reprint: expectedReprint > 1 };
    } catch (err: any) { return { success: false, error: err.message }; }
  });
  // Returns the certificate HTML so the renderer can show a print preview in an iframe.
  ipcMain.handle("certificates:previewHtml", async (_e, certId: number) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const listResult = data.certificates.list({});
      const cert = (listResult?.rows || []).find((c: any) => c.id === certId);
      if (!cert) return { success: false, error: "Certificate not found" };
      const lang = await mainWindow!.webContents.executeJavaScript("document.documentElement.classList.contains('lang-ml') ? 'ml' : 'en'");
      // On-screen preview styles come from the separate stylesheet
      // (resources/templates/preview-screen.css) — no inline <style> in the UI.
      ensureCertCode(cert);
      const html = buildCertificateHtml(cert, lang, 0, undefined, getPreviewScreenCss());
      return { success: true, html };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ===== Accounting export: PDF + Excel =====
  ipcMain.handle("accounting:exportPdf", async (_e, filter: any) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      // Fetch all rows (no pagination) + summary for the given filter.
      const allFilter = { ...filter, page: undefined, pageSize: undefined };
      const [listRes, summary] = await Promise.all([
        data.accounting.unifiedList(allFilter),
        data.accounting.unifiedSummary(allFilter)
      ]);
      const html = buildAccountStatementHtml(listRes.rows || [], summary, allFilter);
      const periodLabel = filter?.period || "all";
      const defaultName = `account-statement-${periodLabel}-${todayIST()}.pdf`;
      const written = await saveExportFile({ title: "Save Account Statement PDF", defaultName, ext: "pdf", filterName: "PDF Document" }, async () => await renderHtmlToPdf(html));
      if (written.status === "cancelled") return { success: false, cancelled: true };
      if (written.status === "failed") return { success: false, error: written.error };
      return { success: true, path: written.path, size: written.size, count: listRes.rows?.length || 0 };
    } catch (err: any) { return { success: false, error: (err?.code ? `${err.code}: ` : "") + err.message }; }
  });

  ipcMain.handle("accounting:exportExcel", async (_e, filter: any) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const allFilter = { ...filter, page: undefined, pageSize: undefined };
      const [listRes, summary] = await Promise.all([
        data.accounting.unifiedList(allFilter),
        data.accounting.unifiedSummary(allFilter)
      ]);
      const rows = listRes.rows || [];
      const periodLabel = filter?.period || "all";

      // Sheet 1: Ledger entries
      const ledgerData = rows.map((r: any) => ({
        "Date": r.ledger_date || "",
        "Source": r.source || "",
        "Type": r.type || "",
        "Description": r.description || "",
        "Category": r.category || "",
        "Receipt No": r.receipt_number || "",
        "Voucher No": r.voucher_no || "",
        "Bill No": r.bill_no || "",
        "Payee": r.payee || "",
        "Payment Method": r.payment_method || "",
        "Transaction Ref": r.transaction_ref || "",
        "Status": r.status === "Void" ? "VOID" : (r.status || "Posted"),
        "Void Reason": r.void_reason || "",
        "Amount": Number(r.amount || 0),
      }));

      // Sheet 2: Summary
      const summaryData = [
        { "Metric": "Total Income", "Value": summary.totalIncome },
        { "Metric": "Total Expense", "Value": summary.totalExpense },
        { "Metric": "Balance", "Value": summary.balance },
        { "Metric": "Entry Count", "Value": summary.entryCount },
        { "Metric": "", "Value": "" },
        { "Metric": "Income — Donations", "Value": summary.incomeDonations },
        { "Metric": "Income — Subscriptions", "Value": summary.incomeSubscriptions },
        { "Metric": "Income — Manual", "Value": summary.incomeManual },
        { "Metric": "", "Value": "" },
        { "Metric": "Expense — Welfare", "Value": summary.expenseWelfare },
        { "Metric": "Expense — Salary", "Value": summary.expenseSalary },
        { "Metric": "Expense — Manual", "Value": summary.expenseManual },
      ];

      const wb = new Workbook();
      const LEDGER_HEADERS = ["Date", "Source", "Type", "Description", "Category", "Receipt No", "Voucher No", "Bill No", "Payee", "Payment Method", "Transaction Ref", "Status", "Void Reason", "Amount"];
      // Column widths sized from the actual content so no value is truncated.
      const fitWidth = (data: any[], k: string) => {
        let max = String(k ?? "").length;
        for (let i = 0; i < data.length && i < 400; i++) {
          const len = String(data[i]?.[k] ?? "").length;
          if (len > max) max = len;
        }
        return Math.min(60, Math.max(11, Math.ceil(max * 1.15) + 3));
      };

      const ws1 = wb.addWorksheet("Ledger");
      ws1.columns = LEDGER_HEADERS.map((h) => ({ header: h, key: h, width: fitWidth(ledgerData, h) }));
      ws1.addRows(ledgerData);
      ws1.getRow(1).font = { bold: true };
      ws1.views = [{ state: "frozen", ySplit: 1 }];

      const ws2 = wb.addWorksheet("Summary");
      ws2.columns = ["Metric", "Value"].map((h) => ({ header: h, key: h, width: fitWidth(summaryData, h) }));
      ws2.addRows(summaryData);
      ws2.getRow(1).font = { bold: true };
      ws2.views = [{ state: "frozen", ySplit: 1 }];

      const defaultName = `account-statement-${periodLabel}-${todayIST()}.xlsx`;
      const written = await saveExportFile({ title: "Save Account Statement Excel", defaultName, ext: "xlsx", filterName: "Excel Spreadsheet" }, async () => Buffer.from(await wb.xlsx.writeBuffer()));
      if (written.status === "cancelled") return { success: false, cancelled: true };
      if (written.status === "failed") return { success: false, error: written.error };
      return { success: true, path: written.path, size: written.size, count: rows.length };
    } catch (err: any) { return { success: false, error: (err?.code ? `${err.code}: ` : "") + err.message }; }
  });

  // ===== Annual audit pack (Waqf Board / society auditor format) =====
  ipcMain.handle("accounting:exportAuditPack", async (_e, fyYear: number) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const pack = data.accounting.auditPack(fyYear);
      const lang = await mainWindow!.webContents.executeJavaScript("document.documentElement.classList.contains('lang-ml') ? 'ml' : 'en'");
      const html = buildAuditPackHtml(pack, lang, String((data.settings.load() as any)?.currency_symbol || "₹"));
      const defaultName = `audit-pack-${fyYear}-${(fyYear + 1).toString().slice(2)}.pdf`;
      const written = await saveExportFile({ title: "Save Annual Audit Pack", defaultName, ext: "pdf", filterName: "PDF Document" }, async () => await renderHtmlToPdf(html));
      if (written.status === "cancelled") return { success: false, cancelled: true };
      if (written.status === "failed") return { success: false, error: written.error };
      return { success: true, path: written.path, size: written.size, receipts: pack.totalReceipts, payments: pack.totalPayments, count: pack.transactions.length };
    } catch (err: any) { return { success: false, error: (err?.code ? `${err.code}: ` : "") + err.message }; }
  });

  // ===== Register-book printing (marriage / death) =====
  const printRegisterPdf = async (type: "marriage" | "death", _e: Electron.IpcMainInvokeEvent) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const settings = data.settings.load();
      const lang = await mainWindow!.webContents.executeJavaScript("document.documentElement.classList.contains('lang-ml') ? 'ml' : 'en'");
      const regData = {
        type,
        mahalluName: settings?.mahallu_name || "Minz Mahallu",
        generatedAt: new Date().toISOString(),
        rows: type === "marriage" ? data.marriages.registerRows() : data.deaths.registerRows(),
      };
      const html = buildRegisterBookHtml(regData, lang);
      const defaultName = type === "marriage" ? "marriage-register.pdf" : "death-register.pdf";
      const saveResult = await dialog.showSaveDialog(mainWindow!, { title: "Save Register PDF", defaultPath: defaultName, filters: [{ name: "PDF Document", extensions: ["pdf"] }] });
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true };
      const pdfBuffer = await renderHtmlToPdf(html);
      fs.writeFileSync(saveResult.filePath, pdfBuffer);
      return { success: true, path: saveResult.filePath, count: regData.rows.length };
    } catch (err: any) { return { success: false, error: err.message }; }
  };
  ipcMain.handle("marriages:registerPdf", (e) => printRegisterPdf("marriage", e));
  ipcMain.handle("deaths:registerPdf", (e) => printRegisterPdf("death", e));

  ipcMain.handle("users:list", () => data.users.list());
  ipcMain.handle("users:create", (_e, d) => data.users.create(d, session.user?.role ?? ""));
  ipcMain.handle("users:update", (_e, id, d) => data.users.update(id, d));
  ipcMain.handle("users:toggleLock", (_e, id, locked) => data.users.toggleLock(id, locked));
  ipcMain.handle("users:resetPassword", (_e, id, newPwd) => data.users.resetPassword(id, newPwd));
  ipcMain.handle("users:remove", (_e, id) => data.users.remove(id));
  ipcMain.handle("audit:list", (_e, filter) => data.audit.list(filter || {}));
  ipcMain.handle("settings:load", () => data.settings.load());
  ipcMain.handle("settings:save", (_e, d) => data.settings.save(d));
  // Read-only app information for the Settings → About card (version, data
  // folder). No sensitive values — helps the office quote the exact build
  // when reporting an issue.
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron || "",
    platform: process.platform,
    dataDir: app.getPath("userData"),
  }));
  ipcMain.handle("dashboard:summary", () => data.dashboard.summary());
  ipcMain.handle("dashboard:incomeThisMonth", () => data.dashboard.incomeThisMonth());
  ipcMain.handle("dashboard:expenseThisMonth", () => data.dashboard.expenseThisMonth());
  ipcMain.handle("dashboard:balance", () => data.dashboard.balance());
  ipcMain.handle("dashboard:monthlyCollections", (_e, months) => data.dashboard.monthlyCollections(months || 6));
  ipcMain.handle("dashboard:monthlyDonations", (_e, months) => data.dashboard.monthlyDonations(months || 6));
  ipcMain.handle("dashboard:incomeVsExpense", (_e, months) => data.dashboard.incomeVsExpense(months || 6));
  ipcMain.handle("dashboard:recentActivity", (_e, limit) => data.dashboard.recentActivity(limit || 10));
  // Today-at-a-glance + real backup status (auto-backup schedule + last backup file).
  ipcMain.handle("dashboard:todayAtGlance", () => {
    // Defence-in-depth: this read surfaces the fund balance, so it requires a
    // session like every other dashboard read in security-ipc.ts (this raw
    // registration predates that layer and was missed — audit finding A5).
    if (!session.user) throw new Error("Authentication required");
    const glance = data.dashboard.todayAtGlance();
    let backupEnabled = false;
    let nextBackup: string | null = null;
    let lastBackup: string | null = null;
    try {
      const settings = data.settings.load();
      backupEnabled = !!settings?.auto_backup;
      lastBackup = listBackups(app.getPath("userData"))[0]?.time ?? null;
      if (backupEnabled) {
        const intervalHours = Number(settings.backup_interval_hours || 24);
        if (intervalHours > 0) {
          const last = lastBackup ? new Date(lastBackup).getTime() : 0;
          nextBackup = new Date(last + intervalHours * 3600 * 1000).toISOString();
        }
      }
    } catch (e) { console.warn("[dashboard:todayAtGlance] backup info failed:", e); }
    return { ...glance, backupEnabled, nextBackup, lastBackup };
  });

  ipcMain.handle("backup:create", async () => {
    if (!session.user) return { success: false, error: "Authentication required" };
    // A backup is a full copy of the mahallu database (all money records);
    // only administrators may export it (audit finding A6).
    if (session.user.role !== "Administrator") return { success: false, error: "Administrator permission is required" };
    try {
      const defaultName = `mms-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mmbak`;
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: "Save Backup",
        defaultPath: defaultName,
        filters: [{ name: "MMS Verified Backup", extensions: ["mmbak"] }],
      });
      if (result.canceled || !result.filePath) return { success: false, error: "cancelled" };
      const meta = await createBackup(result.filePath);
      // Mirror to the configured second location (best-effort — a missing USB
      // drive or unreachable folder must never fail the backup itself).
      try {
        const s: any = data.settings.load();
        const mirrorDir = String(s?.backup_mirror_dir || "").trim();
        if (mirrorDir) {
          const r = mirrorBackup(result.filePath, mirrorDir);
          if (r.ok) console.log(`[backup] Mirrored to: ${r.path}`);
          else console.warn("[backup] Mirror failed:", r.error);
        }
      } catch (mirrorErr: any) { console.warn("[backup] Mirror failed:", mirrorErr?.message || mirrorErr); }
      return { success: true, path: result.filePath, size: meta.size, sha256: meta.sha256 };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle("backup:chooseMirrorDir", async () => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: "Choose Backup Mirror Folder",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, cancelled: true };
      return { success: true, path: result.filePaths[0] };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle("backup:list", () => {
    if (!session.user) return { backups: [] };
    try {
      const userData = app.getPath("userData");
      const backups = listBackups(userData);
      return { backups };
    } catch (e: any) {
      return { backups: [] };
    }
  });
  ipcMain.handle("backup:verify", (_e, backupPath: string) => {
    if (!session.user) throw new Error("Authentication required");
    try {
      if (!backupPath || !fs.existsSync(backupPath)) throw new Error("Backup file not found");
      const result = verifyBackup(backupPath);
      return { success: true, ...result };
    } catch (err: any) {
      throw new Error(err.message);
    }
  });
  ipcMain.handle("backup:restore", async (_e, backupPath: string) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    // Restoring REPLACES the live database (rolling back every financial
    // record) — administrator-only (audit finding A6).
    if (session.user.role !== "Administrator") return { success: false, error: "Administrator permission is required" };
    try {
      if (!backupPath || !fs.existsSync(backupPath)) return { success: false, error: "Backup file not found" };
      // 1. Verify the target backup integrity before doing anything destructive.
      verifyBackup(backupPath);
      // 2. Make a safety pre-restore backup of the current live DB.
      const userData = app.getPath("userData");
      const safetyPath = path.join(userData, `backup-pre-restore-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.mmbak`);
      try { await createBackup(safetyPath); } catch (e) { console.warn("[backup] Pre-restore safety backup failed:", e); }
      // 3. Close the live DB connection so the file can be safely replaced.
      try { closeDB(); } catch {}
      // 4. Extract the verified backup into the live DB path.
      const liveDbPath = path.join(userData, "mms.db");
      extractVerifiedBackup(backupPath, liveDbPath);
      // 5. Relaunch the app so the new DB is loaded cleanly.
      setTimeout(() => { app.relaunch(); app.exit(0); }, 250);
      return { success: true, restarted: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle("dialog:showSave", async (_e, defaultName: string, filters: any[]) => {
    if (!session.user) return { success: false, cancelled: true, error: "Authentication required" };
    const result = await dialog.showSaveDialog(mainWindow!, { title: "Save", defaultPath: defaultName, filters: filters || [] });
    if (result.canceled || !result.filePath) return { success: false, cancelled: true };
    return { success: true, path: result.filePath };
  });
  ipcMain.handle("tokens:listEvents", () => data.tokens.listEvents());
  ipcMain.handle("tokens:getEvent", (_e, id) => data.tokens.getEvent(id));
  ipcMain.handle("tokens:createEvent", (_e, d) => data.tokens.createEvent(d));
  ipcMain.handle("tokens:updateEvent", (_e, id, d) => data.tokens.updateEvent(id, d));
  ipcMain.handle("tokens:removeEvent", () => { throw new Error("Token events can only be deleted through the secured IPC layer"); });
  // Fail-closed fallback: registerSecurityIpc() runs AFTER this registration
  // and re-registers the channel with the real date-guarded flow
  // (Administrator + reason + data.tokens.removeEvent, backed by the DB
  // triggers in token-guard.ts). If the security layer were ever disabled,
  // this handler refuses instead of performing an unguarded hard delete.
  ipcMain.handle("tokens:list", (_e, filter) => data.tokens.list(filter || {}));
  ipcMain.handle("tokens:checkExisting", (_e, eventId) => Array.from(data.tokens.checkExisting(eventId)));
  ipcMain.handle("tokens:generate", (_e, eventId, familyIds) => data.tokens.generate(eventId, familyIds, session.user?.id ?? 1));
  ipcMain.handle("tokens:collect", (_e, tokenId) => data.tokens.collect(tokenId, session.user?.id ?? 1));
  ipcMain.handle("tokens:cancel", (_e, tokenId, reason) => data.tokens.cancel(tokenId, reason));
  ipcMain.handle("tokens:replace", (_e, tokenId, reason) => data.tokens.replace(tokenId, reason, session.user?.id ?? 1));
  ipcMain.handle("tokens:stats", (_e, eventId) => data.tokens.stats(eventId));
  // tokens:listForPdf — returns the raw token rows (no PDF rendering). Used by
  // TokensWithPrint.tsx to build the HTML client-side and pipe it through
  // pdf:generate, which lets the renderer pick color/B&W mode and apply i18n.
  ipcMain.handle("tokens:listForPdf", (_e, eventId: number) => {
    if (!session.user) throw new Error("Authentication required");
    return data.tokens.listForPdf(eventId);
  });
  // tokens:generateTokenPdf — full server-side render + save dialog. Used by
  // Tokens.tsx when the user clicks "Token PDF" from the success/list views.
  // (Was previously registered as "tokens:generatePdf" — singular — which
  // mismatched the preload's "tokens:generateTokenPdf" invoke and produced
  // "No handlers registered" errors in the renderer.)
  ipcMain.handle("tokens:generateTokenPdf", async (_e, eventId: number) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try { const tokenList = data.tokens.listForPdf(eventId); if (!tokenList || tokenList.length === 0) return { success: false, error: "No tokens found for this event" }; const event = data.tokens.getEvent(eventId); const html = buildTokenSheetHtml(tokenList, event); const saveResult = await dialog.showSaveDialog(mainWindow!, { title: "Save Token Sheet PDF", defaultPath: `tokens-${event?.event_name?.replace(/\s+/g, "-") || eventId}.pdf`, filters: [{ name: "PDF Document", extensions: ["pdf"] }] }); if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }; const pdfBuffer = await renderHtmlToPdf(html); fs.writeFileSync(saveResult.filePath, pdfBuffer); return { success: true, path: saveResult.filePath, count: tokenList.length }; } catch (err: any) { return { success: false, error: err.message }; } });
  ipcMain.handle("tokens:generateCollectionSheet", async (_e, eventId: number) => {
    if (!session.user) return { success: false, error: "Authentication required" };
    try { const tokenList = data.tokens.listForPdf(eventId); if (!tokenList || tokenList.length === 0) return { success: false, error: "No tokens found for this event" }; const event = data.tokens.getEvent(eventId); const html = buildCollectionSheetHtml(tokenList, event); const saveResult = await dialog.showSaveDialog(mainWindow!, { title: "Save Collection Sheet PDF", defaultPath: `collection-sheet-${event?.event_name?.replace(/\s+/g, "-") || eventId}.pdf`, filters: [{ name: "PDF Document", extensions: ["pdf"] }] }); if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }; const pdfBuffer = await renderHtmlToPdf(html); fs.writeFileSync(saveResult.filePath, pdfBuffer); return { success: true, path: saveResult.filePath, count: tokenList.length }; } catch (err: any) { return { success: false, error: err.message }; } });

  registerSecurityIpc(() => session.user ? { id: session.user.id, username: session.user.username, role: session.user.role } : null);
  registerWhatsAppIpc(() => session.user ? { id: session.user.id, username: session.user.username, role: session.user.role } : null);
  registerReceiptIpc(() => session.user ? { id: session.user.id, username: session.user.username, role: session.user.role } : null, () => mainWindow);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  // ===== Auto-backup timer =====
  // Checks settings.auto_backup every 10 minutes. If enabled and the last
  // backup is older than backup_interval_hours, creates a .mmbak file in the
  // userData directory automatically (no user interaction needed).
  let autoBackupTimer: NodeJS.Timeout | null = null;
  const runAutoBackup = async () => {
    try {
      const settings = data.settings.load();
      if (!settings?.auto_backup) return;
      const intervalHours = Number(settings.backup_interval_hours || 24);
      if (intervalHours <= 0) return;
      const userData = app.getPath("userData");
      // Check existing backups to see if the last one is older than the interval.
      const backups = listBackups(userData);
      const lastBackup = backups[0]; // sorted by time desc
      const now = Date.now();
      if (lastBackup) {
        const lastTime = new Date(lastBackup.time).getTime();
        const elapsedHours = (now - lastTime) / (1000 * 60 * 60);
        if (elapsedHours < intervalHours) return; // too soon
      }
      const name = `backup-auto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mmbak`;
      const filePath = path.join(userData, name);
      await createBackup(filePath);
      console.log(`[auto-backup] Created: ${name}`);
      // Retention: keep only the newest N auto-backups in the app data folder
      // (manual/verified backups and mirrored copies are NEVER touched).
      // Without this the folder grows forever — a hidden disk-space leak on
      // machines that run for months.
      try {
        const keepRaw = Number((settings as any)?.backup_keep_count ?? 30);
        const keep = Number.isFinite(keepRaw) && keepRaw > 0 ? Math.min(200, Math.max(3, Math.floor(keepRaw))) : 30;
        const autoBackups = backups
          .filter((b: any) => /^backup-auto-.*\.mmbak$/i.test(String(b?.name || "")))
          .sort((a: any, b: any) => new Date(b.time).getTime() - new Date(a.time).getTime());
        for (const old of autoBackups.slice(keep)) {
          const oldPath = path.join(userData, String(old.name));
          try { if (fs.existsSync(oldPath)) { fs.unlinkSync(oldPath); console.log(`[auto-backup] Pruned old: ${old.name}`); } } catch (e) { console.warn("[auto-backup] prune failed:", e); }
        }
      } catch (e) { console.warn("[auto-backup] retention check failed:", e); }
      // Mirror the auto-backup to the configured second location (best-effort).
      const mirrorDir = String((settings as any)?.backup_mirror_dir || "").trim();
      if (mirrorDir) {
        const r = mirrorBackup(filePath, mirrorDir);
        if (r.ok) console.log(`[auto-backup] Mirrored to: ${r.path}`);
        else console.warn("[auto-backup] Mirror failed:", r.error);
      }
    } catch (e) {
      console.warn("[auto-backup] Failed:", e);
    }
  };
  autoBackupTimer = setInterval(runAutoBackup, 10 * 60 * 1000); // every 10 min
  // Also run once 30 seconds after startup (to let DB init finish).
  setTimeout(runAutoBackup, 30000);
});
app.on("window-all-closed", () => {
  // Uninstall gate: window closed without a decision means "declined".
  if (isUninstallVerify) { try { closeDB(); } catch {} app.exit(1); return; }
  closeDB(); if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => { closeConfirmed = true; closeDB(); });
