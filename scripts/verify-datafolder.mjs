// Live verification of the data-folder rename + backup mirror:
//   1) Pre-create the LEGACY app-data folder ("Minz Mahallu Management System")
//      with a marker file — after boot it must be migrated to "mms" (marker kept).
//   2) Login (demo admin), set the backup mirror folder via settings IPC.
//   3) Wait for the 30-second auto-backup timer -> a .mmbak must exist in the
//      app-data folder AND be mirrored to the mirror folder.
// Usage: DISPLAY must point at an Xvfb; node scripts/verify-datafolder.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "mms-datafolder-home-"));
const XDG = path.join(HOME, ".config");
const LEGACY = path.join(XDG, "Minz Mahallu Management System");
const MMS = path.join(XDG, "mms");
const MIRROR = path.join(HOME, "mirror-usb");
const DEBUG_PORT = 9371;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(LEGACY, { recursive: true });
fs.writeFileSync(path.join(LEGACY, "marker.txt"), "legacy-data");
console.log("[verify] seeded legacy folder:", LEGACY);

async function waitForApp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const pages = await res.json();
      const page = pages.find((p) => p.type === "page" && /index\.html|MMS/i.test(p.title + p.url));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("app window never exposed a CDP page");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); delete pending.msg; pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 25000);
    pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r.result?.value;
  };
  return { ready, send, evaluate, close: () => ws.close() };
}

const electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${DEBUG_PORT}`, "--disable-gpu"], {
  cwd: ROOT,
  env: { ...process.env, HOME, XDG_CONFIG_HOME: XDG, DISPLAY: process.env.DISPLAY, NODE_ENV: "", ELECTRON_ENABLE_LOGGING: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
electron.stderr.on("data", (d) => process.stderr.write(`[app-err] ${d}`));
const watchdog = setTimeout(() => { console.error("[verify] WATCHDOG fired"); try { electron.kill("SIGKILL"); } catch {} process.exit(1); }, 200000);

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name);
};

try {
  const wsUrl = await waitForApp();
  const conn = cdp(wsUrl);
  await conn.ready;
  console.log("[verify] attached");

  // migration should have happened during boot, before login
  await sleep(2500);
  check("legacy folder migrated to 'mms'", !fs.existsSync(LEGACY) && fs.existsSync(MMS));
  check("legacy contents preserved (marker.txt)", fs.existsSync(path.join(MMS, "marker.txt")));

  let booted = false;
  for (let i = 0; i < 20 && !booted; i++) {
    booted = await conn.evaluate("!!(window.mms && window.mms.auth)");
    if (!booted) await sleep(500);
  }
  let form = "";
  for (let i = 0; i < 15 && form !== "SUBMITTED"; i++) {
    form = await conn.evaluate(`(() => {
      const setVal = (el, v) => {
        const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const user = document.querySelector('input[autocomplete="username"], form input:not([type="password"])');
      const pass = document.querySelector('input[autocomplete="current-password"]');
      if (!user || !pass) return "MISSING_INPUTS";
      setVal(user, "admin"); setVal(pass, "Admin@2026");
      const btn = document.querySelector('form button[type="submit"]');
      if (!btn) return "MISSING_BUTTON";
      btn.click();
      return "SUBMITTED";
    })()`);
    if (form !== "SUBMITTED") await sleep(800);
  }
  check("demo admin login", form === "SUBMITTED", form);
  await sleep(3000);

  // DB must live inside the new mms folder
  check("database inside the 'mms' folder", fs.existsSync(path.join(MMS, "mms.db")));

  // configure the backup mirror via the real settings IPC
  const saved = await conn.evaluate(`window.mms.settings.save({ backupMirrorDir: ${JSON.stringify(MIRROR)} }).then(() => "saved")`);
  check("mirror folder saved in settings", saved === "saved", String(saved));
  const loaded = await conn.evaluate(`window.mms.settings.load().then(s => s && s.backup_mirror_dir)`);
  check("mirror folder persisted in DB", loaded === MIRROR, String(loaded));

  // wait for the auto-backup (fires 30s after startup) + mirror copy
  let mirrorFile = null;
  for (let i = 0; i < 40 && !mirrorFile; i++) {
    await sleep(2000);
    if (fs.existsSync(MIRROR)) {
      const found = fs.readdirSync(MIRROR).filter((f) => f.endsWith(".mmbak"));
      if (found.length) mirrorFile = path.join(MIRROR, found[0]);
    }
  }
  const localBackups = fs.existsSync(MMS) ? fs.readdirSync(MMS).filter((f) => f.endsWith(".mmbak")) : [];
  check("auto-backup created in app data", localBackups.length > 0, localBackups.join(", ") || "none");
  check("backup MIRRORED to second location", !!mirrorFile, mirrorFile || "none");
  if (mirrorFile && localBackups.length) {
    const a = fs.readFileSync(mirrorFile);
    const local = fs.readFileSync(path.join(MMS, localBackups[0]));
    check("mirror copy is byte-identical", a.equals(local));
  }

  conn.close();
  clearTimeout(watchdog);
} catch (err) {
  console.error("[verify] FAILED:", err?.message || err);
  process.exitCode = 1;
} finally {
  try { electron.kill("SIGTERM"); } catch {}
  await sleep(1200);
  try { electron.kill("SIGKILL"); } catch {}
  console.log(failures.length ? `[verify] ${failures.length} FAILURE(S): ${failures.join(", ")}` : "[verify] ALL CHECKS PASSED");
  process.exit(failures.length ? 1 : (process.exitCode || 0));
}
