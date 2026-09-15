import { randomBytes } from "node:crypto";
import { getDB } from "../db/connection.js";
import {
  startEngine, maybeStartEngine, stopEngine, currentQr, engineState,
  requireConnectedSocket, resolveJid, engineSendText, engineSendDocument,
  clearLegacyWahaData, onDelivery, isDelivered, waitForDelivery, whatsappStoreDir,
} from "./whatsapp-engine.service.js";
import { SendThrottle } from "./whatsapp-throttle.js";
import {
  generateDonationReceiptPdf, generateSubscriptionReceiptPdf,
  receiptSendState, markReceiptAccepted, markReceiptDelivered,
  markReceiptDeliveredByMsgId, consumeAdminResend,
} from "./receipt.service.js";
import { verifyCurrentActorPassword } from "./auth.service.js";
import { audit } from "./data.service.js";
import { fmtDdMmYyyy, monthLabel } from "./ist-date.js";
import { fileNameSafe } from "./doc-number.service.js";

type WhatsAppStatus = "NOT_CONFIGURED" | "STARTING" | "QR_REQUIRED" | "CONNECTED" | "DISCONNECTED" | "OFFLINE" | "ERROR";

type SendResult = { success: boolean; status: string; error?: string; providerMessageId?: string };

// ---------------------------------------------------------------------------
// Schema — unchanged from the WAHA era so existing installs upgrade in place.
// `api_key` is no longer used by the in-process engine (no local HTTP API) but
// stays NOT NULL for schema compatibility; it keeps a random filler value.
// ---------------------------------------------------------------------------
function ensureSchema() {
  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_key TEXT NOT NULL,
      session_name TEXT NOT NULL DEFAULT 'mahallu',
      connected_number TEXT DEFAULT '',
      connected_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
      last_error TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_type TEXT NOT NULL,
      recipient_name TEXT DEFAULT '',
      recipient_phone TEXT NOT NULL,
      family_id INTEGER,
      donation_id INTEGER,
      subscription_id INTEGER,
      message_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT DEFAULT '',
      provider_message_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_recipient ON whatsapp_messages(recipient_phone, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_donation ON whatsapp_messages(donation_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_type TEXT NOT NULL,
      period_key TEXT DEFAULT '',
      message_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      family_id INTEGER,
      recipient_name TEXT DEFAULT '',
      recipient_phone TEXT NOT NULL,
      message_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT DEFAULT '',
      provider_message_id TEXT DEFAULT '',
      sent_at TEXT,
      FOREIGN KEY(campaign_id) REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_whatsapp_campaign_recipient ON whatsapp_campaign_recipients(campaign_id, status);
  `);
  const columns = new Set((db.prepare("PRAGMA table_info(families)").all() as any[]).map(c => c.name));
  if (!columns.has("whatsapp_phone")) db.exec("ALTER TABLE families ADD COLUMN whatsapp_phone TEXT DEFAULT ''");
  if (!columns.has("whatsapp_enabled")) db.exec("ALTER TABLE families ADD COLUMN whatsapp_enabled INTEGER NOT NULL DEFAULT 1");
  // ToS acknowledgment — the WhatsApp page requires an explicit "I accept the
  // ban risk" tick before the FIRST pairing; the timestamp lives here.
  const waCols = new Set((db.prepare("PRAGMA table_info(whatsapp_settings)").all() as any[]).map(c => c.name));
  if (!waCols.has("tos_ack_at")) db.exec("ALTER TABLE whatsapp_settings ADD COLUMN tos_ack_at TEXT DEFAULT ''");
  // Why a campaign auto-paused ("hourly safety cap reached", WhatsApp 429…).
  const campCols = new Set((db.prepare("PRAGMA table_info(whatsapp_campaigns)").all() as any[]).map(c => c.name));
  if (!campCols.has("pause_reason")) db.exec("ALTER TABLE whatsapp_campaigns ADD COLUMN pause_reason TEXT DEFAULT ''");
  const row = db.prepare("SELECT * FROM whatsapp_settings WHERE id = 1").get() as any;
  if (!row) {
    db.prepare("INSERT INTO whatsapp_settings (id, api_key, session_name) VALUES (1, ?, ?)").run(randomBytes(32).toString("hex"), "mahallu");
  }
}

// Anti-ban pacing for bulk campaigns — random 5–10 s gaps and a 4-minute
// rest every 20 messages. No hard volume caps: the mahallu decides its own
// volume, the human-like pacing is what protects the number. Counters
// persist in <userData>/whatsapp/throttle.json so an app restart cannot
// skip a due rest or reset the pacing clock.
const sendThrottle = new SendThrottle({ storeDir: whatsappStoreDir });

function normalizePhone(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

// ---------------------------------------------------------------------------
// Connectivity probe — real internet reachability, cached. The messaging
// engine runs in-process, so there is no local service to conflate with the
// network anymore; "internet" simply means the public probes answer.
// ---------------------------------------------------------------------------
const INTERNET_PROBES = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
];
const INTERNET_OK_TTL_MS = 30_000;   // cache a positive answer for half a minute
const INTERNET_FAIL_TTL_MS = 8_000;  // re-probe failures sooner
let internetCache: { value: boolean; at: number } | null = null;

async function checkInternet(): Promise<boolean> {
  const now = Date.now();
  const ttl = internetCache?.value ? INTERNET_OK_TTL_MS : INTERNET_FAIL_TTL_MS;
  if (internetCache && now - internetCache.at < ttl) return internetCache.value;
  let value = false;
  for (const url of INTERNET_PROBES) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: "*/*" } });
      if (response.ok || response.status === 204) { value = true; break; }
    } catch { /* try the next probe */ }
  }
  internetCache = { value, at: now };
  return value;
}

async function requireInternet(): Promise<void> {
  if (!(await checkInternet())) throw new Error("No internet connection. Check your network and try again.");
}

/** Sending requires a paired, working session. Without this pre-check an
 *  unpaired app surfaces protocol noise instead of guidance. */
function requirePairedSession() {
  requireConnectedSocket();
}

function updateStatus(status: WhatsAppStatus, error = "") {
  ensureSchema();
  getDB().prepare("UPDATE whatsapp_settings SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = 1").run(status, error.slice(0, 1000));
}

function saveMessage(input: { type: string; name?: string; phone: string; text: string; status?: string; familyId?: number | null; donationId?: number | null; subscriptionId?: number | null; error?: string; providerId?: string }) {
  const db = getDB();
  const result = db.prepare(`INSERT INTO whatsapp_messages (message_type, recipient_name, recipient_phone, family_id, donation_id, subscription_id, message_text, status, error_message, provider_message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'SENT' THEN datetime('now') ELSE NULL END)`).run(input.type, input.name || "", input.phone, input.familyId ?? null, input.donationId ?? null, input.subscriptionId ?? null, input.text, input.status || "PENDING", input.error || "", input.providerId || "", input.status || "PENDING");
  return Number(result.lastInsertRowid);
}

async function sendTextInternal(phone: string, text: string): Promise<{ id?: string }> {
  requirePairedSession();
  const jid = await resolveJid(phone);
  return engineSendText(jid, text);
}

/** Send a PDF with a text caption and log it in the message history.
 *  Returns the provider message id. Receipt LOCK tracking is handled by
 *  sendReceiptWithLock() — this plain variant is for non-receipt documents. */
async function sendDocumentInternal(input: {
  phone: string; text: string; pdf: Buffer; fileName: string;
  type: string; name?: string; familyId?: number | null; donationId?: number | null;
}): Promise<{ id: string }> {
  requirePairedSession();
  const jid = await resolveJid(input.phone);
  const result = await engineSendDocument(jid, input.pdf, input.fileName, input.text);
  saveMessage({ type: input.type, name: input.name, phone: input.phone, text: input.text, status: "SENT", familyId: input.familyId, donationId: input.donationId, providerId: result.id });
  return result;
}

function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function dayKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

// How long a send waits for the recipient's delivery receipt before
// reporting "sent — delivery not confirmed yet". Delivery usually lands in
// a couple of seconds; the receipt stays sendable until it does, so a slow
// confirmation never locks the family out of their receipt.
const DELIVERY_WAIT_MS = 15_000;

// One shared send+track routine for receipt PDFs (the privacy lock lives
// here): gate → send → record acceptance → wait for the delivery receipt →
// flip the lock only on real delivery.
async function sendReceiptWithLock(input: {
  kind: "donation" | "subscription";
  rowId: number;              // donation id · subscription LEDGER payment id
  phone: string; text: string; pdf: Buffer; fileName: string;
  messageType: string; name?: string; familyId?: number | null; donationId?: number;
}): Promise<{ msgId: string; delivered: boolean }> {
  requirePairedSession();
  const jid = await resolveJid(input.phone);
  const result = await engineSendDocument(jid, input.pdf, input.fileName, input.text);
  const msgId = String(result.id || "");
  saveMessage({
    type: input.messageType, name: input.name, phone: input.phone, text: input.text,
    status: "SENT", familyId: input.familyId, donationId: input.donationId, providerId: msgId,
  });
  markReceiptAccepted(input.kind, input.rowId, msgId);
  const delivered = await waitForDelivery(msgId, DELIVERY_WAIT_MS);
  if (delivered) markReceiptDelivered(input.kind, input.rowId);
  return { msgId, delivered };
}

/** Privacy gate — decides whether this receipt may leave the app at all.
 *  Returns why not (for the toast / soft status); `adminPassword` unlocks the
 *  ONE re-send a delivered receipt ever gets, verified + audited here in the
 *  main process (the renderer's word is never enough). */
function gateReceiptSend(
  kind: "donation" | "subscription",
  rowId: number,
  adminPassword?: string
): { ok: true; isResend: boolean } | { ok: false; reason: "delivered" | "resend-used"; message: string } {
  const state = receiptSendState(kind, rowId);
  if (!state.delivered) return { ok: true, isResend: false };
  if (!adminPassword) {
    return {
      ok: false,
      reason: "delivered",
      message: "This receipt was already sent and delivered to the recipient. It is locked to protect their privacy — an administrator can re-send it once with the admin password.",
    };
  }
  // Administrator re-send: verify the password (throws on wrong password,
  // non-admin actor etc.) and spend the single re-send credit.
  const verified = verifyCurrentActorPassword(String(adminPassword));
  if (state.resends >= 1) {
    return {
      ok: false,
      reason: "resend-used",
      message: "The one administrator re-send for this receipt was already used. The receipt stays with the recipient.",
    };
  }
  consumeAdminResend(kind, rowId);
  // Tamper-evident audit trail: WHO unlocked the re-send, for which receipt.
  try {
    audit.log(
      verified.id, verified.username, "ADMIN_RESEND", "whatsapp", rowId,
      `Administrator re-send authorized for a delivered ${kind === "donation" ? "donation" : "subscription"} receipt (row #${rowId})`,
      ""
    );
  } catch { /* audit is best-effort; the resend counter is authoritative */ }
  return { ok: true, isResend: true };
}

function withTransaction(fn: () => void) {
  const db = getDB();
  // Real better-sqlite3 exposes db.transaction(); fall back to manual
  // BEGIN/COMMIT for environments where it is unavailable.
  if (typeof (db as any).transaction === "function") {
    (db as any).transaction(fn)();
    return;
  }
  db.exec("BEGIN");
  try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
}

async function runQueue(campaignId: number) {
  const db = getDB();
  db.prepare("UPDATE whatsapp_campaigns SET status = 'RUNNING', started_at = datetime('now') WHERE id = ?").run(campaignId);
  const rows = db.prepare("SELECT * FROM whatsapp_campaign_recipients WHERE campaign_id = ? AND status = 'PENDING' ORDER BY id").all(campaignId) as any[];
  let sent = 0, failed = 0, skipped = 0;
  const pauseCampaign = (reason: string) => {
    db.prepare("UPDATE whatsapp_campaigns SET status='PAUSED', pause_reason=?, sent_count=?, failed_count=?, skipped_count=? WHERE id=?").run(reason.slice(0, 300), sent, failed, skipped, campaignId);
    return { sent, failed, skipped, paused: true, pausedReason: reason.slice(0, 300) };
  };
  for (const r of rows) {
    // Anti-ban pacing: every message waits a random 5–10 s gap (long rest
    // every 20). No volume caps — pacing only; the campaign still PAUSES
    // when WhatsApp itself signals a rate limit (caught below).
    await sendThrottle.beforeSend();
    try {
      const result = await sendTextInternal(r.recipient_phone, r.message_text);
      sendThrottle.recordSent();
      db.prepare("UPDATE whatsapp_campaign_recipients SET status='SENT', provider_message_id=?, sent_at=datetime('now') WHERE id=?").run(result.id || "", r.id);
      saveMessage({ type: r.campaign_type || "BULK", name: r.recipient_name, phone: r.recipient_phone, text: r.message_text, status: "SENT", familyId: r.family_id, providerId: result.id });
      sent++;
    } catch (err: any) {
      const message = String(err?.message || err);
      db.prepare("UPDATE whatsapp_campaign_recipients SET status='FAILED', error_message=? WHERE id=?").run(message, r.id);
      saveMessage({ type: "BULK", name: r.recipient_name, phone: r.recipient_phone, text: r.message_text, status: "FAILED", familyId: r.family_id, error: message });
      failed++;
      if (/timelock|capp|429|rate|too many|463|precondition|428/i.test(message)) {
        return pauseCampaign("WhatsApp signalled a rate limit on its side — the campaign paused to protect the number. Resume later with Retry.");
      }
    }
  }
  db.prepare("UPDATE whatsapp_campaigns SET status='COMPLETED', sent_count=?, failed_count=?, skipped_count=?, completed_at=datetime('now') WHERE id=?").run(sent, failed, skipped, campaignId);
  return { sent, failed, skipped, paused: false, pausedReason: "" };
}

// The family head's WhatsApp number: the dedicated field when set, otherwise
// the family's primary phone (kept practical for mahallu records where the
// head's phone and WhatsApp number are the same). whatsapp_enabled stays the
// explicit opt-out for bulk messaging either way.
const FAMILY_PHONE_SQL = `COALESCE(NULLIF(TRIM(f.whatsapp_phone), ''), NULLIF(TRIM(f.phone), ''))`;

export const whatsapp = {
  init: () => {
    ensureSchema();
    clearLegacyWahaData();
    // LATE DELIVERY: WhatsApp confirms delivery whenever the recipient's
    // phone comes online — minutes or hours after we sent. Every
    // confirmation is mapped back to its receipt row and flips the send-lock
    // at that moment (the "only when actually delivered" privacy rule).
    onDelivery((msgId) => markReceiptDeliveredByMsgId(msgId));
  },
  status: async () => {
    ensureSchema();
    const internet = await checkInternet();
    // A paired session logs back in silently at app start / after drops.
    maybeStartEngine();
    const snap = engineState();
    const tosAcked = !!String((getDB().prepare("SELECT tos_ack_at FROM whatsapp_settings WHERE id=1").get() as any)?.tos_ack_at || "");
    const throttle = sendThrottle.snapshot();

    // The one truthful case for OFFLINE: the machine itself has no internet.
    if (!internet) {
      updateStatus("OFFLINE", "No internet connection");
      return { status: "OFFLINE", connected: false, internet, service: snap.connected ? "RUNNING" : "", number: snap.number, name: snap.name, message: "No internet connection. Check your network and try again.", tosAcked, throttle };
    }

    switch (snap.state) {
      case "CONNECTED": {
        getDB().prepare("UPDATE whatsapp_settings SET connected_number=?, connected_name=?, status='CONNECTED', last_error='', updated_at=datetime('now') WHERE id=1").run(snap.number, snap.name);
        return { status: "CONNECTED", connected: true, internet, service: "RUNNING", number: snap.number, name: snap.name, message: "WhatsApp connected", tosAcked, throttle };
      }
      case "QR_REQUIRED": {
        updateStatus("QR_REQUIRED");
        return { status: "QR_REQUIRED", connected: false, internet, service: "RUNNING", number: "", name: "", message: "Scan the QR code to connect WhatsApp", tosAcked, throttle };
      }
      case "CONNECTING":
      case "RECONNECTING": {
        updateStatus("STARTING", "");
        return { status: "STARTING", connected: false, internet, service: "STARTING", number: "", name: "", message: snap.state === "RECONNECTING" ? "WhatsApp connection was lost — reconnecting…" : "WhatsApp is connecting…", tosAcked, throttle };
      }
      default: {
        // IDLE — no live socket. A paused-but-paired machine (Quit the app or
        // pressed Pause) resumes WITHOUT a new QR scan; say so instead of
        // implying the pairing was lost. Unpaired machines rest here too.
        const message = snap.lastError
          ? `WhatsApp is not connected. ${snap.lastError}`
          : snap.hasSession
            ? "WhatsApp is paused — press Connect to resume. Your pairing is kept; no new QR scan is needed."
            : "WhatsApp is not connected yet. Use the Connect button to pair a phone.";
        updateStatus("DISCONNECTED", snap.lastError);
        return { status: "DISCONNECTED", connected: false, internet, service: "", number: "", name: "", message, tosAcked, throttle };
      }
    }
  },
  connect: async (opts: { acknowledged?: boolean } = {}) => {
    ensureSchema();
    // ToS CONSENT GATE — pairing uses an unofficial connection and carries a
    // real ban risk for the paired number. The first pairing requires an
    // explicit acknowledgment (the WhatsApp page's checkbox); once stored,
    // later connections (resumes after Pause, app restarts) don't re-ask.
    const settings = getDB().prepare("SELECT tos_ack_at FROM whatsapp_settings WHERE id=1").get() as any;
    if (!String(settings?.tos_ack_at || "")) {
      if (!opts.acknowledged) {
        throw new Error("Before connecting, please read and accept the WhatsApp safety notice on this page (tick the box, then press Connect).");
      }
      getDB().prepare("UPDATE whatsapp_settings SET tos_ack_at = datetime('now') WHERE id = 1").run();
    }
    await requireInternet();
    // Explicit user action — bring the in-process engine up and give it a
    // moment to reach a meaningful state (QR available or logged in).
    await startEngine();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const snap = engineState();
      if (snap.state === "QR_REQUIRED" || snap.state === "CONNECTED") break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return { success: true };
  },
  acknowledgeToS: () => {
    ensureSchema();
    getDB().prepare("UPDATE whatsapp_settings SET tos_ack_at = datetime('now') WHERE id = 1").run();
    return { success: true };
  },
  qr: async () => {
    ensureSchema();
    return currentQr(25000);
  },
  disconnect: async () => {
    ensureSchema();
    // PAUSE, not logout: the engine stops but the paired device STAYS linked
    // on the phone, so Connect resumes without a new QR scan. (Unlinking is a
    // separate, deliberate action — see whatsapp.unlink.)
    await stopEngine();
    updateStatus("DISCONNECTED", "");
    return { success: true, keptPairing: true };
  },
  unlink: async () => {
    ensureSchema();
    // Full unlink: the device is removed from the phone's Linked Devices and
    // stored credentials are wiped — the next connection needs a fresh QR.
    await stopEngine({ logout: true });
    updateStatus("DISCONNECTED", "Device unlinked — scan the QR code again to reconnect");
    return { success: true, unlinked: true };
  },
  setFamilyWhatsApp: (familyId: number, phone: string, enabled: boolean) => {
    ensureSchema();
    const normalized = phone ? normalizePhone(phone) : "";
    if (phone && !normalized) throw new Error("Enter a valid WhatsApp number");
    return getDB().prepare("UPDATE families SET whatsapp_phone=?, whatsapp_enabled=? WHERE id=?").run(normalized, enabled ? 1 : 0, familyId);
  },
  familyWhatsApp: (familyId: number) => {
    ensureSchema();
    return getDB().prepare("SELECT id, house_name, family_number, whatsapp_phone, phone, whatsapp_enabled, status FROM families WHERE id=?").get(familyId) as any;
  },
  checkNumber: async (phone: string) => {
    await requireInternet();
    requirePairedSession();
    const normalized = normalizePhone(phone);
    if (!normalized) return { available: false, reason: "WhatsApp number is missing or invalid" };
    try {
      const jid = await resolveJid(normalized);
      return { available: true, phone: String(jid).replace(/@.*$/, "") };
    } catch (err: any) {
      return { available: false, reason: String(err?.message || err) };
    }
  },
  sendMessage: async (input: { phone: string; name?: string; text: string; type?: string; familyId?: number; donationId?: number; subscriptionId?: number }) => {
    ensureSchema();
    const phone = normalizePhone(input.phone);
    if (!phone) throw new Error("WhatsApp number is missing or invalid");
    // OPT-OUT guard (defense in depth): campaigns already filter
    // whatsapp_enabled=1 at the SQL level; a direct send that names a family
    // must honour the family's opt-out too. Receipts stay exempt — they are
    // transactional one-to-one documents tied to a payment the family made.
    if (input.familyId) {
      const fam = getDB().prepare("SELECT whatsapp_enabled FROM families WHERE id=?").get(Number(input.familyId)) as any;
      if (fam && Number(fam.whatsapp_enabled) === 0) {
        throw new Error("This family has opted out of WhatsApp messages. Turn messaging back on in the family record first.");
      }
    }
    await requireInternet();
    requirePairedSession();
    const result = await sendTextInternal(phone, input.text);
    saveMessage({ type: input.type || "MESSAGE", name: input.name, phone, text: input.text, status: "SENT", familyId: input.familyId, donationId: input.donationId, subscriptionId: input.subscriptionId, providerId: result.id });
    return { success: true, providerMessageId: result.id || "" };
  },
  sendDonationReceipt: async (donationId: number, opts: { adminPassword?: string } = {}) => {
    ensureSchema();
    const d = getDB().prepare(`SELECT d.*, c.name AS category_name FROM donations d LEFT JOIN donation_categories c ON c.id=d.category_id WHERE d.id=?`).get(donationId) as any;
    if (!d) {
      console.error(`[whatsapp] donation receipt requested for id=${donationId} but the record does not exist`);
      throw new Error("Donation record not found. Refresh the donations page and try again.");
    }
    // PRIVACY GATE first: a receipt already DELIVERED to the donor is locked
    // (one admin-authorized re-send ever). Send attempts that never delivered
    // (offline / unpaired / not sent at entry time) stay open — send any time.
    const gate = gateReceiptSend("donation", donationId, opts.adminPassword);
    if (!gate.ok) throw new Error(gate.message);
    const phone = normalizePhone(String(d.donor_phone || ""));
    // 1. Generate and SAVE the A6 receipt in the app first — this works even
    //    when WhatsApp is not set up yet, so the record always has its PDF.
    const receipt = await generateDonationReceiptPdf(donationId);
    // 2. Sending needs a number, internet and a paired session (truthful
    //    pre-checks so the toast explains the real problem).
    if (!phone) throw new Error("No WhatsApp number saved for this donor. Add the donor's phone number in the donation record first.");
    await requireInternet();
    const settingsRow = getDB().prepare("SELECT mahallu_name, currency_symbol FROM settings WHERE id=1").get() as any;
    const currency = settingsRow?.currency_symbol || "₹";
    const text = `Assalamu Alaikum ${d.donor_name},\n\nYour donation receipt is attached.\n\nReceipt: ${d.receipt_number}\nAmount: ${currency}${Number(d.amount || 0).toLocaleString("en-IN")}\nCategory: ${d.category_name || "Donation"}\nDate: ${fmtDdMmYyyy(String(d.donation_date || ""))}\n${settingsRow?.mahallu_name ? `\n${settingsRow.mahallu_name}` : ""}\n\nJazakallahu Khairan.`;
    const result = await sendReceiptWithLock({
      kind: "donation", rowId: donationId,
      phone, text, pdf: receipt.buffer, fileName: `receipt-${fileNameSafe(receipt.receiptNumber || donationId)}.pdf`,
      messageType: "DONATION_RECEIPT", name: d.donor_name, donationId,
    });
    return {
      success: true, receiptSaved: true, receiptNumber: receipt.receiptNumber,
      providerMessageId: result.msgId, delivered: result.delivered,
      deliveredNote: result.delivered
        ? "Delivered to the recipient — the receipt is now locked (one admin re-send remains available)."
        : "Sent, but delivery is not confirmed yet (the phone may be offline). The receipt is NOT locked and can be sent again once you confirm it did not arrive.",
    };
  },
  sendSubscriptionReceipt: async (subscriptionId: number, opts: { soft?: boolean; adminPassword?: string } = {}) => {
    ensureSchema();
    const soft = !!opts.soft;
    const s = getDB().prepare(
      `SELECT s.*, f.house_name, f.family_number, ${FAMILY_PHONE_SQL} AS family_phone,
         (SELECT m.name FROM members m WHERE m.id = s.member_id) AS member_name
       FROM subscriptions s LEFT JOIN families f ON f.id = s.family_id WHERE s.id = ?`
    ).get(subscriptionId) as any;
    if (!s) {
      if (soft) return { status: "failed", error: "Subscription not found" };
      throw new Error("Subscription not found");
    }
    if (Number(s.amount_paid || 0) <= 0) {
      // Nothing paid — nothing to receipt (manual presses only reach here).
      if (soft) return { status: "skipped", error: "No payment recorded yet" };
      throw new Error("No payment recorded for this subscription yet. Record the payment first, then send the receipt.");
    }
    // PRIVACY GATE: delivered receipts are locked; the ledger payment row
    // owns the lock (the legacy subscription-mirror path has no lock — rows
    // from before the ledger era are treated as always sendable).
    const paymentId = (() => {
      const r = getDB()
        .prepare("SELECT id FROM subscription_payments WHERE subscription_id = ? AND period_start = ? AND status = 'Active' LIMIT 1")
        .get(subscriptionId, s.period_start) as { id: number } | undefined;
      return r ? Number(r.id) : null;
    })();
    if (paymentId) {
      const gate = gateReceiptSend("subscription", paymentId, opts.adminPassword);
      if (!gate.ok) {
        if (soft) return { status: "already-delivered", error: gate.message, receiptSaved: true };
        throw new Error(gate.message);
      }
    }
    // Always generate + store the A6 receipt (works without WhatsApp).
    let receipt: { buffer: Buffer; receiptNumber: string; paymentId: number | null };
    try {
      const r = await generateSubscriptionReceiptPdf(subscriptionId);
      receipt = { buffer: r.buffer, receiptNumber: r.receiptNumber, paymentId: r.paymentId ?? paymentId };
    } catch (err: any) {
      if (soft) return { status: "failed", error: String(err?.message || err) };
      throw err;
    }
    const phone = normalizePhone(String(s.family_phone || ""));
    const settingsRow = getDB().prepare("SELECT mahallu_name, currency_symbol FROM settings WHERE id=1").get() as any;
    const currency = settingsRow?.currency_symbol || "₹";
    // ---- The caption tells the money story: cash in, where it went
    // (old arrears → this month → advance), and what is still due after it.
    const ledger = receipt.paymentId
      ? (getDB().prepare("SELECT amount, arrears_cleared, advance_added FROM subscription_payments WHERE id = ?").get(receipt.paymentId) as any)
      : null;
    const cash = Number(ledger?.amount ?? s.amount_paid ?? 0);
    const arrearsCleared = Number(ledger?.arrears_cleared || 0);
    const advanceAdded = Number(ledger?.advance_added || 0);
    const monthPart = Math.max(0, Math.min(cash - arrearsCleared, Number(s.amount || 0)));
    const allocLines: string[] = [];
    if (arrearsCleared > 0) allocLines.push(`- ${currency}${arrearsCleared.toLocaleString("en-IN")} cleared previous months' balance`);
    if (monthPart > 0) allocLines.push(`- ${currency}${monthPart.toLocaleString("en-IN")} for this month`);
    if (advanceAdded > 0) allocLines.push(`- ${currency}${advanceAdded.toLocaleString("en-IN")} kept as advance for coming months`);
    const balance = Math.max(0, Number(s.arrears || 0) + Math.max(0, Number(s.amount || 0) - Number(s.amount_paid || 0)) - Number(s.advance || 0));
    const balanceLine = balance > 0
      ? `Balance due: ${currency}${balance.toLocaleString("en-IN")}${Number(s.arrears || 0) > 0 ? ` (incl. ${currency}${Number(s.arrears).toLocaleString("en-IN")} from previous months)` : ""}`
      : Number(s.advance || 0) > 0
        ? `Fully paid — ${currency}${Number(s.advance).toLocaleString("en-IN")} advance will reduce next month's due.`
        : "Fully paid.";
    const who = s.house_name || s.family_number || "Family";
    const text = `Assalamu Alaikum,\n\nPayment received — thank you.\n\nReceipt: ${s.receipt_number || receipt.receiptNumber}\nFamily: ${who}${s.family_number ? ` (${s.family_number})` : ""}\nMonth: ${monthLabel(String(s.period_start || ""))}\nAmount received: ${currency}${cash.toLocaleString("en-IN")}${allocLines.length ? `\n${allocLines.join("\n")}` : ""}\n${balanceLine}\nDate: ${fmtDdMmYyyy(String(s.payment_date || s.period_start || ""))}\n\nThe receipt (PDF) is attached.\n${settingsRow?.mahallu_name ? `\n${settingsRow.mahallu_name}` : ""}\n\nJazakallahu Khairan.`;
    // Soft mode (auto-send after a payment is recorded): report instead of
    // throwing — the payment itself must never fail because of messaging.
    if (soft) {
      if (!phone) return { status: "no-phone", error: "No WhatsApp number for this family" };
      const snap = engineState();
      if (!snap.connected) return { status: "not-connected", error: "WhatsApp is not connected", receiptSaved: true, receiptNumber: receipt.receiptNumber };
      try {
        const result = await sendReceiptWithLock({
          kind: "subscription", rowId: receipt.paymentId || 0,
          phone, text, pdf: receipt.buffer, fileName: `receipt-${fileNameSafe(receipt.receiptNumber || subscriptionId)}.pdf`,
          messageType: "SUBSCRIPTION_RECEIPT", name: s.member_name || who, familyId: s.family_id,
        });
        return { status: result.delivered ? "delivered" : "sent", providerMessageId: result.msgId, receiptSaved: true, receiptNumber: receipt.receiptNumber };
      } catch (err: any) {
        return { status: "failed", error: String(err?.message || err), receiptSaved: true, receiptNumber: receipt.receiptNumber };
      }
    }
    if (!phone) throw new Error("No WhatsApp number saved for this family. Add the family's phone or WhatsApp number first.");
    await requireInternet();
    const result = await sendReceiptWithLock({
      kind: "subscription", rowId: receipt.paymentId || 0,
      phone, text, pdf: receipt.buffer, fileName: `receipt-${fileNameSafe(receipt.receiptNumber || subscriptionId)}.pdf`,
      messageType: "SUBSCRIPTION_RECEIPT", name: s.member_name || who, familyId: s.family_id,
    });
    return {
      success: true, receiptSaved: true, receiptNumber: receipt.receiptNumber,
      providerMessageId: result.msgId, delivered: result.delivered,
      deliveredNote: result.delivered
        ? "Delivered to the recipient — the receipt is now locked (one admin re-send remains available)."
        : "Sent, but delivery is not confirmed yet (the phone may be offline). The receipt is NOT locked and can be sent again once you confirm it did not arrive.",
    };
  },
  createSubscriptionCampaign: async () => {
    ensureSchema();
    const key = monthKey();
    const existing = getDB().prepare("SELECT id,status FROM whatsapp_campaigns WHERE campaign_type='SUBSCRIPTION_REMINDER' AND period_key=? AND status IN ('PENDING','RUNNING','COMPLETED','PAUSED') LIMIT 1").get(key) as any;
    if (existing) throw new Error("The bulk subscription reminder has already been started for this month.");
    const rows = getDB().prepare(`SELECT f.id AS family_id, f.house_name, f.family_number, ${FAMILY_PHONE_SQL} AS whatsapp_phone, f.whatsapp_enabled, s.amount, s.amount_paid, s.arrears, s.advance, s.period_start, s.period_end, s.status AS subscription_status FROM families f JOIN subscriptions s ON s.family_id=f.id WHERE f.status='Active' AND COALESCE(f.whatsapp_enabled,0)=1 AND ${FAMILY_PHONE_SQL} <> '' AND s.status IN ('Pending','Partial','Overdue') ORDER BY f.family_number`).all() as any[];
    // TRUE dues (arrears + uncovered month − advance, per family, clamped
    // at 0) decide eligibility — a family that prepaid is NOT reminded.
    const eligible = rows.filter(r => {
      if (!normalizePhone(r.whatsapp_phone)) return false;
      const due = Math.max(0, Number(r.arrears || 0) + Math.max(0, Number(r.amount || 0) - Number(r.amount_paid || 0)) - Number(r.advance || 0));
      return due > 0;
    });
    if (!eligible.length) throw new Error("No eligible family heads with contact numbers were found.");
    const db = getDB();
    const campaign = db.prepare("INSERT INTO whatsapp_campaigns (campaign_type,period_key,message_text,total_recipients) VALUES ('SUBSCRIPTION_REMINDER',?,?,?)").run(key, "", eligible.length);
    const campaignId = Number(campaign.lastInsertRowid);
    const insert = db.prepare("INSERT INTO whatsapp_campaign_recipients (campaign_id,family_id,recipient_name,recipient_phone,message_text) VALUES (?,?,?,?,?)");
    const currency = (db.prepare("SELECT currency_symbol FROM settings WHERE id=1").get() as any)?.currency_symbol || "₹";
    const mahallu = (db.prepare("SELECT mahallu_name FROM settings WHERE id=1").get() as any)?.mahallu_name || "";
    withTransaction(() => {
      for (const r of eligible) {
        const rate = Number(r.amount || 0);
        const arrears = Number(r.arrears || 0);
        const advance = Number(r.advance || 0);
        const monthOpen = Math.max(0, rate - Number(r.amount_paid || 0));
        const due = Math.max(0, arrears + monthOpen - advance);
        // The reminder states the TRUE dues and where they come from — a
        // family missing several months sees the total and the old balance.
        const dueNote = arrears > 0
          ? `Amount due: ${currency}${due.toLocaleString("en-IN")} (${currency}${arrears.toLocaleString("en-IN")} from previous months + ${currency}${Math.max(0, due - arrears).toLocaleString("en-IN")} this month${advance > 0 ? `, less ${currency}${advance.toLocaleString("en-IN")} advance` : ""})`
          : `Amount due: ${currency}${due.toLocaleString("en-IN")}`;
        const text = `Assalamu Alaikum,\n\n${r.house_name || r.family_number || "Family"} — your subscription for ${monthLabel(String(r.period_start || key))} is pending.\n${dueNote}\n\nPlease pay at your convenience.${mahallu ? `\n\n${mahallu}` : ""}`;
        insert.run(campaignId, r.family_id, r.house_name || r.family_number || "Family Head", normalizePhone(r.whatsapp_phone), text);
      }
    });
    return { campaignId, total: eligible.length, month: key };
  },
  createAnnouncementCampaign: async (text: string) => {
    ensureSchema();
    const clean = String(text || "").trim();
    if (!clean) throw new Error("Announcement message cannot be empty");
    const key = dayKey();
    const existing = getDB().prepare("SELECT id FROM whatsapp_campaigns WHERE campaign_type='ANNOUNCEMENT' AND period_key=? AND status IN ('PENDING','RUNNING','COMPLETED','PAUSED') LIMIT 1").get(key) as any;
    if (existing) throw new Error("Today's bulk announcement has already been started.");
    const rows = getDB().prepare(`SELECT f.id, f.house_name, f.family_number, ${FAMILY_PHONE_SQL} AS whatsapp_phone FROM families f WHERE f.status='Active' AND COALESCE(f.whatsapp_enabled,0)=1 AND ${FAMILY_PHONE_SQL} <> '' ORDER BY f.family_number`).all() as any[];
    const eligible = rows.filter(r => normalizePhone(r.whatsapp_phone));
    if (!eligible.length) throw new Error("No eligible family heads with contact numbers were found.");
    const db = getDB();
    const campaign = db.prepare("INSERT INTO whatsapp_campaigns (campaign_type,period_key,message_text,total_recipients) VALUES ('ANNOUNCEMENT',?,?,?)").run(key, clean, eligible.length);
    const campaignId = Number(campaign.lastInsertRowid);
    const insert = db.prepare("INSERT INTO whatsapp_campaign_recipients (campaign_id,family_id,recipient_name,recipient_phone,message_text) VALUES (?,?,?,?,?)");
    withTransaction(() => { for (const r of eligible) insert.run(campaignId, r.id, r.house_name || r.family_number || "Family Head", normalizePhone(r.whatsapp_phone), clean); });
    return { campaignId, total: eligible.length, day: key };
  },
  runCampaign: async (campaignId: number) => {
    await requireInternet();
    requirePairedSession();
    const campaign = getDB().prepare("SELECT * FROM whatsapp_campaigns WHERE id=?").get(campaignId) as any;
    if (!campaign) throw new Error("Campaign not found");
    const result = await runQueue(campaignId);
    return { campaignId, ...result };
  },
  campaign: (id: number) => { ensureSchema(); return getDB().prepare("SELECT * FROM whatsapp_campaigns WHERE id=?").get(id); },
  campaigns: (limit = 30) => { ensureSchema(); return getDB().prepare("SELECT * FROM whatsapp_campaigns ORDER BY id DESC LIMIT ?").all(limit); },
  history: (limit = 100) => { ensureSchema(); return getDB().prepare("SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT ?").all(limit); },
  failedRecipients: (campaignId: number) => { ensureSchema(); return getDB().prepare("SELECT * FROM whatsapp_campaign_recipients WHERE campaign_id=? AND status='FAILED'").all(campaignId); },
  retryFailed: async (campaignId: number) => {
    ensureSchema();
    await requireInternet();
    requirePairedSession();
    getDB().prepare("UPDATE whatsapp_campaign_recipients SET status='PENDING', error_message='' WHERE campaign_id=? AND status='FAILED'").run(campaignId);
    return runQueue(campaignId);
  },
  // Compatibility snapshot for anything still reading runtimeState. The
  // in-process engine is always "installed"; state maps onto the old enum.
  runtimeState: () => {
    const snap = engineState();
    const mapped = snap.state === "CONNECTED" ? "RUNNING"
      : (snap.state === "CONNECTING" || snap.state === "RECONNECTING" || snap.state === "QR_REQUIRED") ? "STARTING"
      : "STOPPED";
    return { installed: true, state: mapped, running: snap.connected, starting: mapped === "STARTING", pid: null, lastError: snap.lastError, since: snap.since };
  },
  normalizePhone,
};

export { checkInternet };
