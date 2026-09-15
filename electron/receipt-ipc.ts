/*
 * Receipt IPC — A6 receipts for donations and subscription payments:
 * generate (saved in the app DB), save a single A6 PDF, or save many
 * receipts as one A4 PDF (4 per sheet). Receipts are always PDFs —
 * there is no direct-to-printer path. Auth-gated like every other handler.
 */
import { ipcMain } from "electron";
import {
  getDonationPdf, getSubscriptionPdf,
  saveDonationPdf, saveSubscriptionPdf,
  saveDonationBatchPdf, saveSubscriptionBatchPdf,
} from "./services/receipt.service.js";
import type { Actor } from "./services/security.service.js";

export function registerReceiptIpc(getActor: () => Actor | null, getWindow: () => Electron.BrowserWindow | null) {
  const register = (name: string, handler: (...args: any[]) => any) => {
    try { ipcMain.removeHandler(name); } catch {}
    ipcMain.handle(name, async (_event, ...args) => handler(...args));
  };
  const requireAuth = () => {
    const actor = getActor();
    if (!actor) throw new Error("Authentication is required");
    return actor;
  };

  // Generation + in-app storage (no dialogs — also used by automated checks).
  register("receipts:getDonationPdf", (id: number) => { requireAuth(); return getDonationPdf(id); });
  register("receipts:getSubscriptionPdf", (subscriptionId: number) => { requireAuth(); return getSubscriptionPdf(subscriptionId); });

  // Save a single A6 receipt PDF (dialog).
  register("receipts:saveDonationPdf", (id: number) => { requireAuth(); return saveDonationPdf(id, getWindow()); });
  register("receipts:saveSubscriptionPdf", (subscriptionId: number) => { requireAuth(); return saveSubscriptionPdf(subscriptionId, getWindow()); });

  // Save MANY receipts as one A4 PDF — 4 per sheet with cut guides.
  register("receipts:saveDonationBatchPdf", (ids: number[]) => { requireAuth(); return saveDonationBatchPdf(ids || [], getWindow()); });
  register("receipts:saveSubscriptionBatchPdf", (subscriptionIds: number[]) => { requireAuth(); return saveSubscriptionBatchPdf(subscriptionIds || [], getWindow()); });
}
