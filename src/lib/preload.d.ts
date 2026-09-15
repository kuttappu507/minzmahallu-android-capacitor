/*
 * Type declaration for the window.mms preload bridge.
 * Importing this file makes TS aware of the API.
 */
import type { MmsApi } from "../../electron/preload.mjs";

declare global {
  interface Window {
    mms: MmsApi;
  }
}

export {};
