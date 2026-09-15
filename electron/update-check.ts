/*
 * update-check — monthly "new release available" checker.
 *
 * The mahallu office machine is often offline for days, so there is no point
 * polling GitHub on every launch. The app asks the SAME GitHub release page
 * the installer is published on (kuttappu507/minzmahallu-electron/releases)
 * at most once every 30 days, remembers the answer next to the database, and
 * informs the office via an in-app banner (renderer event) instead of a
 * modal that interrupts work.
 *
 * Cadence rules:
 *  - A SUCCESSFUL HTTP response (2xx, 404…) records last_check_at, even when
 *    the app is already up to date — otherwise a fresh install would re-ask
 *    on every boot.
 *  - A NETWORK failure records nothing, so the next launch retries — an
 *    offline machine must not skip a whole month because of one timeout.
 *  - `updates:checkNow` (Settings → About) bypasses the monthly gate.
 *
 * No auto-download/auto-install: the banner carries a DIRECT link to the
 * release's installer asset (.exe) so the office gets the file in one click,
 * plus the release page for release notes. Silent self-update would need
 * code-signing plumbing that this project does not have.
 */
import { app, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

export const RELEASES_API_URL = "https://api.github.com/repos/kuttappu507/minzmahallu-electron/releases/latest";
export const RELEASES_PAGE_URL = "https://github.com/kuttappu507/minzmahallu-electron/releases/latest";

/** Monthly: 30 days between checks. */
export const CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
/** Let the app boot and settle (DB, window, fonts) before any network call. */
const STARTUP_DELAY_MS = 25_000;
/** GitHub can hang on flaky links — cap the wait so shutdown is never blocked. */
const FETCH_TIMEOUT_MS = 10_000;
/** Long-running instances get one due-gated retry per day (the gate keeps it monthly). */
const RETRY_TICK_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** "v2.10.3" → [2,10,3]; "2.0.0-beta.2" → [2,0,0]; garbage → null. */
export function parseVersionParts(v: string): number[] | null {
  if (!v) return null;
  const core = String(v).trim().replace(/^[vV]/, "").split(/[-+]/)[0];
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  const parts = core.split(".").map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts;
}

/**
 * True only when `latest` is strictly newer than `current` (numeric compare —
 * "1.10.0" > "1.9.9"). Pre-release suffixes are ignored (core compare only),
 * and unparseable values never claim an update.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersionParts(current);
  const b = parseVersionParts(latest);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

/** Monthly gate: never checked, or the interval has fully elapsed. */
export function isCheckDue(nowMs: number, lastCheckAtMs: number | null | undefined, intervalMs: number = CHECK_INTERVAL_MS): boolean {
  if (lastCheckAtMs == null || !Number.isFinite(lastCheckAtMs)) return true;
  return nowMs - lastCheckAtMs >= intervalMs;
}

// ---------------------------------------------------------------------------
// Persisted state (userData, next to the DB)
// ---------------------------------------------------------------------------

export type UpdateState = {
  last_check_at: number | null;
  latest_version: string | null;
  latest_url: string | null;
  latest_download_url: string | null;
  update_available: boolean;
};

function stateFile(): string {
  return path.join(app.getPath("userData"), "update-check.json");
}

export function readState(): UpdateState {
  try {
    const raw = fs.readFileSync(stateFile(), "utf8");
    const s = JSON.parse(raw);
    return {
      last_check_at: Number.isFinite(s?.last_check_at) ? s.last_check_at : null,
      latest_version: typeof s?.latest_version === "string" ? s.latest_version : null,
      latest_url: typeof s?.latest_url === "string" ? s.latest_url : null,
      latest_download_url: typeof s?.latest_download_url === "string" ? s.latest_download_url : null,
      update_available: !!s?.update_available,
    };
  } catch {
    return { last_check_at: null, latest_version: null, latest_url: null, latest_download_url: null, update_available: false };
  }
}

function writeState(s: UpdateState): void {
  try { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), "utf8"); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Release check
// ---------------------------------------------------------------------------

export type UpdateCheckResult = {
  ok: boolean;
  reason?: "network-error" | "bad-response" | "no-release-info";
  updateAvailable?: boolean;
  latestVersion?: string;
  currentVersion?: string;
  url?: string;
  downloadUrl?: string | null;
};

function safeReleaseUrl(raw: unknown): string | null {
  // Only ever open an https link that GitHub itself handed us.
  if (typeof raw === "string" && raw.startsWith("https://github.com/")) return raw;
  return null;
}

/**
 * Direct-download asset picker — the office user must not have to navigate
 * the GitHub release page to find the right file. Picks the installer asset
 * for the RUNNING platform (Windows .exe for this app), never a .blockmap or
 * source archive, and only accepts github.com-hosted download URLs.
 * Returns null when nothing suitable is uploaded — the UI then falls back to
 * the release page link.
 */
export function pickDownloadAsset(body: any, platform: string = process.platform): string | null {
  const assets: any[] = Array.isArray(body?.assets) ? body.assets : [];
  const candidates: { name: string; url: string }[] = [];
  for (const a of assets) {
    const name = typeof a?.name === "string" ? a.name.toLowerCase() : "";
    const url = safeReleaseUrl(a?.browser_download_url);
    if (!name || !url) continue;
    if (name.endsWith(".blockmap") || name.endsWith(".sig") || name.startsWith("source")) continue;
    candidates.push({ name, url });
  }
  const first = (pred: (n: string) => boolean) => candidates.find((c) => pred(c.name))?.url ?? null;
  if (platform === "darwin") {
    return first((n) => n.endsWith(".dmg")) ?? first((n) => n.endsWith(".zip"));
  }
  if (platform === "linux") {
    return first((n) => n.endsWith(".appimage")) ?? first((n) => n.endsWith(".deb"));
  }
  // win32 (and anything else): NSIS installer .exe — Setup/installer names first
  return (
    first((n) => n.endsWith(".exe") && /(setup|install)/.test(n)) ??
    first((n) => n.endsWith(".exe"))
  );
}

/** One GitHub API round-trip. Never throws. Platform injectable for tests. */
export async function checkLatestRelease(currentVersion: string, fetchImpl: typeof fetch = fetch, platform: string = process.platform): Promise<UpdateCheckResult> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(RELEASES_API_URL, {
        signal: ac.signal,
        headers: { "Accept": "application/vnd.github+json", "User-Agent": "minzmahallu-electron" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, reason: res.status === 404 ? "no-release-info" : "bad-response" };
    const body: any = await res.json();
    const tag = typeof body?.tag_name === "string" ? body.tag_name : "";
    const url = safeReleaseUrl(body?.html_url) || RELEASES_PAGE_URL;
    const downloadUrl = pickDownloadAsset(body, platform);
    if (!tag) return { ok: false, reason: "no-release-info" };
    const updateAvailable = isNewerVersion(currentVersion, tag);
    if (updateAvailable) return { ok: true, updateAvailable: true, latestVersion: tag.replace(/^[vV]/, ""), currentVersion, url, downloadUrl };
    return { ok: true, updateAvailable: false, latestVersion: tag.replace(/^[vV]/, ""), currentVersion, url, downloadUrl };
  } catch {
    return { ok: false, reason: "network-error" };
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

type GetWindow = () => import("electron").BrowserWindow | null;

function pushToRenderer(getWindow: GetWindow, result: UpdateCheckResult): void {
  if (!result.ok || !result.updateAvailable) return;
  try { getWindow()?.webContents.send("update:available", { latestVersion: result.latestVersion, url: result.url, downloadUrl: result.downloadUrl ?? null, currentVersion: result.currentVersion }); } catch { /* window gone */ }
}

/**
 * Runs the monthly due-gated check (boot + daily ticks). Network failures are
 * silent and leave the schedule untouched; a found update is pushed to the UI.
 */
async function dueGatedCheck(getWindow: GetWindow): Promise<void> {
  const state = readState();
  if (!isCheckDue(Date.now(), state.last_check_at)) return;
  const result = await checkLatestRelease(app.getVersion());
  if (result.ok) {
    writeState({
      last_check_at: Date.now(),
      latest_version: result.latestVersion ?? null,
      latest_url: result.url ?? null,
      latest_download_url: result.downloadUrl ?? null,
      update_available: !!result.updateAvailable,
    });
    pushToRenderer(getWindow, result);
  }
  // network-error: no state write → next boot/tick retries
}

/** Registers the updates:* IPC surface. Call once during normal boot. */
export function registerUpdateIpc(getWindow: GetWindow): void {
  // What the renderer needs to (re)draw the banner after a reload.
  ipcMain.handle("updates:status", () => {
    const state = readState();
    return {
      currentVersion: app.getVersion(),
      lastCheckAt: state.last_check_at,
      updateAvailable: state.update_available,
      latestVersion: state.latest_version ? state.latest_version.replace(/^[vV]/, "") : null,
      url: state.latest_url || RELEASES_PAGE_URL,
      downloadUrl: state.latest_download_url,
    };
  });

  // Settings → About "Check now": bypasses the monthly gate, reports detail.
  ipcMain.handle("updates:checkNow", async () => {
    const result = await checkLatestRelease(app.getVersion());
    if (result.ok) {
      writeState({
        last_check_at: Date.now(),
        latest_version: result.latestVersion ?? null,
        latest_url: result.url ?? null,
        latest_download_url: result.downloadUrl ?? null,
        update_available: !!result.updateAvailable,
      });
      // Manual check result is returned directly; ALSO push so the banner
      // appears even if the user is outside Settings.
      pushToRenderer(getWindow, result);
    }
    return result;
  });

  // Direct-download: open the release ASSET (installer file) itself, so the
  // user gets the .exe with one click instead of hunting through the GitHub
  // release page. State-based (not renderer-supplied) so a tampered renderer
  // cannot open arbitrary URLs.
  ipcMain.handle("updates:openDownload", async () => {
    const url = readState().latest_download_url;
    if (typeof url === "string" && url.startsWith("https://github.com/")) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false };
  });

  // Open the SAME GitHub releases page the installer is published on.
  ipcMain.handle("updates:openReleasePage", async () => {
    const url = readState().latest_url || RELEASES_PAGE_URL;
    if (typeof url === "string" && url.startsWith("https://")) await shell.openExternal(url);
    return { success: true };
  });
}

/** Boot hook: one delayed due-gated check, then a daily due-gated tick. */
export function scheduleMonthlyUpdateCheck(getWindow: GetWindow): void {
  const timer = setTimeout(() => { void dueGatedCheck(getWindow); }, STARTUP_DELAY_MS);
  timer.unref?.();
  const tick = setInterval(() => { void dueGatedCheck(getWindow); }, RETRY_TICK_MS);
  tick.unref?.();
}
