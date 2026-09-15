import { app, ipcMain } from "electron";
import { whatsapp } from "./services/whatsapp.service.js";
import { recipientStats } from "./services/whatsapp-recipient.service.js";
import { flushAuthWrites, maybeStartEngine, stopEngine } from "./services/whatsapp-engine.service.js";
import type { Actor } from "./services/security.service.js";

// WhatsApp IPC — auth-gated exactly like the rest of the app. The actor
// provider is wired from main.ts (the logged-in session), so every
// whatsapp:* handler fails closed when nobody is signed in.
let registered = false;

export function registerWhatsAppIpc(getActor: () => Actor | null) {
  if (registered) return;
  registered = true;
  whatsapp.init();

  const actor = (): Actor => {
    const current = getActor();
    if (current) return current;
    const authActor = (globalThis as any).__mmsGetActor?.() as Actor | null | undefined;
    if (authActor) return authActor;
    throw new Error("Authentication is required for this operation");
  };
  const requireAuth = () => actor();

  const register = (name: string, handler: (...args: any[]) => any) => {
    try { ipcMain.removeHandler(name); } catch {}
    ipcMain.handle(name, async (_event, ...args) => handler(...args));
  };

  // Clear the auth hook used by the main-process services on logout so a
  // walked-away workstation cannot keep using the WhatsApp API.
  register("whatsapp:invalidateAuth", () => {
    (globalThis as any).__mmsClearActor?.();
    return { success: true };
  });
  register("whatsapp:status", () => { requireAuth(); return whatsapp.status(); });
  // `connect` carries the ToS consent: the renderer's safety-notice checkbox
  // sets `acknowledged` — the FIRST pairing is refused without it (stored in
  // whatsapp_settings.tos_ack_at, so later resumes don't re-ask).
  register("whatsapp:connect", (opts?: { acknowledged?: boolean }) => { requireAuth(); return whatsapp.connect(opts || {}); });
  register("whatsapp:ackToS", () => { requireAuth(); return whatsapp.acknowledgeToS(); });
  register("whatsapp:qr", () => { requireAuth(); return whatsapp.qr(); });
  // PAUSE the engine — the paired device stays linked on the phone, so
  // Connect resumes without a new QR scan.
  register("whatsapp:disconnect", () => { requireAuth(); return whatsapp.disconnect(); });
  // Full unlink — removes the device from the phone's Linked Devices and
  // wipes stored credentials. Only for an explicit "Unlink phone" action.
  register("whatsapp:unlink", () => { requireAuth(); return whatsapp.unlink(); });
  // `register` (above) already strips the Electron IPC event from the
  // argument list (`handler(...args)`), so the handlers below receive the
  // renderer's arguments DIRECTLY — no leading `_event` parameter. The earlier
  // phantom `_e` first parameter silently swallowed the first real argument
  // (donationId arrived as undefined → "Donation not found", announcement
  // text arrived as undefined → "cannot be empty", campaign ids likewise).
  register("whatsapp:checkNumber", (phone: string) => { requireAuth(); return whatsapp.checkNumber(phone); });
  register("whatsapp:setFamily", (familyId: number, phone: string, enabled: boolean) => { requireAuth(); return whatsapp.setFamilyWhatsApp(familyId, phone, enabled); });
  register("whatsapp:getFamily", (familyId: number) => { requireAuth(); return whatsapp.familyWhatsApp(familyId); });
  register("whatsapp:sendMessage", (input: any) => { requireAuth(); return whatsapp.sendMessage(input); });
  // Receipt sends carry the PRIVACY LOCK: a delivered receipt is locked; the
  // one admin-authorized re-send needs the administrator's password, which is
  // verified in the MAIN process (whatsapp.service.gateReceiptSend) — the
  // renderer's promise alone is never enough.
  register("whatsapp:sendDonationReceipt", (donationId: number, adminPassword?: string) => { requireAuth(); return whatsapp.sendDonationReceipt(donationId, { adminPassword }); });
  register("whatsapp:sendSubscriptionReceipt", (subscriptionId: number, adminPassword?: string) => { requireAuth(); return whatsapp.sendSubscriptionReceipt(subscriptionId, { adminPassword }); });
  register("whatsapp:recipientStats", (type: "ANNOUNCEMENT" | "SUBSCRIPTION_REMINDER") => { requireAuth(); return recipientStats(type); });
  register("whatsapp:createSubscriptionCampaign", () => { requireAuth(); return whatsapp.createSubscriptionCampaign(); });
  register("whatsapp:createAnnouncementCampaign", (text: string) => { requireAuth(); return whatsapp.createAnnouncementCampaign(text); });
  register("whatsapp:runCampaign", (id: number) => { requireAuth(); return whatsapp.runCampaign(id); });
  register("whatsapp:getCampaign", (id: number) => { requireAuth(); return whatsapp.campaign(id); });
  register("whatsapp:listCampaigns", (limit?: number) => { requireAuth(); return whatsapp.campaigns(limit || 30); });
  register("whatsapp:listHistory", (limit?: number) => { requireAuth(); return whatsapp.history(limit || 100); });
  register("whatsapp:retryFailed", (id: number) => { requireAuth(); return whatsapp.retryFailed(id); });
  register("whatsapp:runtimeState", () => { requireAuth(); return whatsapp.runtimeState(); });

  // The WhatsApp engine lives in-process — nothing to spawn. When a paired
  // session exists on disk it logs back in silently with the app; an
  // unpaired machine stays idle until the user presses Connect (no QR
  // handshake churn).
  maybeStartEngine();
  // GRACEFUL QUIT: end the WebSocket cleanly and give Baileys' async auth
  // writes (fs/promises) a moment to reach disk BEFORE the process exits.
  // Exiting the instant the socket closes can lose a pending key rotation —
  // the next login then presents stale keys, the server answers 401, and the
  // pairing looks "logged out after close". (main.ts' before-quit closes the
  // DB first; this handler runs after it and finishes the exit itself.)
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void (async () => {
      try {
        await stopEngine();
        await flushAuthWrites();
      } catch { /* best effort */ }
      app.exit(0);
    })();
  });
}
