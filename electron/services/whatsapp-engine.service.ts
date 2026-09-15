// WhatsApp engine — in-process WhatsApp Web session via Baileys.
//
// Replaces the previously bundled WAHA gateway (a separate Node service with
// its own port, health checks and a browser-driven WhatsApp Web client that
// inflated the installer by hundreds of MB and introduced a whole class of
// spawn/ESM/firewall failures on end-user machines).
//
// Baileys speaks the WhatsApp Web "multi-device" protocol directly over a
// WebSocket — no browser, no child process, no local HTTP port. The session
// persists in <userData>/whatsapp/auth so one QR pairing survives restarts,
// and the socket reconnects automatically with backoff when the network drops.
//
// All Electron APIs are resolved lazily so importing this module from plain
// Node (vitest) is side-effect free.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestWaWebVersion,
  DisconnectReason,
  Browsers,
  proto,
} from "@whiskeysockets/baileys";
import type { WASocket, ConnectionState } from "@whiskeysockets/baileys";

const require = createRequire(import.meta.url);
function electron(): typeof import("electron") {
  return require("electron");
}

export type EngineState = "IDLE" | "CONNECTING" | "QR_REQUIRED" | "CONNECTED" | "RECONNECTING";

// Auto-(re)start guard: how long a failed automatic attempt blocks the next
// one. The UI polls status() every 6s — without this a persistently offline
// machine would retry the handshake forever.
const AUTO_START_BACKOFF_MS = 60_000;
// Cap for the reconnect backoff ladder (1s → 2s → 4s → … → 30s).
const MAX_RECONNECT_DELAY_MS = 30_000;

const silentLogger: any = {
  level: "silent",
  child() { return silentLogger; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

let sock: WASocket | null = null;
let state: EngineState = "IDLE";
let lastError = "";
let stateSince = Date.now();
let qrDataUrl = "";
let me: { number: string; name: string } | null = null;
let intentionalStop = false;
let startPromise: Promise<void> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let lastAutoAttempt = 0;

// ---------------------------------------------------------------------------
// Delivery tracking — the privacy lock needs to know the moment a message
// ACTUALLY reached the recipient's phone. WhatsApp reports this as a receipt
// status on the message (DELIVERY_ACK = 3, READ = 4, PLAYED = 5); Baileys
// surfaces them as `messages.update` events. We keep the best status seen
// per message id so a send can wait for it (fast path) and LATE receipts
// (recipient's phone was offline for hours) still land via the listener.
// ---------------------------------------------------------------------------
export type DeliveryEvent = (msgId: string) => void;
const DELIVERED = proto.WebMessageInfo.Status.DELIVERY_ACK;
const deliveryStatus = new Map<string, number>();
const deliveryListeners = new Set<DeliveryEvent>();

function noteMessageStatus(msgId: string, status: number): void {
  if (!msgId || !Number.isFinite(status) || status <= 0) return;
  const prev = deliveryStatus.get(msgId) || 0;
  if (status <= prev) return;
  deliveryStatus.set(msgId, status);
  if (status >= DELIVERED) {
    for (const cb of deliveryListeners) {
      try { cb(msgId); } catch { /* listener errors never break the socket */ }
    }
  }
}

/** Subscribe to delivery confirmations (fires once per message id). */
export function onDelivery(cb: DeliveryEvent): () => void {
  deliveryListeners.add(cb);
  return () => { deliveryListeners.delete(cb); };
}

/** True when the recipient's phone has confirmed receiving `msgId`. */
export function isDelivered(msgId: string): boolean {
  return !!msgId && (deliveryStatus.get(msgId) || 0) >= DELIVERED;
}

/** Resolve once `msgId` is confirmed delivered — or `false` after the
 *  timeout. The status map survives across sockets, so a re-connecting
 *  session can still confirm a send that happened minutes ago. */
export function waitForDelivery(msgId: string, timeoutMs: number): Promise<boolean> {
  if (!msgId) return Promise.resolve(false);
  if (isDelivered(msgId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(v);
    };
    const off = onDelivery((id) => { if (id === msgId) finish(true); });
    const timer = setTimeout(() => finish(isDelivered(msgId)), Math.max(0, timeoutMs));
  });
}

function userDataDir(): string | null {
  try { return electron().app.getPath("userData"); } catch { return null; }
}
/** <userData>/whatsapp — home of the auth session AND the send-throttle
 *  counters. Exported for the throttle's persisted anti-ban counters. */
export function whatsappStoreDir(): string | null {
  const base = userDataDir();
  return base ? path.join(base, "whatsapp") : null;
}
function authDir(): string | null {
  const base = userDataDir();
  return base ? path.join(base, "whatsapp", "auth") : null;
}
function setState(next: EngineState, error = "") {
  state = next;
  stateSince = Date.now();
  if (error !== undefined && error !== "") lastError = error;
  else if (error === "") lastError = "";
}

/** A paired session's credentials exist AND registration completed on disk.
 * Leftovers from an ABORTED pairing (creds.json written before the QR was
 * scanned) are wiped so the next start doesn't run a doomed handshake that
 * the server answers with 401 — the "logged out after close" class. */
export function hasPersistedSession(): boolean {
  const dir = authDir();
  if (!dir) return false;
  try {
    const credsPath = path.join(dir, "creds.json");
    if (!fs.existsSync(credsPath)) return false;
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
    if (creds?.registered === true) return true;
    // Only wipe when no socket is live — mid-pairing creds are expected to
    // be unregistered for a while and must not be destroyed.
    if (!sock && !startPromise) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return false;
  } catch {
    // Unreadable/corrupt file (possibly mid-write) — do NOT wipe; the next
    // successful write will heal it.
    return false;
  }
}

/** Full engine snapshot for the service layer / UI status mapping. */
export function engineState() {
  return {
    state,
    connected: state === "CONNECTED" && !!sock,
    hasSession: hasPersistedSession(),
    number: me?.number || "",
    name: me?.name || "",
    qrReady: !!qrDataUrl,
    lastError,
    since: stateSince,
  };
}

function clearReconnectTimer() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

async function connectInternal(): Promise<void> {
  const dir = authDir();
  if (!dir) throw new Error("WhatsApp engine is only available inside the app.");
  fs.mkdirSync(dir, { recursive: true });
  clearReconnectTimer();
  const { state: authState, saveCreds } = await useMultiFileAuthState(dir);
  let version: [number, number, number] | undefined;
  try {
    const fetched = await fetchLatestWaWebVersion();
    version = fetched?.version || undefined;
  } catch { /* offline or blocked — Baileys falls back to its bundled version */ }

  sock = makeWASocket({
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, silentLogger),
    },
    logger: silentLogger,
    browser: Browsers.ubuntu("Chrome"),
    version,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update) => void onConnectionUpdate(update));
  // Delivery / read receipts for messages WE sent (privacy lock source).
  // `messages.update` carries { key: { id }, update: { status } } — statuses
  // below DELIVERY_ACK (PENDING/SERVER_ACK) are ignored: "the server took
  // it" is NOT "the recipient got it".
  sock.ev.on("messages.update", (updates: any[]) => {
    for (const u of updates || []) {
      const id = String(u?.key?.id || "");
      const st = Number(u?.update?.status ?? 0);
      if (id && st > 0 && u?.key?.fromMe !== false) noteMessageStatus(id, st);
    }
  });
  if (state !== "QR_REQUIRED" && state !== "CONNECTED") setState("CONNECTING");
}

async function onConnectionUpdate(update: Partial<ConnectionState>) {
  const { connection, lastDisconnect, qr } = update;
  const current = sock;
  if (!current) return; // socket already torn down by stopEngine()

  if (qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      setState("QR_REQUIRED", "");
    } catch { /* QR rendering failure — the next rotation retries */ }
  }

  if (connection === "open") {
    qrDataUrl = "";
    const user = (current as any).user;
    me = {
      number: String(user?.id || "").replace(/@.*$/, ""),
      name: String(user?.name || user?.verifiedName || ""),
    };
    reconnectAttempts = 0;
    setState("CONNECTED", "");
    return;
  }

  if (connection === "close") {
    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
    const reason = String((lastDisconnect?.error as any)?.message || "");
    if (statusCode === DisconnectReason.loggedOut) {
      // The phone unlinked this device — credentials are dead. Wipe them so
      // the next Connect shows a fresh QR instead of a doomed handshake.
      resetAuth();
      sock = null;
      setState("IDLE", "WhatsApp session was unlinked from the phone. Pair again by scanning the QR code.");
      return;
    }
    sock = null;
    if (intentionalStop) { setState("IDLE", ""); return; }
    setState("RECONNECTING", reason);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (intentionalStop || startPromise) return;
  clearReconnectTimer();
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startEngine().catch(() => { /* state/lastError already recorded */ });
  }, delay);
}

function resetAuth() {
  const dir = authDir();
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/** Start the engine (creates the socket; QR/login follows asynchronously).
 *  Single-flight: concurrent callers share one attempt. */
export async function startEngine(): Promise<void> {
  if (sock || startPromise) return startPromise ?? Promise.resolve();
  intentionalStop = false;
  lastError = "";
  startPromise = connectInternal()
    .catch((err: any) => {
      setState("IDLE", String(err?.message || err));
      sock = null;
      throw err;
    })
    .finally(() => { startPromise = null; });
  return startPromise;
}

/** Auto-start from status polling — only when a paired session exists (no
 *  pointless QR handshakes for unpaired machines) and within the backoff. */
export function maybeStartEngine(): void {
  if (sock || startPromise || intentionalStop) return;
  if (!hasPersistedSession()) return;
  if (Date.now() - lastAutoAttempt < AUTO_START_BACKOFF_MS) return;
  lastAutoAttempt = Date.now();
  startEngine().catch(() => { /* recorded in state */ });
}

/** Wait for Baileys' ASYNC auth writes (fs/promises under a mutex) to reach
 * the disk. Called on quit: if the app exits the instant the socket closes,
 * a pending key rotation can be lost — the next login then presents stale
 * keys, the server answers 401, and the session looks "logged out". */
export function flushAuthWrites(ms = 600): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tear the session down. WITHOUT `logout` the paired device STAYS linked on
 *  the phone (clean WebSocket close) — the close/quit path. With
 * `logout: true` the device is unlinked on the phone AND credentials are
 * wiped — only for an explicit "Unlink phone" action. */
export async function stopEngine(opts: { logout?: boolean } = {}): Promise<void> {
  intentionalStop = true;
  clearReconnectTimer();
  const current = sock;
  sock = null;
  qrDataUrl = "";
  if (!current) { setState("IDLE", ""); return; }
  try {
    if (opts.logout) {
      await Promise.race([current.logout(), new Promise((r) => setTimeout(r, 6000))]);
    } else {
      await Promise.race([current.end(new Error("stopped")), new Promise((r) => setTimeout(r, 3000))]);
    }
  } catch { /* already closed */ }
  if (opts.logout) resetAuth();
  me = null;
  setState("IDLE", "");
}

/** Current QR code as a PNG data URL, waiting for the first one to arrive. */
export async function currentQr(waitMs = 25000): Promise<string> {
  if (!sock && !startPromise) await startEngine().catch(() => { /* surfaced below */ });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (qrDataUrl) return qrDataUrl;
    if (!sock && !startPromise && state === "IDLE" && lastError) {
      throw new Error(lastError ? `Could not start WhatsApp: ${lastError}` : "QR code is not available yet");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("QR code is not available yet");
}

/** Socket for interactive actions — throws actionable guidance when the
 *  session is not paired/connected yet. */
export function requireConnectedSocket(): WASocket {
  if (state === "CONNECTED" && sock) return sock;
  if (state === "QR_REQUIRED") throw new Error("WhatsApp is not paired yet. Open the WhatsApp page and scan the QR code, then try again.");
  throw new Error("WhatsApp is not connected yet. Open the WhatsApp page, connect and scan the QR code, then try again.");
}

/** Resolve a phone number to a WhatsApp JID, verifying it is registered.
 *  10-digit local numbers are retried with the +91 (India) country code. */
export async function resolveJid(phone: string): Promise<string> {
  const s = requireConnectedSocket();
  const digits = String(phone || "").replace(/\D/g, "");
  const candidates = digits.length ? [digits] : [];
  if (digits.length === 10) candidates.push(`91${digits}`);
  for (const candidate of candidates) {
    try {
      const results = await s.onWhatsApp(candidate);
      const hit = (results || []).find((r: any) => r?.exists && r?.jid);
      if (hit) return String(hit.jid);
    } catch { /* try the next candidate form */ }
  }
  throw new Error("This number is not registered on WhatsApp");
}

/** Send a plain text message over the paired session. */
export async function engineSendText(jid: string, text: string): Promise<{ id: string }> {
  const s = requireConnectedSocket();
  const result: any = await s.sendMessage(jid, { text });
  return { id: String(result?.key?.id || "") };
}

/** Send a PDF document (e.g. an A6 receipt) with a text caption. */
export async function engineSendDocument(jid: string, pdf: Buffer, fileName: string, caption: string): Promise<{ id: string }> {
  const s = requireConnectedSocket();
  const result: any = await s.sendMessage(jid, {
    document: pdf,
    fileName,
    mimetype: "application/pdf",
    caption,
  });
  return { id: String(result?.key?.id || "") };
}

/** Delete leftover data from the retired WAHA gateway (sessions/files dirs). */
export function clearLegacyWahaData(): void {
  const base = userDataDir();
  if (!base) return;
  for (const name of ["sessions", "files"]) {
    try { fs.rmSync(path.join(base, "whatsapp", name), { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
