/*
 * window.mms web bridge — the Android (Capacitor) implementation of the
 * exact API surface the Electron preload exposes.
 *
 * Every handler mirrors electron/main.ts + electron/security-ipc.ts
 * semantics: the same session/role guards, the same admin re-authentication
 * on sensitive actions, the same audit trail. Differences are mobile-driven
 * only:
 *   - WhatsApp messaging is absent (removed feature on the phone).
 *   - Printing goes through the Android system print framework.
 *   - Backups live in the in-app vault instead of OS save dialogs.
 *   - App updates arrive by sideloading a new APK (no in-app updater).
 */
import * as data from "../../electron/services/data.service.js";
import { todayIST } from "../../electron/services/data.service.js";
import { istDateTimeDm } from "../../electron/services/ist-date.js";
import {
  login as authLogin,
  changePassword as authChangePassword,
  needsInitialSetup,
  createInitialAdministrator,
  verifyCurrentActorPassword,
  validatePassword,
} from "../../electron/services/auth.service.js";
import { security } from "../../electron/services/security.service.js";
import { getDB, persistSoon } from "./db.web";
import { buildTokenSheetHtml } from "../../electron/print/token.template.js";
import { buildCollectionSheetHtml } from "../../electron/print/collection-sheet.template.js";
import { buildCertificateHtml } from "../../electron/print/certificate.template.js";
import { buildAccountStatementHtml } from "../../electron/print/account-statement.template.js";
import { buildAuditPackHtml } from "../../electron/print/audit-pack.template.js";
import { buildRegisterBookHtml } from "../../electron/print/register-book.template.js";
import { getAnekMalayalamCss, getPreviewScreenCss } from "./print-utils.web";
import { printHtml, outputBytes, printLang } from "./print.web";
import * as receipts from "./receipts.web";
import * as backup from "./backup.web";
import ExcelJS from "exceljs";

type Actor = { id: number; username: string; role: string };

const session: { user: { id: number; username: string; fullName: string; role: string } | null } = { user: null };

const APP_VERSION = "3.0.0";

function actor(): Actor {
  const current = session.user;
  if (current) return { id: current.id, username: current.username, role: current.role };
  const authActor = (globalThis as any).__mmsGetActor?.() as Actor | null | undefined;
  if (authActor) return authActor;
  throw new Error("Authentication is required for this operation");
}

function admin(): Actor {
  const a = actor();
  if (a.role !== "Administrator") throw new Error("Administrator permission is required for this operation");
  return a;
}

function verifyAdmin(adminPassword: string): void {
  verifyCurrentActorPassword(String(adminPassword ?? ""));
}

function audit(a: Actor, action: string, module: string, refId: number | string, detail: string, detailJson = ""): void {
  try { data.audit.log(a.id, a.username, action, module, refId as number, detail, detailJson); } catch { /* audit never blocks */ }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

const api: any = {
  auth: {
    login: (username: string, password: string) => {
      try {
        const user = authLogin(username, password);
        session.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
        audit({ id: user.id, username: user.username, role: user.role }, "LOGIN", "auth", user.id, "User logged in", "");
        return { success: true, user };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    logout: async () => {
      if (session.user) audit(session.user, "LOGOUT", "auth", session.user.id, "User logged out", "");
      session.user = null;
      return { success: true };
    },
    currentUser: () => session.user,
    changePassword: (userId: number, newPassword: string) => {
      try {
        const a = actor();
        if (userId !== a.id && a.role !== "Administrator") throw new Error("You can only change your own password");
        validatePassword(newPassword);
        authChangePassword(userId, newPassword);
        audit(a, "PASSWORD_CHANGE", "auth", userId, "Password changed", "");
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    setupStatus: () => ({ required: needsInitialSetup() }),
    createInitialAdministrator: (username: string, fullName: string, password: string) => {
      try {
        const user = createInitialAdministrator(username, fullName, password);
        session.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
        audit({ id: user.id, username: user.username, role: user.role }, "INITIAL_SETUP", "auth", user.id, "Initial Administrator account created", "");
        return { success: true, user };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
    verifyAdminPassword: (password: string, action = "secure action", detail = "") => {
      const a = actor();
      const verified = verifyCurrentActorPassword(String(password ?? ""));
      audit(verified as any, "ADMIN_REAUTH", "auth", verified.id, `Administrator re-authenticated for: ${action}${detail ? ` — ${detail}` : ""}`, "");
      return { success: true, verifiedBy: verified.username, requestedBy: a.username };
    },
  },

  families: {
    list: (filter?: any) => { actor(); return data.families.list(filter || {}); },
    get: (id: number) => { actor(); return data.families.get(id); },
    create: (d: any) => { const a = actor(); return data.families.create(d); },
    update: (id: number, d: any) => security.updateFamily(actor(), id, d),
    archive: (id: number, reason: string) => security.archiveFamily(admin(), id, reason),
    restore: (id: number, reason?: string) => security.restoreFamily(admin(), id, reason || ""),
    history: (id: number) => { actor(); return security.history("family", id); },
    createFromMembers: (ids: number[], d: any, head: number, reason: string) => security.createFamilyFromMembers(admin(), ids, d, head, reason),
  },

  members: {
    list: (filter?: any) => { actor(); return data.members.list(filter || {}); },
    get: (id: number) => { actor(); return data.members.get(id); },
    create: (d: any) => { actor(); return data.members.create(d); },
    update: (id: number, d: any) => security.updateMember(actor(), id, d),
    archive: (id: number, reason: string) => security.archiveMember(admin(), id, reason),
    restore: (id: number, reason?: string) => security.restoreMember(admin(), id, reason || ""),
    history: (id: number) => { actor(); return security.history("member", id); },
    move: (ids: number[], fid: number, reason: string) => security.moveMembers(admin(), ids, fid, reason, "ExistingFamily"),
    moveHistory: (id: number) => { actor(); return security.familyMoveHistory(id); },
    relationships: () => { actor(); return data.members.relationships(); },
    relations: (id: number) => { actor(); return data.members.relations(id); },
  },

  subscriptions: {
    list: (filter?: any) => { actor(); return data.subscriptions.list(filter || {}); },
    get: (id: number) => { actor(); return data.subscriptions.get(id); },
    create: (d: any) => {
      const a = actor();
      const r = data.subscriptions.create({ ...d, collectedBy: a.id });
      audit(a, "ADD", "subscriptions", r?.id ?? 0, `Subscription account created for family #${d?.familyId}`, "");
      // WhatsApp receipt auto-send is a desktop feature; on the phone the
      // receipt prints from the subscription card.
      return { ...r, receiptWhatsApp: "skipped", receiptError: "" };
    },
    update: (id: number, d: any) => {
      const a = actor();
      const before = data.subscriptions.get(id) as any;
      const r = data.subscriptions.applyPayment(id, { ...d, collectedBy: a.id });
      audit(a, "PAY", "subscriptions", id, `Payment recorded: ${d?.amountPaid} of ${before?.amount} (${r?.status})${r?.receiptNumber ? ` receipt ${r.receiptNumber}` : ""}`, "");
      return { ...r, receiptWhatsApp: "skipped", receiptError: "" };
    },
    remove: () => { admin(); throw new Error("A recurring subscription cannot be deleted. Cancel the payment instead — the account stays with the family."); },
    cancelPayment: (id: number, reason: string, adminPassword: string) => {
      const a = admin();
      verifyAdmin(adminPassword);
      if (!reason || !String(reason).trim()) throw new Error("A cancellation reason is required");
      const s = data.subscriptions.get(id) as any;
      const r = data.subscriptions.cancelPayment(id);
      audit(a, "CANCEL_PAYMENT", "subscriptions", id, `Payment cancelled for family #${s?.family_id} (${s?.period_start}): ${String(reason).trim()}`, String(reason).trim());
      return r;
    },
    paymentsHistory: (familyId: number) => { actor(); return data.subscriptions.paymentsHistory(familyId); },
    markOverdue: () => { actor(); return data.subscriptions.markOverdue(); },
    totalCollected: () => { actor(); return data.subscriptions.totalCollected(); },
    totalPending: () => { actor(); return data.subscriptions.totalPending(); },
    plans: () => { actor(); return data.subscriptions.plans(); },
    ensureCurrentMonth: () => { actor(); return data.subscriptions.ensureCurrentMonth(); },
  },

  donations: {
    list: (filter?: any) => { actor(); return data.donations.list(filter || {}); },
    get: (id: number) => { actor(); return data.donations.get(id); },
    create: (d: any) => { const a = actor(); return data.donations.create({ ...d, receivedBy: a.id }); },
    update: (id: number, d: any, adminPassword: string, reason: string) => {
      const a = admin();
      if (!reason || !String(reason).trim()) throw new Error("A reason is required to edit a donation");
      verifyAdmin(adminPassword);
      audit(a, "UPDATE", "donations", id, `Donation edited after administrator re-authentication: ${String(reason).trim()}`, "");
      return data.donations.update(id, d);
    },
    remove: () => { admin(); throw new Error("Financial records cannot be permanently deleted. Use a correction/reversal instead."); },
    categories: () => { actor(); return data.donations.categories(); },
    categoriesAll: () => { actor(); return data.donations.categoriesAll(); },
    createCategory: (name: string, description?: string) => { admin(); return data.donations.createCategory(name, description || ""); },
    updateCategory: (id: number, name: string, description?: string) => { admin(); return data.donations.updateCategory(id, name, description || ""); },
    setCategoryActive: (id: number, active: boolean) => { admin(); return data.donations.setCategoryActive(id, active); },
    removeCategory: (id: number) => { admin(); return data.donations.removeCategory(id); },
    memberBalance: (familyId: number, memberId?: number) => { actor(); return data.donations.memberBalance(familyId, memberId); },
    totalThisMonth: () => { actor(); return data.donations.totalThisMonth(); },
  },

  // WhatsApp messaging is intentionally unavailable on Android.
  whatsapp: {
    status: () => ({ engine: "unavailable", connected: false, status: "unavailable", ackToS: true, qr: null, phone: null, lastError: "WhatsApp messaging is not part of the Android app" }),
    connect: () => ({ success: false, error: "WhatsApp messaging is not part of the Android app" }),
    ackToS: () => ({ success: true }),
    qr: () => null,
    disconnect: () => ({ success: true }),
    unlink: () => ({ success: true }),
    checkNumber: () => ({ valid: false, reason: "unavailable" }),
    setFamily: () => ({ success: false }),
    getFamily: () => ({ phone: "", enabled: false }),
    sendMessage: () => ({ success: false, error: "unavailable" }),
    sendDonationReceipt: () => ({ status: "failed", error: "unavailable" }),
    sendSubscriptionReceipt: () => ({ status: "failed", error: "unavailable" }),
    recipientStats: () => ({ total: 0, reachable: 0, optedOut: 0 }),
    createSubscriptionCampaign: () => ({ success: false, error: "unavailable" }),
    createAnnouncementCampaign: () => ({ success: false, error: "unavailable" }),
    runCampaign: () => ({ success: false, error: "unavailable" }),
    getCampaign: () => null,
    listCampaigns: () => [],
    listHistory: () => [],
    retryFailed: () => ({ success: false }),
    runtimeState: () => ({ engine: "unavailable" }),
  },

  accounting: {
    list: (filter?: any) => { actor(); return data.accounting.list(filter || {}); },
    get: (id: number) => { actor(); return data.accounting.get(id); },
    create: (d: any) => { const a = actor(); return data.accounting.create({ ...d, createdBy: a.id }); },
    update: (id: number, d: any, adminPassword: string, reason: string) => {
      const a = admin();
      if (!reason || !String(reason).trim()) throw new Error("A reason is required to edit a ledger entry");
      verifyAdmin(adminPassword);
      const before = data.accounting.get(id);
      const result = data.accounting.update(id, d);
      try {
        const after = data.accounting.get(id);
        const fields = ["txn_date", "type", "amount", "payment_method", "description", "category", "payee", "voucher_no", "bill_no", "transaction_ref", "receipt_number", "account_id"];
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        for (const f of fields) if ((before as any)?.[f] !== (after as any)?.[f]) changes[f] = { old: (before as any)?.[f] ?? null, new: (after as any)?.[f] ?? null };
        audit(a, "UPDATE", "accounting", id, `Ledger entry edited after administrator re-authentication: ${String(reason).trim()}`, JSON.stringify(changes));
        if (Object.keys(changes).length) security.logChange(a, "transaction", id, "EDIT", "Ledger entry edited", changes, String(reason).trim());
      } catch (historyErr) { console.warn("[accounting:update] change history failed:", historyErr); }
      return result;
    },
    remove: () => { admin(); throw new Error("Financial records cannot be deleted. VOID the entry instead — the record stays for audit."); },
    void: (id: number, reason: string, adminPassword: string) => {
      const a = admin();
      if (!reason || !String(reason).trim()) throw new Error("A void reason is required");
      verifyAdmin(adminPassword);
      const r = data.accounting.void(id, reason, a.id);
      audit(a, "VOID", "accounting", id, `Entry voided after administrator re-authentication: ${reason} (receipt ${r?.receiptNumber || ""})`, "");
      return r;
    },
    receiptSequence: () => { actor(); return data.accounting.receiptSequence(); },
    totalIncome: () => { actor(); return data.accounting.totalIncome(); },
    totalExpense: () => { actor(); return data.accounting.totalExpense(); },
    balance: () => { actor(); return data.accounting.balance(); },
    unifiedList: (filter?: any) => { actor(); return data.accounting.unifiedList(filter || {}); },
    unifiedSummary: (filter?: any) => { actor(); return data.accounting.unifiedSummary(filter || {}); },
    detail: (source: string, id: number) => { actor(); return data.accounting.unifiedDetail(String(source || ""), Number(id)); },
    exportPdf: async (filter?: any) => {
      actor();
      try {
        const allFilter = { ...filter, page: undefined, pageSize: undefined };
        const [listRes, summary] = await Promise.all([
          Promise.resolve(data.accounting.unifiedList(allFilter)),
          Promise.resolve(data.accounting.unifiedSummary(allFilter)),
        ]);
        const html = buildAccountStatementHtml(listRes.rows || [], summary, allFilter);
        printHtml(html, "Account statement");
        return { success: true, path: "printed", count: listRes.rows?.length || 0 };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
    exportExcel: async (filter?: any) => {
      actor();
      try {
        const allFilter = { ...filter, page: undefined, pageSize: undefined };
        const listRes = data.accounting.unifiedList(allFilter);
        const summary = data.accounting.unifiedSummary(allFilter);
        const rows = listRes.rows || [];
        const periodLabel = filter?.period || "all";
        const Excel = (ExcelJS as any).default ?? ExcelJS;
        const wb = new Excel.Workbook();
        const LEDGER_HEADERS = ["Date", "Source", "Type", "Description", "Category", "Receipt No", "Voucher No", "Bill No", "Payee", "Payment Method", "Transaction Ref", "Status", "Void Reason", "Amount"];
        const ledgerData = rows.map((r: any) => ({
          "Date": r.ledger_date || "", "Source": r.source || "", "Type": r.type || "", "Description": r.description || "",
          "Category": r.category || "", "Receipt No": r.receipt_number || "", "Voucher No": r.voucher_no || "", "Bill No": r.bill_no || "",
          "Payee": r.payee || "", "Payment Method": r.payment_method || "", "Transaction Ref": r.transaction_ref || "",
          "Status": r.status === "Void" ? "VOID" : (r.status || "Posted"), "Void Reason": r.void_reason || "", "Amount": Number(r.amount || 0),
        }));
        const summaryData = [
          { "Metric": "Total Income", "Value": summary.totalIncome }, { "Metric": "Total Expense", "Value": summary.totalExpense },
          { "Metric": "Balance", "Value": summary.balance }, { "Metric": "Entry Count", "Value": summary.entryCount },
          { "Metric": "", "Value": "" },
          { "Metric": "Income — Donations", "Value": summary.incomeDonations }, { "Metric": "Income — Subscriptions", "Value": summary.incomeSubscriptions },
          { "Metric": "Income — Manual", "Value": summary.incomeManual }, { "Metric": "", "Value": "" },
          { "Metric": "Expense — Welfare", "Value": summary.expenseWelfare }, { "Metric": "Expense — Salary", "Value": summary.expenseSalary },
          { "Metric": "Expense — Manual", "Value": summary.expenseManual },
        ];
        const fitWidth = (arr: any[], k: string) => {
          let max = String(k ?? "").length;
          for (let i = 0; i < arr.length && i < 400; i++) { const len = String(arr[i]?.[k] ?? "").length; if (len > max) max = len; }
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
        const buffer = await wb.xlsx.writeBuffer();
        const out = await outputBytes(new Uint8Array(buffer as ArrayBuffer), `account-statement-${periodLabel}-${todayIST()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        if (out.status === "cancelled") return { success: false, cancelled: true };
        return { success: true, path: out.status === "shared" ? "shared" : "downloads", size: (buffer as ArrayBuffer).byteLength, count: rows.length };
      } catch (err: any) { return { success: false, error: String(err?.message ?? err) }; }
    },
    exportAuditPack: async (fyYear: number) => {
      actor();
      try {
        const pack = data.accounting.auditPack(fyYear);
        const currency = String((data.settings.load() as any)?.currency_symbol || "\u20B9");
        const html = buildAuditPackHtml(pack, printLang(), currency);
        printHtml(html, "Annual audit pack");
        return { success: true, path: "printed", receipts: pack.totalReceipts, payments: pack.totalPayments, count: pack.transactions.length };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
  },

  assets: {
    list: (filter?: any) => { actor(); return data.assets.list(filter || {}); },
    get: (id: number) => { actor(); return data.assets.get(id); },
    create: (d: any) => { actor(); return data.assets.create(d); },
    update: (id: number, d: any) => { actor(); return data.assets.update(id, d); },
    remove: (id: number) => { actor(); return data.assets.remove(id); },
    options: () => { actor(); return data.assets.options(); },
    summary: () => { actor(); return data.assets.summary(); },
    statement: (id: number) => { actor(); return data.assets.statement(id); },
  },

  system: {
    clearAllData: (reason: string, adminPassword: string) => {
      const a = admin();
      verifyAdmin(adminPassword);
      const r = data.clearAllData(String(reason ?? ""));
      audit(a, "CLEAR_ALL_DATA", "settings", 0, `ALL RECORDS ERASED (${r.cleared.length} tables) — the app was factory-reset for production. Reason: ${String(reason ?? "").trim()}`, String(reason ?? "").trim());
      persistSoon();
      return r;
    },
  },

  marriages: {
    list: (filter?: any) => { actor(); return data.marriages.list(filter || {}); },
    get: (id: number) => { actor(); return data.marriages.get(id); },
    create: (d: any) => { const a = actor(); return data.marriages.create({ ...d, createdBy: a.id }); },
    update: (id: number, d: any) => { const a = actor(); return data.marriages.update(id, d); },
    remove: () => { throw new Error("Marriage records cannot be permanently deleted. Correct or revoke the record instead."); },
    printRegister: async () => {
      actor();
      try {
        const settings = data.settings.load();
        const regData = {
          type: "marriage" as const,
          mahalluName: (settings as any)?.mahallu_name || "Minz Mahallu",
          generatedAt: new Date().toISOString(),
          rows: data.marriages.registerRows(),
        };
        printHtml(buildRegisterBookHtml(regData, printLang()), "Marriage register");
        return { success: true, path: "printed", count: regData.rows.length };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
  },

  deaths: {
    list: (filter?: any) => { actor(); return data.deaths.list(filter || {}); },
    get: (id: number) => { actor(); return data.deaths.get(id); },
    create: (d: any) => { const a = actor(); return data.deaths.create({ ...d, createdBy: a.id }); },
    update: (id: number, d: any) => { const a = actor(); return data.deaths.update(id, d); },
    remove: () => { throw new Error("Death records cannot be permanently deleted. Correct or revoke the record instead."); },
    printRegister: async () => {
      actor();
      try {
        const settings = data.settings.load();
        const regData = {
          type: "death" as const,
          mahalluName: (settings as any)?.mahallu_name || "Minz Mahallu",
          generatedAt: new Date().toISOString(),
          rows: data.deaths.registerRows(),
        };
        printHtml(buildRegisterBookHtml(regData, printLang()), "Death register");
        return { success: true, path: "printed", count: regData.rows.length };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
  },

  welfare: {
    list: (filter?: any) => { actor(); return data.welfare.list(filter || {}); },
    get: (id: number) => { actor(); return data.welfare.get(id); },
    create: (d: any) => { const a = actor(); return data.welfare.create({ ...d, createdBy: a.id }); },
    update: (id: number, d: any) => { admin(); return data.welfare.update(id, d); },
    approve: (id: number, amount: number, remarks: string, minutesDate?: string) => {
      const a = admin();
      if (!minutesDate) throw new Error("Date of the committee minutes approving this amount is required");
      const r = data.welfare.approve(id, amount, remarks, a.id, minutesDate);
      audit(a, "APPROVE", "welfare", id, `Welfare approved: ${amount} — minutes of ${minutesDate}`, remarks || "");
      return r;
    },
    reject: (id: number, reason: string) => {
      const a = admin();
      const r = data.welfare.reject(id, reason, a.id);
      audit(a, "REJECT", "welfare", id, `Welfare rejected: ${reason}`, reason);
      return r;
    },
    disburse: (id: number, reason = "", adminPassword?: string) => {
      const a = admin();
      verifyAdmin(String(adminPassword ?? ""));
      if (!reason || !String(reason).trim()) throw new Error("A disbursement reason is required");
      const w = data.welfare.get(id) as any;
      const r = data.welfare.disburse(id, a.id, String(reason).trim());
      audit(a, "DISBURSE", "welfare", id, `Welfare disbursed: ${w?.amount_approved} to ${w?.applicant_name} (minutes: ${w?.minutes_date}) — ${String(reason).trim()}`, String(reason).trim());
      return r;
    },
    remove: () => { admin(); throw new Error("Welfare records cannot be permanently deleted. Correct or revoke the record instead."); },
    categories: () => { actor(); return data.welfare.categories(); },
  },

  certificates: {
    list: (filter?: any) => { actor(); return data.certificates.list(filter || {}); },
    issueMembership: (code: string) => data.certificates.issueMembership(code, actor().id),
    issueResidence: (familyNum: string, issuedTo: string) => data.certificates.issueResidence(familyNum, issuedTo, actor().id),
    issueMarriage: (marriageNum: string) => data.certificates.issueMarriage(marriageNum, actor().id),
    issueMarriageNoc: (marriageNum: string) => data.certificates.issueMarriageNoc(marriageNum, actor().id),
    issueDeath: (deathNum: string) => data.certificates.issueDeath(deathNum, actor().id),
    remove: () => { throw new Error("Issued certificates cannot be permanently deleted. Revoke the certificate instead."); },
    generatePdf: async (certId: number) => {
      actor();
      try {
        const listResult = data.certificates.list({});
        const cert = (listResult?.rows || []).find((c: any) => c.id === certId);
        if (!cert) return { success: false, error: "Certificate not found" };
        const expectedReprint = (cert.reprint_count || 0) + 1;
        data.certificates.ensureVerificationCode(cert);
        const html = buildCertificateHtml(cert, printLang(), expectedReprint, istDateTimeDm(new Date()));
        printHtml(html, `Certificate ${cert.certificate_number || certId}`);
        try { data.certificates.markReprint(certId); } catch (e) { console.warn("[certificates] reprint count not updated:", e); }
        return { success: true, path: "printed", reprint: expectedReprint > 1 };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
    previewHtml: async (certId: number) => {
      actor();
      try {
        const listResult = data.certificates.list({});
        const cert = (listResult?.rows || []).find((c: any) => c.id === certId);
        if (!cert) return { success: false, error: "Certificate not found" };
        data.certificates.ensureVerificationCode(cert);
        const html = buildCertificateHtml(cert, printLang(), 0, undefined, getPreviewScreenCss());
        return { success: true, html };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
    verify: (code: string) => {
      const a = actor();
      const result = data.certificates.verify(code);
      try {
        const label = result?.valid
          ? (result.kind === "RECEIPT"
            ? `Receipt ${result.receipt?.receipt_number} (${result.receipt?.payer})`
            : `Certificate ${result.certificate?.certificate_number} (${result.certificate?.issued_to})`)
          : "no matching record";
        audit(a, "VERIFY", "certificates", 0, `Verification lookup: ${String(code || "").trim().toUpperCase()} → ${label}`, "");
      } catch { /* audit failure must never block a verification */ }
      return result;
    },
    verifyQr: (payload: string) => {
      const a = actor();
      const result = data.certificates.verifyQr(payload);
      try {
        const reason = result?.valid ? "valid" : String(result?.reason || "invalid");
        audit(a, "VERIFY_QR", "certificates", 0, `QR verification (${result?.kind || "unknown"}): ${reason}`, "");
      } catch { /* ignore */ }
      return result;
    },
  },

  pdf: {
    generate: async (html: string, name: string) => {
      actor();
      printHtml(html, name || "MMS document");
      return { success: true, path: name || "printed" };
    },
    getAnekFontCss: () => getAnekMalayalamCss(),
  },

  receipts: {
    getDonationPdf: async () => ({ success: false, error: "Receipts print directly on the phone" }),
    getSubscriptionPdf: async () => ({ success: false, error: "Receipts print directly on the phone" }),
    saveDonationPdf: async (id: number) => { actor(); return receipts.printDonationReceipt(Number(id)); },
    saveSubscriptionPdf: async (subscriptionId: number) => { actor(); return receipts.printSubscriptionReceipt(Number(subscriptionId)); },
    saveDonationBatchPdf: async (ids: number[]) => { actor(); return receipts.printDonationBatchReceipts(ids || []); },
    saveSubscriptionBatchPdf: async (ids: number[]) => { actor(); return receipts.printSubscriptionBatchReceipts(ids || []); },
  },

  users: {
    list: () => { admin(); return data.users.list(); },
    create: (d: any) => { const a = admin(); validatePassword(String(d?.password ?? "")); return data.users.create(d, a.role); },
    update: (id: number, d: any) => { admin(); return data.users.update(id, d); },
    toggleLock: (id: number, locked: boolean) => { admin(); return data.users.toggleLock(id, locked); },
    resetPassword: (id: number, p: string) => {
      const a = admin();
      validatePassword(p);
      authChangePassword(id, p);
      audit(a, "PASSWORD_RESET", "users", id, "Administrator reset user password", "");
      return { success: true };
    },
    remove: (id: number) => { admin(); return data.users.remove(id); },
  },

  audit: {
    list: (filter?: any) => { actor(); return data.audit.list(filter || {}); },
    verify: () => { actor(); return data.audit.verify(); },
  },

  settings: {
    load: () => { actor(); return data.settings.load(); },
    save: (d: any) => { const a = admin(); return data.settings.save({ ...d, updatedBy: a.id }); },
  },

  app: {
    info: () => ({ version: APP_VERSION, electron: "", platform: "android", dataDir: "In-app secure storage" }),
  },

  updates: {
    status: () => ({ enabled: false, currentVersion: APP_VERSION, latestVersion: null, downloadUrl: null }),
    checkNow: async () => ({ success: false, error: "Android updates are installed by opening the new APK file" }),
    openReleasePage: async () => ({ success: true }),
    openDownload: async () => ({ success: true }),
  },

  dashboard: {
    summary: () => { actor(); return data.dashboard.summary(); },
    incomeThisMonth: () => { actor(); return data.dashboard.incomeThisMonth(); },
    expenseThisMonth: () => { actor(); return data.dashboard.expenseThisMonth(); },
    balance: () => { actor(); return data.dashboard.balance(); },
    monthlyCollections: (m?: number) => { actor(); return data.dashboard.monthlyCollections(m || 6); },
    monthlyDonations: (m?: number) => { actor(); return data.dashboard.monthlyDonations(m || 6); },
    incomeVsExpense: (m?: number) => { actor(); return data.dashboard.incomeVsExpense(m || 6); },
    recentActivity: (l?: number) => { actor(); return data.dashboard.recentActivity(l || 10); },
    alerts: () => { actor(); return data.dashboard.alerts(); },
    todayAtGlance: () => {
      actor();
      const glance = data.dashboard.todayAtGlance();
      let backupEnabled = false;
      let nextBackup: string | null = null;
      let lastBackup: string | null = null;
      try {
        const settings = data.settings.load();
        backupEnabled = !!(settings as any)?.auto_backup;
        const intervalHours = Number((settings as any)?.backup_interval_hours || 24);
        if (backupEnabled && intervalHours > 0) {
          const next = Date.now() + intervalHours * 3600 * 1000;
          nextBackup = new Date(next).toISOString();
        }
      } catch { /* ignore */ }
      return { ...glance, backupEnabled, nextBackup, lastBackup };
    },
  },

  backup: {
    create: async () => {
      const a = actor();
      if (a.role !== "Administrator") return { success: false, error: "Administrator permission is required" };
      return backup.webCreateBackup("manual");
    },
    list: async () => { actor(); return backup.webListBackups(); },
    verify: async (name: string) => { actor(); return backup.webVerifyBackup(String(name || "")); },
    restore: async (name: string) => {
      const a = actor();
      if (a.role !== "Administrator") return { success: false, error: "Administrator permission is required" };
      return backup.webRestoreBackup(String(name || ""));
    },
    chooseMirrorDir: async () => ({ success: false, cancelled: true }),
  },

  dialog: {
    showSave: async (name: string) => ({ success: true, path: `Download/${name}` }),
  },

  win: {
    minimize: async () => { /* native app: no window controls */ },
    maximize: async () => { /* native app: no window controls */ },
    close: async () => { /* the Android system back/home controls close the app */ },
    confirmClose: async () => { /* no-op on Android */ },
    onAskClose: () => () => { /* no close events on Android */ },
  },

  uninstall: {
    dbStatus: () => ({ hasDb: true }),
    verify: () => ({ ok: false, reason: "unsupported" }),
    finish: () => { /* no-op on Android */ },
  },

  tokens: {
    listEvents: () => { actor(); return data.tokens.listEvents(); },
    getEvent: (id: number) => { actor(); return data.tokens.getEvent(id); },
    createEvent: (d: any) => { actor(); return data.tokens.createEvent(d); },
    updateEvent: (id: number, d: any) => { actor(); return data.tokens.updateEvent(id, d); },
    removeEvent: (id: number, reason: string) => {
      const a = admin();
      return data.tokens.removeEvent(id, reason, { id: a.id, username: a.username });
    },
    list: (filter?: any) => { actor(); return data.tokens.list(filter || {}); },
    checkExisting: (eventId: number) => { actor(); return Array.from(data.tokens.checkExisting(eventId)); },
    generate: (eventId: number, familyIds: number[]) => data.tokens.generate(eventId, familyIds, actor().id),
    collect: (tokenId: number) => data.tokens.collect(tokenId, actor().id),
    cancel: (tokenId: number, reason: string) => { actor(); return data.tokens.cancel(tokenId, reason); },
    replace: (tokenId: number, reason: string) => data.tokens.replace(tokenId, reason, actor().id),
    remove: (tokenId: number, reason: string) => {
      const a = admin();
      const db = getDB();
      const row = db.prepare(
        `SELECT ta.id, e.event_date FROM token_assignments ta
           LEFT JOIN token_events e ON e.id = ta.event_id
         WHERE ta.id = ?`
      ).get(tokenId) as { id: number; event_date: string | null } | undefined;
      if (!row) throw new Error("Token not found");
      if (!row.event_date || row.event_date >= todayIST()) throw new Error("Tokens can only be deleted after the event date has passed");
      if (!reason?.trim()) throw new Error("A deletion reason is required");
      db.transaction(() => {
        db.prepare("DELETE FROM token_assignments WHERE id = ?").run(tokenId);
        audit(a, "DELETE", "tokens", tokenId, `Token deleted: ${reason.trim()}`, "");
      })();
      return { success: true };
    },
    stats: (eventId: number) => { actor(); return data.tokens.stats(eventId); },
    listForPdf: (eventId: number) => { actor(); return data.tokens.listForPdf(eventId); },
    generateTokenPdf: async (eventId: number) => {
      actor();
      try {
        const tokenList = data.tokens.listForPdf(eventId);
        if (!tokenList || tokenList.length === 0) return { success: false, error: "No tokens found for this event" };
        const event = data.tokens.getEvent(eventId);
        printHtml(buildTokenSheetHtml(tokenList, event), "Token sheet");
        return { success: true, path: "printed", count: tokenList.length };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
    generateCollectionSheet: async (eventId: number) => {
      actor();
      try {
        const tokenList = data.tokens.listForPdf(eventId);
        if (!tokenList || tokenList.length === 0) return { success: false, error: "No tokens found for this event" };
        const event = data.tokens.getEvent(eventId);
        printHtml(buildCollectionSheetHtml(tokenList, event), "Collection sheet");
        return { success: true, path: "printed", count: tokenList.length };
      } catch (err: any) { return { success: false, error: err.message }; }
    },
  },

  staff: {
    list: (filter?: any) => { actor(); return data.staff.list(filter || {}); },
    get: (id: number) => { actor(); return data.staff.get(id); },
    roles: () => { actor(); return data.staff.roles(); },
    create: (d: any) => { const a = actor(); const r = data.staff.create({ ...d, createdBy: a.id }); audit(a, "ADD", "staff", r?.id ?? 0, `Staff ${r?.staffCode} created (${d?.role || "Staff"})`, ""); return r; },
    update: (id: number, d: any) => { const a = actor(); const r = data.staff.update(id, d); audit(a, "EDIT", "staff", id, `Staff updated: ${d?.name || ""}`, ""); return r; },
    archive: (id: number, reason: string) => { const a = admin(); const r = data.staff.archive(id, reason, a.id); audit(a, "ARCHIVE", "staff", id, `Staff archived: ${reason}`, ""); return r; },
    setStatus: (id: number, status: "Resigned" | "Expelled", effectiveDate: string, reason: string, adminPassword: string) => {
      const a = admin();
      verifyAdmin(adminPassword);
      if (!reason || !String(reason).trim()) throw new Error("A reason is required");
      const r = data.staff.setStatus(id, status, effectiveDate || "", String(reason).trim(), a.id);
      audit(a, status === "Expelled" ? "EXPEL" : "RESIGN", "staff", id, `Staff ${status === "Expelled" ? "expelled" : "resigned"} effective ${effectiveDate || "today"}: ${String(reason).trim()}`, String(reason).trim());
      return r;
    },
    restore: (id: number) => { const a = admin(); const r = data.staff.restore(id, a.id); audit(a, "RESTORE", "staff", id, "Staff restored", ""); return r; },
    history: (id: number) => { actor(); return data.staff.history(id); },
    listPayments: (filter?: any) => { actor(); return data.staff.listPayments(filter || {}); },
    paySalary: (d: any) => {
      const a = admin();
      const r = data.staff.paySalary(d, a.id);
      audit(a, "PAY_SALARY", "staff", d?.staffId ?? 0, `Salary paid: ${d?.amount} for ${d?.periodMonth}/${d?.periodYear}`, "");
      return r;
    },
    cancelPayment: (id: number, reason = "", adminPassword?: string) => {
      const a = admin();
      verifyAdmin(String(adminPassword ?? ""));
      if (!String(reason).trim()) throw new Error("A cancellation reason is required");
      const r = data.staff.cancelPayment(id);
      audit(a, "CANCEL_SALARY", "staff_payments", id, `Salary payment cancelled: ${String(reason).trim()}`, String(reason).trim());
      return r;
    },
    salarySummary: (year?: number) => { actor(); return data.staff.salarySummary(year || new Date().getFullYear()); },
  },

  committee: {
    list: (filter?: any) => { actor(); return data.committee.list(filter || {}); },
    get: (id: number) => { actor(); return data.committee.get(id); },
    positions: () => { actor(); return data.committee.positions(); },
    types: () => { actor(); return data.committee.types(); },
    summary: () => { actor(); return data.committee.summary(); },
    create: (d: any) => { const a = actor(); const r = data.committee.create({ ...d, createdBy: a.id }); audit(a, "ADD", "committee", r?.id ?? 0, `Committee ${r?.committeeCode} created (${d?.position || "Committee Member"})`, ""); return r; },
    update: (id: number, d: any) => { const a = actor(); const r = data.committee.update(id, d); audit(a, "EDIT", "committee", id, `Committee updated: ${d?.name || ""}`, ""); return r; },
    archive: (id: number, reason: string) => { const a = admin(); const r = data.committee.archive(id, reason, a.id); audit(a, "ARCHIVE", "committee", id, `Committee archived: ${reason}`, ""); return r; },
    restore: (id: number) => { const a = admin(); const r = data.committee.restore(id, a.id); audit(a, "RESTORE", "committee", id, "Committee restored", ""); return r; },
    history: (id: number) => { actor(); return data.committee.history(id); },
  },

  events: {
    onDownloadFailed: () => () => { /* downloads never fail silently on Android */ },
    onUpdateAvailable: () => () => { /* updates arrive via APK sideload */ },
  },
};

export function installWebApi(): void {
  (globalThis as any).mms = api;
}

export default api;
