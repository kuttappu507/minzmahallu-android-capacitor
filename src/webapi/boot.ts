/*
 * Boot sequence for the MMS Android web bridge.
 *
 * Order matters: the crypto WASM and print fonts prepare first, then the
 * sql.js database opens (or restores), and ONLY THEN is window.mms installed
 * and the month's subscription ledger provisioned — mirroring the desktop's
 * main-process boot. React mounts after this resolves, so the login screen
 * always finds a ready bridge.
 */
import { Buffer } from "buffer";
import { initCrypto } from "./node-shims/crypto";
import { initWebDb } from "./db.web";
import { installWebApi } from "./api";
import { prepareAnekFontCss } from "./print-utils.web";
import * as data from "../../electron/services/data.service.js";

let bootPromise: Promise<void> | null = null;

export function bootWebBridge(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    (globalThis as any).Buffer = Buffer;
    await Promise.all([initCrypto(), prepareAnekFontCss()]);
    await initWebDb();
    installWebApi();
    try { data.subscriptions.ensureCurrentMonth(); } catch (err) { console.warn("[mms.boot] monthly generation deferred:", err); }
  })();
  return bootPromise;
}
