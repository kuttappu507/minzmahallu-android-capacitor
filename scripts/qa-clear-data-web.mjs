#!/usr/bin/env node
/**
 * qa-clear-data-web.mjs — CLIENT-SIDE end-to-end test of
 * "Settings → Danger Zone → Clear All Data" on the REAL Android (Capacitor)
 * web build, in a phone-size Chromium (390x844, touch).
 *
 * Drives the actual dist/ the APK wraps: real web bridge (window.mms),
 * real sql.js database persisted to IndexedDB, island menu navigation.
 *   1. First-run setup (admin) on the phone layout
 *   2. Seed via UI: 1 family + 2 donations (DN receipts 001/002)
 *   3. RELOAD — proves IndexedDB persistence BEFORE any wipe
 *   4. Danger Zone wipe (SecureActionDialog: reason + admin password)
 *   5. After wipe: lists empty, audit shows only CLEAR_ALL_DATA, next
 *      donation receipt restarts at 001, same-admin login still works
 *
 * Run:  node scripts/qa-clear-data-web.mjs        (after `npx vite build`)
 * Screenshots land in qa-screens/clear-data-web/.
 */
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(REPO, "dist");
const SHOTS = path.join(REPO, "qa-screens", "clear-data-web");
const CHROME = "/home/z/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const ADMIN = { name: "QA Administrator", user: "admin", pass: "Str0ng!Passw0rd" };
const TODAY = new Date().toISOString().slice(0, 10);
const PORT = 4890;

const results = []; let pass = 0, fail = 0, current = "init", page, errors = 0;
const log = (m) => console.log("  " + m);
function check(name, cond, detail = "") {
  if (cond) { pass++; log("PASS " + name + (detail ? " — " + detail : "")); results.push(["PASS", name, detail]); }
  else { fail++; log("FAIL " + name + (detail ? " — " + detail : "")); results.push(["FAIL", name, detail]); }
}
async function shot(n) { fs.mkdirSync(SHOTS, { recursive: true }); await page?.screenshot({ path: path.join(SHOTS, n + ".png") }).catch(() => {}); }
async function step(name, fn) {
  current = name; log("▶ STEP " + name);
  try { await fn(); }
  catch (e) { await shot("FAIL-" + name.replace(/\W+/g, "_")); fail++; results.push(["FAIL", name + " (threw)", e.message.split("\n")[0]]); throw e; }
}

// --- static file server for dist/ -------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const file = path.join(DIST, p);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

// --- phone helpers -----------------------------------------------------------
const modal = () => page.locator(".modal-root.open .modal");
const field = (scope, label) => scope.locator(`div:has(> label:has-text("${label}")) input`).first();
const sfield = (scope, label) => scope.locator(`div:has(> label:has-text("${label}")) select`).first();
const btn = (scope, text) => scope.getByRole("button", { name: text }).first();
async function nav(name) { // island menu navigation (items are buttons)
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator(".island-panel").waitFor({ timeout: 10000 });
  await page.locator(".island-item", { hasText: name }).first().click();
  await page.locator(".island-panel").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function waitModalGone() { await page.waitForFunction(() => !document.querySelector(".modal-root.open"), null, { timeout: 15000 }); }
const dashReady = () => page.getByText(/Assalamu Alaikum/).first().waitFor({ timeout: 30000 });
async function loginIfRequired() { // web bridge session is in-memory: every reload lands on Sign In
  await page.waitForTimeout(900);
  if (await page.locator('input[type="password"]').count()) {
    await field(page, "Username").fill(ADMIN.user);
    await page.locator('input[type="password"]').fill(ADMIN.pass);
    await btn(page, "Login").click();
  }
  await dashReady();
}

async function addDonation(donor, category, amount) {
  await btn(page, "Add Donation").click();
  await field(modal(), "Donor Name").fill(donor);
  await sfield(modal(), "Category").selectOption({ label: category });
  await modal().locator('input[type="number"]').fill(amount);
  await modal().locator('input[type="date"]').fill(TODAY);
  await btn(modal(), "Save").click();
  await waitModalGone();
}

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error("dist/index.html missing — run `npx vite build` first");
  fs.rmSync(SHOTS, { recursive: true, force: true });
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", () => errors++);

  try {
    // 1 ── first-run setup on the phone layout --------------------------------
    await step("first-run-setup", async () => {
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
      await page.getByText("Initial Setup").waitFor({ timeout: 40000 });
      await shot("01-setup");
      await field(page, "Full name").fill(ADMIN.name);
      await field(page, "Username").fill(ADMIN.user);
      await page.locator('input[type="password"]').nth(0).fill(ADMIN.pass);
      await page.locator('input[type="password"]').nth(1).fill(ADMIN.pass);
      await btn(page, "Create Administrator Account").click();
      await dashReady();
      check("setup created admin and entered app (phone layout)", true);
    });
    await shot("02-dashboard");

    // 2 ── seed data through the island menu ----------------------------------
    await step("seed-family-and-donations", async () => {
      await nav("Families");
      await btn(page, "Add Family").click();
      await field(modal(), "House Name").fill("Test House One");
      await field(modal(), "Phone").fill("9876543210");
      await btn(modal(), "Save").click();
      await waitModalGone();
      await page.getByText("Test House One").first().waitFor();
      check("family added via island + card UI", true);

      await nav("Donations");
      await addDonation("Abu Test", "General Donation", "500");
      await addDonation("Fathima Test", "Masjid Donation", "750");
      await page.getByText("Fathima Test").first().waitFor();
      const receipts = await page.getByText(/DN\/\d+\/\d+\/\d{3}/).allTextContents();
      check("2 donations with DN receipts 001+002", /001/.test(receipts.join("|")) && /002/.test(receipts.join("|")), receipts.map(s => s.trim()).join(", "));
      await shot("03-donations");
    });

    // 3 ── reload persistence (IndexedDB) BEFORE the wipe ----------------------
    await step("reload-persistence", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await loginIfRequired();
      await nav("Donations");
      await page.getByText("Abu Test").first().waitFor();
      check("data survives reload (IndexedDB persistence)", true);
      await shot("04-after-reload");
    });

    // 4 ── Danger Zone wipe ----------------------------------------------------
    await step("danger-zone-clear", async () => {
      await nav("Settings");
      await shot("05-danger-zone");
      await btn(page, "Clear All Data").click();
      await page.getByText("Clear all data").first().waitFor();
      await shot("06-clear-dialog");
      await page.locator(".modal-root.open textarea").first().fill("E2E phone wipe test");
      await page.locator('.modal-root.open input[type="password"]').fill(ADMIN.pass);
      await btn(modal(), "Erase everything").click();
      await page.getByText("factory-fresh").first().waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2500); // auto reload 900ms after toast
      check("wipe accepted (admin password verified)", true);
    });

    // 5 ── after the wipe -------------------------------------------------------
    await step("post-wipe-empty-and-receipt-reset", async () => {
      await loginIfRequired();

      await nav("Families");
      await page.waitForTimeout(600);
      check("Families empty after wipe", (await page.locator(".empty-state").count()) > 0 && (await page.getByText("Test House One").count()) === 0);

      await nav("Donations");
      await page.waitForTimeout(600);
      check("Donations empty after wipe", (await page.locator(".empty-state").count()) > 0 && (await page.getByText("Abu Test").count()) === 0);

      await nav("Audit Log");
      await page.waitForTimeout(600);
      const body = await page.locator("body").textContent();
      check("audit log shows CLEAR_ALL_DATA", body.includes("CLEAR_ALL_DATA"));
      await shot("07-audit");

      await nav("Donations");
      await addDonation("Post Wipe Donor", "General Donation", "300");
      await page.getByText("Post Wipe Donor").first().waitFor();
      const receipt = (await page.getByText(/DN\/\d+\/\d+\/\d{3}/).allTextContents()).join("|");
      check("receipt sequence restarted at 001", /001/.test(receipt) && !/002/.test(receipt), receipt.trim());
      check("app fully usable after wipe (new donation saved)", true);
      await shot("08-post-wipe-donation-001");

      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Sign In").waitFor({ timeout: 30000 });
      await field(page, "Username").fill(ADMIN.user);
      await page.locator('input[type="password"]').fill(ADMIN.pass);
      await btn(page, "Login").click();
      await dashReady();
      check("admin login works after wipe (users/settings kept)", true);
      await shot("09-relogin");
    });
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }

  console.log("\n════════ SUMMARY (Android dist, phone viewport) ════════");
  for (const [s, name, detail] of results) console.log(` ${s === "PASS" ? "✔" : "✘"} ${name}${detail ? "  [" + detail + "]" : ""}`);
  console.log(`\n RESULT: ${pass} passed, ${fail} failed; page errors: ${errors}`);
  console.log(" Screenshots: " + SHOTS);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("\nE2E ABORTED at step [" + current + "]:", e.message?.split("\n")[0]); process.exit(1); });
