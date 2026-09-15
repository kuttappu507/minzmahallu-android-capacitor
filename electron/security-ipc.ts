import { BrowserWindow, ipcMain } from "electron";
import * as data from "./services/data.service.js";
import { changePassword, createInitialAdministrator, needsInitialSetup, verifyCurrentActorPassword } from "./services/auth.service.js";
import { security, type Actor } from "./services/security.service.js";
import { getDB } from "./db/connection.js";
import { todayIST } from "./services/data.service.js";
import { whatsapp } from "./services/whatsapp.service.js";

// Install the sender guard before main.ts registers any handlers. This makes
// the protection apply to read, write, export and utility IPC channels alike.
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = ((channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
  return rawHandle(channel, async (event, ...args) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed()) throw new Error("Unauthorized IPC sender");
    return listener(event, ...args);
  });
}) as typeof ipcMain.handle;

type ActorProvider = () => Actor | null;
function register(name: string, handler: (...args: any[]) => any) {
  try { ipcMain.removeHandler(name); } catch {}
  ipcMain.handle(name, async (_event, ...args) => handler(...args));
}
function validatePassword(password: string) {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("Password must include uppercase, lowercase, digit, and special character");
  }
}

export function registerSecurityIpc(getActor: ActorProvider) {
  register("auth:setupStatus", () => ({ required: needsInitialSetup() }));
  register("auth:createInitialAdministrator", (username: string, fullName: string, password: string) => {
    const user = createInitialAdministrator(username, fullName, password);
    try { data.audit.log(user.id, user.username, "INITIAL_SETUP", "auth", user.id, "Initial Administrator account created", ""); } catch {}
    return { success: true, user };
  });
  const actor = (): Actor => {
    const current = getActor();
    if (current) return current;
    const authActor = (globalThis as any).__mmsGetActor?.() as Actor | null | undefined;
    if (authActor) return authActor;
    throw new Error("Authentication is required for this operation");
  };
  const admin = (): Actor => {
    const current = actor();
    if (current.role !== "Administrator") throw new Error("Administrator permission is required for this operation");
    return current;
  };
  register("auth:changePassword", (userId: number, newPassword: string) => {
    const a = actor();
    if (userId !== a.id && a.role !== "Administrator") throw new Error("You can only change your own password");
    validatePassword(newPassword); changePassword(userId, newPassword);
    try { data.audit.log(a.id, a.username, "PASSWORD_CHANGE", "auth", userId, "Password changed", ""); } catch {}
    return { success: true };
  });
  // ===== Secure-action re-authentication =====
  // Cancelling payments, disbursing welfare, resigning/expelling staff etc.
  // all require the administrator to re-enter THEIR OWN password. The
  // verification happens here, in the main process, against the stored PBKDF2
  // hash — the renderer never sees hashes or salts.
  register("auth:verifyAdminPassword", (password: string, action = "secure action", detail = "") => {
    const a = actor();
    const verified = verifyCurrentActorPassword(String(password ?? ""));
    try { data.audit.log(verified.id, verified.username, "ADMIN_REAUTH", "auth", verified.id, `Administrator re-authenticated for: ${action}${detail ? ` — ${detail}` : ""}`, ""); } catch {}
    return { success: true, verifiedBy: verified.username, requestedBy: a.username };
  });
  register("families:update", (id: number, d: any) => security.updateFamily(actor(), id, d));
  register("members:update", (id: number, d: any) => security.updateMember(actor(), id, d));

  // ===== Archive/restore/history/move handlers (security:* channels) =====
  // These are called from the preload as window.mms.families.archive(id, reason),
  // window.mms.families.restore(id), window.mms.families.history(id),
  // window.mms.members.archive(id, reason), window.mms.members.restore(id),
  // window.mms.members.history(id), window.mms.members.move(ids, fid, reason),
  // window.mms.members.moveHistory(id), window.mms.families.createFromMembers(...).
  // Previously these channels had NO handlers, so every call threw
  // "No handler registered for security:familyHistory" etc. — which was
  // silently caught by try/catch in the renderer, resulting in empty
  // member lists in the family preview dialog.
  register("security:archiveFamily", (id: number, reason: string) => security.archiveFamily(admin(), id, reason));
  register("security:restoreFamily", (id: number, reason: string) => security.restoreFamily(admin(), id, reason));
  register("security:familyHistory", (id: number) => { actor(); return security.history("family", id); });
  register("security:archiveMember", (id: number, reason: string) => security.archiveMember(admin(), id, reason));
  register("security:restoreMember", (id: number, reason: string) => security.restoreMember(admin(), id, reason));
  register("security:memberHistory", (id: number) => { actor(); return security.history("member", id); });
  register("security:moveMembers", (memberIds: number[], newFamilyId: number, reason: string, moveType: string) => security.moveMembers(admin(), memberIds, newFamilyId, reason, moveType as "ExistingFamily" | "NewFamily"));
  register("security:memberMoveHistory", (memberId: number) => { actor(); return security.familyMoveHistory(memberId); });
  register("security:createFamilyFromMembers", (memberIds: number[], familyData: any, headMemberId: number, reason: string) => security.createFamilyFromMembers(admin(), memberIds, familyData, headMemberId, reason));

  register("families:remove", () => { throw new Error("Families cannot be permanently deleted. Archive the family instead."); });
  register("members:remove", () => { throw new Error("Members cannot be permanently deleted. Archive the member instead."); });
  register("marriages:remove", () => { throw new Error("Marriage records cannot be permanently deleted. Correct or revoke the record instead."); });
  register("deaths:remove", () => { throw new Error("Death records cannot be permanently deleted. Correct or revoke the record instead."); });
  register("certificates:remove", () => { throw new Error("Issued certificates cannot be permanently deleted. Revoke the certificate instead."); });
  register("families:create", (d: any) => { actor(); return data.families.create(d); });
  register("members:create", (d: any) => { actor(); return data.members.create(d); });
  register("subscriptions:create", async (d: any) => { const a = actor(); const r = data.subscriptions.create({ ...d, collectedBy: a.id }); try { data.audit.log(a.id, a.username, "ADD", "subscriptions", r.id, `Subscription account created for family #${d.familyId}`, ""); } catch {}
    // First payment (if any) gets the A6 receipt treatment: generated + saved
    // in the app, and sent on WhatsApp when the engine + family number allow.
    let receipt: any = { status: "skipped" };
    if (Number(d?.amountPaid ?? 0) > 0 && r?.id) {
      try { receipt = await whatsapp.sendSubscriptionReceipt(Number(r.id), { soft: true }); }
      catch (err: any) { receipt = { status: "failed", error: String(err?.message || err) }; }
    }
    return { ...r, receiptWhatsApp: receipt.status, receiptError: receipt.error || "" };
  });
  // Payment edits are restricted to "how much was given" (plus date/method/
  // ref/remarks) — family, member, period and rate are locked server-side in
  // data.subscriptions.applyPayment.
  register("subscriptions:update", async (id: number, d: any) => {
    const a = actor();
    const before = data.subscriptions.get(id) as any;
    const r = data.subscriptions.applyPayment(id, { ...d, collectedBy: a.id });
    try { data.audit.log(a.id, a.username, "PAY", "subscriptions", id, `Payment recorded: ${d.amountPaid} of ${before?.amount} (${r.status})${r.receiptNumber ? ` receipt ${r.receiptNumber}` : ""}`, ""); } catch {}
    // Recording a payment also generates the A6 receipt (saved in the app)
    // and — when WhatsApp is paired and the family has a number — sends it
    // automatically. The payment NEVER fails because of messaging; the send
    // result rides along as receiptWhatsApp on the response.
    let receipt: any = { status: "skipped" };
    if (Number(d?.amountPaid ?? 0) > 0 && r?.receiptNumber) {
      try { receipt = await whatsapp.sendSubscriptionReceipt(id, { soft: true }); }
      catch (err: any) { receipt = { status: "failed", error: String(err?.message || err) }; }
    }
    return { ...r, receiptWhatsApp: receipt.status, receiptError: receipt.error || "" };
  });
  // Cancelling a payment is a SECURE action: reason + admin password,
  // RE-VERIFIED IN THE MAIN PROCESS (a tampered renderer can no longer skip
  // the password step by calling this channel directly).
  register("subscriptions:cancelPayment", (id: number, reason: string, adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    if (!reason || !String(reason).trim()) throw new Error("A cancellation reason is required");
    const s = data.subscriptions.get(id) as any;
    const r = data.subscriptions.cancelPayment(id);
    try { data.audit.log(a.id, a.username, "CANCEL_PAYMENT", "subscriptions", id, `Payment cancelled for family #${s?.family_id} (${s?.period_start}): ${String(reason).trim()}`, String(reason).trim()); } catch {}
    return r;
  });
  register("subscriptions:paymentsHistory", (familyId: number) => { actor(); return data.subscriptions.paymentsHistory(familyId); });
  register("subscriptions:remove", () => { admin(); throw new Error("A recurring subscription cannot be deleted. Cancel the payment instead — the account stays with the family."); });
  register("subscriptions:markOverdue", () => { actor(); return data.subscriptions.markOverdue(); });
  // Factory reset for the RECORD data — Administrator role + own-password
  // re-auth (verified HERE in the main process) + a reason, then every
  // business table is wiped and the audit trail restarts with this entry.
  register("system:clearAllData", (reason: string, adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    const r = data.clearAllData(String(reason ?? ""));
    try { data.audit.log(a.id, a.username, "CLEAR_ALL_DATA", "settings", 0, `ALL RECORDS ERASED (${r.cleared.length} tables) — the app was factory-reset for production. Reason: ${String(reason ?? "").trim()}`, String(reason ?? "").trim()); } catch {}
    return r;
  });
  register("donations:create", (d: any) => { const a = actor(); return data.donations.create({ ...d, receivedBy: a.id }); });
  register("donations:update", (id: number, d: any, adminPassword: string, reason: string) => {
    const a = admin();
    // Editing an issued donation receipt is a sensitive financial action:
    // Administrator role + own-password re-authentication + a reason, all audited.
    if (!reason || !String(reason).trim()) throw new Error("A reason is required to edit a donation");
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    try { data.audit.log(a.id, a.username, "UPDATE", "donations", id, `Donation edited after administrator re-authentication: ${String(reason).trim()}`, ""); } catch {}
    return data.donations.update(id, d);
  });
  register("donations:remove", () => { admin(); throw new Error("Financial records cannot be permanently deleted. Use a correction/reversal instead."); });
  register("accounting:create", (d: any) => { const a = actor(); return data.accounting.create({ ...d, createdBy: a.id }); });
  register("accounting:update", (id: number, d: any, adminPassword: string, reason: string) => {
    const a = admin();
    // Editing an income/expense ledger entry changes recorded money: it requires
    // the Administrator role, re-entry of the administrator's OWN password
    // (verified against the PBKDF2 hash in this process), and a reason. All
    // three are recorded in the tamper-evident audit log.
    if (!reason || !String(reason).trim()) throw new Error("A reason is required to edit a ledger entry");
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    // Capture the BEFORE state so the change history can show exactly which
    // fields the edit moved (amount, date, category …) — surfaced in the
    // ledger row's double-click preview.
    const before = data.accounting.get(id);
    const result = data.accounting.update(id, d);
    try {
      const after = data.accounting.get(id);
      const fields = ["txn_date", "type", "amount", "payment_method", "description", "category", "payee", "voucher_no", "bill_no", "transaction_ref", "receipt_number", "account_id"];
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      for (const f of fields) if ((before as any)?.[f] !== (after as any)?.[f]) changes[f] = { old: (before as any)?.[f] ?? null, new: (after as any)?.[f] ?? null };
      data.audit.log(a.id, a.username, "UPDATE", "accounting", id, `Ledger entry edited after administrator re-authentication: ${String(reason).trim()}`, JSON.stringify(changes));
      if (Object.keys(changes).length) {
        security.logChange(a, "transaction", id, "EDIT", "Ledger entry edited", changes, String(reason).trim());
      }
    } catch (historyErr) { console.warn("[accounting:update] change history failed:", historyErr); }
    return result;
  });
  register("accounting:remove", () => { admin(); throw new Error("Financial records cannot be deleted. VOID the entry instead — the record stays for audit."); });
  // VOID instead of delete: keeps the receipt number and the entry, adds
  // who/when/why. Administrator-only because it reverses a financial record.
  register("accounting:void", (id: number, reason: string, adminPassword: string) => {
    const a = admin();
    if (!reason || !String(reason).trim()) throw new Error("A void reason is required");
    // Voiding reverses a financial record: administrator password re-authentication
    // is required on top of the role check, so a walked-away workstation cannot
    // be used to void entries.
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    const r = data.accounting.void(id, reason, a.id);
    try { data.audit.log(a.id, a.username, "VOID", "accounting", id, `Entry voided after administrator re-authentication: ${reason} (receipt ${r.receiptNumber || ""})`, ""); } catch {}
    return r;
  });
  register("accounting:receiptSequence", () => { actor(); return data.accounting.receiptSequence(); });
  register("marriages:create", (d: any) => { const a = actor(); return data.marriages.create({ ...d, createdBy: a.id }); });
  register("marriages:update", (id: number, d: any) => { const a = actor(); return data.marriages.update(id, d); });
  register("deaths:create", (d: any) => { const a = actor(); return data.deaths.create({ ...d, createdBy: a.id }); });
  register("deaths:update", (id: number, d: any) => { const a = actor(); return data.deaths.update(id, d); });
  register("welfare:create", (d: any) => { const a = actor(); return data.welfare.create({ ...d, createdBy: a.id }); });
  register("welfare:update", (id: number, d: any) => {
    const a = actor();
    // Sensitive welfare fields (amount_approved, status transitions, family_id)
    // require Administrator. Non-admins may only edit descriptive fields like
    // applicant_name / reason / remarks on a still-Pending request — but to keep the
    // contract simple and safe, route all welfare edits through admin.
    admin();
    return data.welfare.update(id, d);
  });
  register("welfare:remove", () => { admin(); throw new Error("Welfare records cannot be permanently deleted. Correct or revoke the record instead."); });
  register("welfare:list", (filter: any) => { actor(); return data.welfare.list(filter || {}); });
  register("welfare:get", (id: number) => { actor(); return data.welfare.get(id); });
  register("welfare:categories", () => { actor(); return data.welfare.categories(); });
  register("welfare:approve", (id: number, amount: number, remarks: string, minutesDate?: string) => {
    const a = admin();
    if (!minutesDate) throw new Error("Date of the committee minutes approving this amount is required");
    const r = data.welfare.approve(id, amount, remarks, a.id, minutesDate);
    try { data.audit.log(a.id, a.username, "APPROVE", "welfare", id, `Welfare approved: ${amount} — minutes of ${minutesDate}`, remarks || ""); } catch {}
    return r;
  });
  register("welfare:reject", (id: number, reason: string) => { const a = admin(); const r = data.welfare.reject(id, reason, a.id); try { data.audit.log(a.id, a.username, "REJECT", "welfare", id, `Welfare rejected: ${reason}`, reason); } catch {} return r; });
  // Disbursement is a SECURE action: minutes date + reason + administrator
  // password re-verified in the main process.
  register("welfare:disburse", (id: number, reason = "", adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    if (!reason || !String(reason).trim()) throw new Error("A disbursement reason is required");
    const w = data.welfare.get(id) as any;
    const r = data.welfare.disburse(id, a.id, String(reason).trim());
    try { data.audit.log(a.id, a.username, "DISBURSE", "welfare", id, `Welfare disbursed: ${w?.amount_approved} to ${w?.applicant_name} (minutes: ${w?.minutes_date}) — ${String(reason).trim()}`, String(reason).trim()); } catch {}
    return r;
  });
  register("certificates:issueMembership", (code: string) => data.certificates.issueMembership(code, actor().id));
  register("certificates:issueResidence", (familyNum: string, issuedTo: string) => data.certificates.issueResidence(familyNum, issuedTo, actor().id));
  register("certificates:issueMarriage", (marriageNum: string) => data.certificates.issueMarriage(marriageNum, actor().id));
  register("certificates:issueMarriageNoc", (marriageNum: string) => data.certificates.issueMarriageNoc(marriageNum, actor().id));
  register("certificates:issueDeath", (deathNum: string) => data.certificates.issueDeath(deathNum, actor().id));
  register("users:list", () => { admin(); return data.users.list(); });
  register("users:create", (d: any) => { const a = admin(); validatePassword(String(d?.password ?? "")); return data.users.create(d, a.role); });
  register("users:update", (id: number, d: any) => { admin(); return data.users.update(id, d); });
  register("users:toggleLock", (id: number, locked: boolean) => { admin(); return data.users.toggleLock(id, locked); });
  register("users:resetPassword", (id: number, p: string) => { const a = admin(); validatePassword(p); changePassword(id, p); try { data.audit.log(a.id, a.username, "PASSWORD_RESET", "users", id, "Administrator reset user password", ""); } catch {} return { success: true }; });
  register("users:remove", (id: number) => { admin(); return data.users.remove(id); });
  register("audit:list", (filter: any) => { actor(); return data.audit.list(filter || {}); });
  register("audit:verify", () => { actor(); return data.audit.verify(); });
  register("settings:load", () => { actor(); return data.settings.load(); });
  register("settings:save", (d: any) => { const a = admin(); return data.settings.save({ ...d, updatedBy: a.id }); });
  // Read-side IPC guards — every handler below requires an authenticated actor.
  // The renderer-side ProtectedLayout already redirects unauthenticated users to
  // /login, but defence-in-depth: if an attacker drops XSS into the renderer or
  // calls window.mms.* directly from devtools, the main process must still refuse.
  register("families:list", (filter: any) => { actor(); return data.families.list(filter || {}); });
  register("families:get", (id: number) => { actor(); return data.families.get(id); });
  register("members:list", (filter: any) => { actor(); return data.members.list(filter || {}); });
  register("members:get", (id: number) => { actor(); return data.members.get(id); });
  register("members:relationships", () => { actor(); return data.members.relationships(); });
  register("members:relations", (id: number) => { actor(); return data.members.relations(id); });
  register("subscriptions:list", (filter: any) => { actor(); return data.subscriptions.list(filter || {}); });
  register("subscriptions:get", (id: number) => { actor(); return data.subscriptions.get(id); });
  register("subscriptions:markOverdue", () => { actor(); return data.subscriptions.markOverdue(); });
  // Fail-closed fallback for the factory reset — password still verified here.
  register("system:clearAllData", (reason: string, adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    const r = data.clearAllData(String(reason ?? ""));
    try { data.audit.log(a.id, a.username, "CLEAR_ALL_DATA", "settings", 0, `ALL RECORDS ERASED (${r.cleared.length} tables) — the app was factory-reset for production. Reason: ${String(reason ?? "").trim()}`, String(reason ?? "").trim()); } catch {}
    return r;
  });
  register("subscriptions:totalCollected", () => { actor(); return data.subscriptions.totalCollected(); });
  register("subscriptions:totalPending", () => { actor(); return data.subscriptions.totalPending(); });
  register("subscriptions:plans", () => { actor(); return data.subscriptions.plans(); });
  register("subscriptions:ensureCurrentMonth", () => { actor(); return data.subscriptions.ensureCurrentMonth(); });
  register("donations:list", (filter: any) => { actor(); return data.donations.list(filter || {}); });
  register("donations:get", (id: number) => { actor(); return data.donations.get(id); });
  register("donations:categories", () => { actor(); return data.donations.categories(); });
  register("donations:categoriesAll", () => { actor(); return data.donations.categoriesAll(); });
  register("donations:createCategory", (name: string, description: string) => { admin(); return data.donations.createCategory(name, description); });
  register("donations:updateCategory", (id: number, name: string, description: string) => { admin(); return data.donations.updateCategory(id, name, description); });
  register("donations:setCategoryActive", (id: number, active: boolean) => { admin(); return data.donations.setCategoryActive(id, active); });
  register("donations:removeCategory", (id: number) => { admin(); return data.donations.removeCategory(id); });
  register("donations:memberBalance", (familyId: number, memberId: number) => { actor(); return data.donations.memberBalance(familyId, memberId); });
  register("donations:totalThisMonth", () => { actor(); return data.donations.totalThisMonth(); });
  register("accounting:list", (filter: any) => { actor(); return data.accounting.list(filter || {}); });
  register("accounting:get", (id: number) => { actor(); return data.accounting.get(id); });
  register("accounting:totalIncome", () => { actor(); return data.accounting.totalIncome(); });
  register("accounting:totalExpense", () => { actor(); return data.accounting.totalExpense(); });
  register("accounting:balance", () => { actor(); return data.accounting.balance(); });
  // Unified ledger — auto-aggregates donations, subscriptions (paid), welfare
  // disbursements, staff salary payments, plus manual transactions. Supports
  // period presets (all/this_month/last_month/this_quarter/last_quarter/
  // this_year/last_year/custom) and source filter.
  register("accounting:unifiedList", (filter: any) => { actor(); return data.accounting.unifiedList(filter || {}); });
  register("accounting:unifiedSummary", (filter: any) => { actor(); return data.accounting.unifiedSummary(filter || {}); });
  // Double-click preview: the full underlying record (whichever module the
  // ledger row came from) plus its change history (record_history diffs) and
  // the audit trail rows — everything needed to show "what was edited, by
  // whom, when and why" in one dialog.
  register("accounting:detail", (source: string, id: number) => { actor(); return data.accounting.unifiedDetail(String(source || ""), Number(id)); });
  register("marriages:list", (filter: any) => { actor(); return data.marriages.list(filter || {}); });
  register("marriages:get", (id: number) => { actor(); return data.marriages.get(id); });
  register("deaths:list", (filter: any) => { actor(); return data.deaths.list(filter || {}); });
  register("deaths:get", (id: number) => { actor(); return data.deaths.get(id); });
  register("certificates:list", (filter: any) => { actor(); return data.certificates.list(filter || {}); });
  // Anti-forgery verification — every scan/lookup is recorded in the tamper-
  // evident audit log (who checked, which code, and what was found), so a
  // forgery investigation has a trail of every check performed.
  register("certificates:verify", (code: string) => {
    const a = actor();
    const result = data.certificates.verify(code);
    try {
      const label = result?.valid
        ? (result.kind === "RECEIPT"
          ? `Receipt ${result.receipt?.receipt_number} (${result.receipt?.payer})`
          : `Certificate ${result.certificate?.certificate_number} (${result.certificate?.issued_to})`)
        : "no matching record";
      data.audit.log(a.id, a.username, "VERIFY", "certificates", 0, `Verification lookup: ${String(code || "").trim().toUpperCase()} → ${label}`, "");
    } catch { /* audit failure must never block a verification */ }
    return result;
  });
  register("certificates:verifyQr", (payload: string) => {
    const a = actor();
    const result = data.certificates.verifyQr(payload);
    try {
      const reason = result?.valid ? "valid" : String(result?.reason || "invalid");
      const kind = result?.kind || "unknown";
      data.audit.log(a.id, a.username, "VERIFY_QR", "certificates", 0, `QR verification (${kind}): ${reason}`, "");
    } catch { /* audit failure must never block a verification */ }
    return result;
  });
  register("dashboard:summary", () => { actor(); return data.dashboard.summary(); });
  register("dashboard:incomeThisMonth", () => { actor(); return data.dashboard.incomeThisMonth(); });
  register("dashboard:expenseThisMonth", () => { actor(); return data.dashboard.expenseThisMonth(); });
  register("dashboard:balance", () => { actor(); return data.dashboard.balance(); });
  register("dashboard:monthlyCollections", (m?: number) => { actor(); return data.dashboard.monthlyCollections(m || 6); });
  register("dashboard:monthlyDonations", (m?: number) => { actor(); return data.dashboard.monthlyDonations(m || 6); });
  register("dashboard:incomeVsExpense", (m?: number) => { actor(); return data.dashboard.incomeVsExpense(m || 6); });
  register("dashboard:recentActivity", (l?: number) => { actor(); return data.dashboard.recentActivity(l || 10); });
  register("dashboard:alerts", () => { actor(); return data.dashboard.alerts(); });
  register("tokens:listEvents", () => { actor(); return data.tokens.listEvents(); });
  register("tokens:getEvent", (id: number) => { actor(); return data.tokens.getEvent(id); });
  register("tokens:list", (filter: any) => { actor(); return data.tokens.list(filter || {}); });
  register("tokens:checkExisting", (eventId: number) => { actor(); return Array.from(data.tokens.checkExisting(eventId)); });
  register("tokens:stats", (eventId: number) => { actor(); return data.tokens.stats(eventId); });
  register("tokens:createEvent", (d: any) => { actor(); return data.tokens.createEvent(d); });
  register("tokens:updateEvent", (id: number, d: any) => { actor(); return data.tokens.updateEvent(id, d); });
  register("tokens:generate", (eventId: number, familyIds: number[]) => data.tokens.generate(eventId, familyIds, actor().id));
  register("tokens:collect", (tokenId: number) => data.tokens.collect(tokenId, actor().id));
  register("tokens:cancel", (tokenId: number, reason: string) => { actor(); return data.tokens.cancel(tokenId, reason); });
  register("tokens:replace", (tokenId: number, reason: string) => data.tokens.replace(tokenId, reason, actor().id));
  // Delete a single token — Administrator only, and only AFTER the event date
  // has passed (mirrors the UI gate server-side so a tampered renderer can't
  // bypass it). The audit row is written in the SAME transaction as the
  // deletion so a missing audit can never be silently ignored (V009 intent).
  register("tokens:remove", (tokenId: number, reason: string) => {
    const a = admin();
    const db = getDB();
    const row = db.prepare(
      `SELECT ta.id, e.event_date FROM token_assignments ta
         LEFT JOIN token_events e ON e.id = ta.event_id
       WHERE ta.id = ?`
    ).get(tokenId) as { id: number; event_date: string | null } | undefined;
    if (!row) throw new Error("Token not found");
    const today = todayIST();
    if (!row.event_date || row.event_date >= today) {
      throw new Error("Tokens can only be deleted after the event date has passed");
    }
    if (!reason?.trim()) throw new Error("A deletion reason is required");
    db.transaction(() => {
      // The event date is over (checked above), so the DB guard trigger
      // (token-guard.ts) allows this delete through — it only blocks
      // tokens of events that have not happened yet. The audit row is
      // written in the SAME transaction as the deletion so a missing
      // audit can never be silently ignored (V009 intent).
      db.prepare("DELETE FROM token_assignments WHERE id = ?").run(tokenId);
      data.audit.log(a.id, a.username, "DELETE", "tokens", tokenId, `Token deleted: ${reason.trim()}`, "");
    })();
    return { success: true };
  });
  // Delete a whole token event — Administrator only, with a reason, and
  // ONLY after the event date is over: a completed event is a spent
  // record (no need to keep), while an upcoming one is protected.
  // data.tokens.removeEvent enforces the date rule, and the DB triggers
  // (token-guard.ts) block the delete even for a tampered renderer or an
  // external editor.
  register("tokens:removeEvent", (id: number, reason: string) => {
    const a = admin();
    return data.tokens.removeEvent(id, reason, { id: a.id, username: a.username });
  });

  // ================= STAFF =================
  // All staff read operations require an authenticated user; archive/restore
  // and salary payments require Administrator (financial impact).
  register("staff:list", (filter: any) => { actor(); return data.staff.list(filter || {}); });
  register("staff:get", (id: number) => { actor(); return data.staff.get(id); });
  register("staff:roles", () => { actor(); return data.staff.roles(); });
  register("staff:create", (d: any) => { const a = actor(); const r = data.staff.create({ ...d, createdBy: a.id }); try { data.audit.log(a.id, a.username, "ADD", "staff", r.id, `Staff ${r.staffCode} created (${d.role || 'Staff'})`, ""); } catch {} return r; });
  register("staff:update", (id: number, d: any) => { const a = actor(); const r = data.staff.update(id, d); try { data.audit.log(a.id, a.username, "EDIT", "staff", id, `Staff updated: ${d.name || ''}`, ""); } catch {} return r; });
  register("staff:archive", (id: number, reason: string) => { const a = admin(); const r = data.staff.archive(id, reason, a.id); try { data.audit.log(a.id, a.username, "ARCHIVE", "staff", id, `Staff archived: ${reason}`, ""); } catch {} return r; });
  // Resignation / expulsion is a SECURE action: effective date + reason +
  // administrator password re-verified in the main process.
  register("staff:setStatus", (id: number, status: "Resigned" | "Expelled", effectiveDate: string, reason: string, adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    if (!reason || !String(reason).trim()) throw new Error("A reason is required");
    const r = data.staff.setStatus(id, status, effectiveDate || "", String(reason).trim(), a.id);
    try { data.audit.log(a.id, a.username, status === "Expelled" ? "EXPEL" : "RESIGN", "staff", id, `Staff ${status === "Expelled" ? "expelled" : "resigned"} effective ${effectiveDate || "today"}: ${String(reason).trim()}`, String(reason).trim()); } catch {}
    return r;
  });
  register("staff:restore", (id: number) => { const a = admin(); const r = data.staff.restore(id, a.id); try { data.audit.log(a.id, a.username, "RESTORE", "staff", id, `Staff restored`, ""); } catch {} return r; });
  register("staff:history", (id: number) => { actor(); return data.staff.history(id); });
  register("staff:listPayments", (filter: any) => { actor(); return data.staff.listPayments(filter || {}); });
  register("staff:paySalary", (d: any) => { const a = admin(); const r = data.staff.paySalary(d, a.id); try { data.audit.log(a.id, a.username, "PAY_SALARY", "staff", d.staffId, `Salary paid: ${d.amount} for ${d.periodMonth}/${d.periodYear}`, ""); } catch {} return r; });
  // Cancelling a salary payment is a SECURE action: reason + admin password
  // re-verified in the main process.
  register("staff:cancelPayment", (id: number, reason = "", adminPassword: string) => {
    const a = admin();
    verifyCurrentActorPassword(String(adminPassword ?? ""));
    if (!String(reason).trim()) throw new Error("A cancellation reason is required");
    const r = data.staff.cancelPayment(id);
    try { data.audit.log(a.id, a.username, "CANCEL_SALARY", "staff_payments", id, `Salary payment cancelled: ${String(reason).trim()}`, String(reason).trim()); } catch {}
    return r;
  });
  register("staff:salarySummary", (year?: number) => { actor(); return data.staff.salarySummary(year || new Date().getFullYear()); });

  // ================= COMMITTEE =================
  // Committee members are elected/nominated representatives (distinct from Staff).
  // Reads require an authenticated user; archive/restore require Administrator.
  register("committee:list", (filter: any) => { actor(); return data.committee.list(filter || {}); });
  register("committee:get", (id: number) => { actor(); return data.committee.get(id); });
  register("committee:positions", () => { actor(); return data.committee.positions(); });
  register("committee:types", () => { actor(); return data.committee.types(); });
  register("committee:summary", () => { actor(); return data.committee.summary(); });
  register("committee:create", (d: any) => { const a = actor(); const r = data.committee.create({ ...d, createdBy: a.id }); try { data.audit.log(a.id, a.username, "ADD", "committee", r.id, `Committee ${r.committeeCode} created (${d.position || 'Committee Member'})`, ""); } catch {} return r; });
  register("committee:update", (id: number, d: any) => { const a = actor(); const r = data.committee.update(id, d); try { data.audit.log(a.id, a.username, "EDIT", "committee", id, `Committee updated: ${d.name || ''}`, ""); } catch {} return r; });
  register("committee:archive", (id: number, reason: string) => { const a = admin(); const r = data.committee.archive(id, reason, a.id); try { data.audit.log(a.id, a.username, "ARCHIVE", "committee", id, `Committee archived: ${reason}`, ""); } catch {} return r; });
  register("committee:restore", (id: number) => { const a = admin(); const r = data.committee.restore(id, a.id); try { data.audit.log(a.id, a.username, "RESTORE", "committee", id, `Committee restored`, ""); } catch {} return r; });
  register("committee:history", (id: number) => { actor(); return data.committee.history(id); });
}
