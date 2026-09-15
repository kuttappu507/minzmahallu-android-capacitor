/*
 * update-check — pure-logic regression guard.
 *
 * Pins the monthly cadence contract: version comparison must be NUMERIC
 * (1.10.0 > 1.9.9), unparseable versions must never claim an update, the
 * due-gate must allow the first check and then stay quiet for the interval,
 * and a GitHub answer with a newer tag must flip updateAvailable only when
 * genuinely newer.
 */
import { describe, it, expect } from "vitest";
import {
  parseVersionParts,
  isNewerVersion,
  isCheckDue,
  checkLatestRelease,
  pickDownloadAsset,
  RELEASES_API_URL,
  RELEASES_PAGE_URL,
} from "./update-check.js";

const DAY = 24 * 60 * 60 * 1000;

describe("parseVersionParts", () => {
  it("strips the v prefix and parses the numeric core", () => {
    expect(parseVersionParts("v2.10.3")).toEqual([2, 10, 3]);
    expect(parseVersionParts("V1.2")).toEqual([1, 2]);
    expect(parseVersionParts("2.0.0")).toEqual([2, 0, 0]);
  });
  it("ignores pre-release/build suffixes", () => {
    expect(parseVersionParts("2.0.0-beta.2")).toEqual([2, 0, 0]);
    expect(parseVersionParts("1.2.3+build.7")).toEqual([1, 2, 3]);
  });
  it("rejects garbage", () => {
    expect(parseVersionParts("")).toBeNull();
    expect(parseVersionParts("abc")).toBeNull();
    expect(parseVersionParts("1.x.3")).toBeNull();
    expect(parseVersionParts("latest")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares numerically, not lexicographically", () => {
    expect(isNewerVersion("2.0.0", "2.10.0")).toBe(true);   // 10 > 9 trap
    expect(isNewerVersion("1.9.9", "1.10.0")).toBe(true);
    expect(isNewerVersion("2.0.0", "2.0.10")).toBe(true);
    expect(isNewerVersion("1.9.9", "1.10.0")).toBe(true);
  });
  it("equal or older versions never claim an update", () => {
    expect(isNewerVersion("2.0.0", "v2.0.0")).toBe(false);
    expect(isNewerVersion("2.1.0", "2.0.9")).toBe(false);
    expect(isNewerVersion("2.1.0", "2.1")).toBe(false);       // missing part = 0
  });
  it("treats equal cores with pre-release tags as up to date", () => {
    expect(isNewerVersion("2.0.0", "2.0.0-beta.1")).toBe(false);
    expect(isNewerVersion("2.0.0-beta.1", "2.0.0")).toBe(false); // core equal
  });
  it("more parts win when the prefix matches", () => {
    expect(isNewerVersion("2.0", "2.0.1")).toBe(true);
  });
  it("unparseable input never claims an update", () => {
    expect(isNewerVersion("dev", "2.0.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "")).toBe(false);
  });
});

describe("isCheckDue (monthly gate)", () => {
  it("checks when nothing was recorded yet", () => {
    expect(isCheckDue(1_000_000, null)).toBe(true);
    expect(isCheckDue(1_000_000, undefined)).toBe(true);
  });
  it("stays quiet inside the interval", () => {
    const now = 10 * DAY;
    expect(isCheckDue(now, now - 29 * DAY)).toBe(false);
    expect(isCheckDue(now, now - DAY)).toBe(false);
  });
  it("fires once the full interval elapsed", () => {
    const now = 40 * DAY;
    expect(isCheckDue(now, now - 30 * DAY)).toBe(true);
    expect(isCheckDue(now, now - 31 * DAY)).toBe(true);
  });
});

describe("pickDownloadAsset (direct installer link)", () => {
  const asset = (name: string, url?: string) => ({ name, browser_download_url: url ?? `https://github.com/kuttappu507/minzmahallu-electron/releases/download/v9.9.9/${name}` });
  const win = [
    asset("Minz.Mahallu.Setup.9.9.9.exe.blockmap"),
    asset("Minz.Mahallu.Setup.9.9.9.exe"),
    asset("Minz.Mahallu-9.9.9-win.zip"),
    asset("Minz.Mahallu-9.9.9-mac.dmg"),
  ];

  it("windows: picks the Setup .exe, never the blockmap or zip", () => {
    expect(pickDownloadAsset({ assets: win }, "win32")).toBe(win[1].browser_download_url);
  });
  it("windows: prefers a plain .exe over archives when no Setup name exists", () => {
    const assets = [asset("app-9.9.9-win.zip"), asset("app-9.9.9-portable.exe")];
    expect(pickDownloadAsset({ assets }, "win32")).toBe(assets[1].browser_download_url);
  });
  it("macOS: prefers .dmg, falls back to .zip", () => {
    expect(pickDownloadAsset({ assets: win }, "darwin")).toBe(win[3].browser_download_url);
    const zipOnly = [asset("app-9.9.9-mac.zip")];
    expect(pickDownloadAsset({ assets: zipOnly }, "darwin")).toBe(zipOnly[0].browser_download_url);
  });
  it("linux: prefers .AppImage, falls back to .deb", () => {
    const assets = [asset("app_9.9.9_amd64.deb"), asset("App-9.9.9.AppImage")];
    expect(pickDownloadAsset({ assets }, "linux")).toBe(assets[1].browser_download_url);
    expect(pickDownloadAsset({ assets: [assets[0]] }, "linux")).toBe(assets[0].browser_download_url);
  });
  it("rejects non-github download URLs instead of opening a foreign host", () => {
    const assets = [asset("mirror-installer.exe", "https://cdn.example.com/installer.exe"), asset("Minz.Mahallu.Setup.9.9.9.exe")];
    expect(pickDownloadAsset({ assets }, "win32")).toBe(assets[1].browser_download_url);
    const evilOnly = [asset("evil.exe", "http://github.com.evil.io/evil.exe")];
    expect(pickDownloadAsset({ assets: evilOnly }, "win32")).toBeNull();
  });
  it("no usable assets → null (UI falls back to the release page)", () => {
    expect(pickDownloadAsset({}, "win32")).toBeNull();
    expect(pickDownloadAsset({ assets: [] }, "win32")).toBeNull();
    expect(pickDownloadAsset({ assets: [asset("notes.txt")] }, "win32")).toBeNull();
  });
});

describe("checkLatestRelease (injected fetch)", () => {
  const jsonResponse = (body: unknown, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it("flags a newer release and keeps the https release URL", async () => {
    const r = await checkLatestRelease("2.0.0", jsonResponse({ tag_name: "v2.1.0", html_url: `${RELEASES_PAGE_URL.replace(/latest$/, "tag/v2.1.0")}` }) as any);
    expect(r).toMatchObject({ ok: true, updateAvailable: true, latestVersion: "2.1.0" });
    expect(r.url?.startsWith("https://github.com/")).toBe(true);
  });
  it("carries the direct installer download URL when the release ships one", async () => {
    const body = {
      tag_name: "v2.1.0",
      html_url: RELEASES_PAGE_URL,
      assets: [
        { name: "Minz.Mahallu.Setup.2.1.0.exe.blockmap", browser_download_url: "https://github.com/kuttappu507/minzmahallu-electron/releases/download/v2.1.0/Minz.Mahallu.Setup.2.1.0.exe.blockmap" },
        { name: "Minz.Mahallu.Setup.2.1.0.exe", browser_download_url: "https://github.com/kuttappu507/minzmahallu-electron/releases/download/v2.1.0/Minz.Mahallu.Setup.2.1.0.exe" },
      ],
    };
    const r = await checkLatestRelease("2.0.0", jsonResponse(body) as any, "win32");
    expect(r.updateAvailable).toBe(true);
    expect(r.downloadUrl).toBe("https://github.com/kuttappu507/minzmahallu-electron/releases/download/v2.1.0/Minz.Mahallu.Setup.2.1.0.exe");
  });
  it("downloadUrl is null when the release ships no installer asset", async () => {
    const r = await checkLatestRelease("2.0.0", jsonResponse({ tag_name: "v2.1.0", html_url: RELEASES_PAGE_URL, assets: [] }) as any, "win32");
    expect(r.updateAvailable).toBe(true);
    expect(r.downloadUrl).toBeNull();
  });
  it("stays quiet when the installed version is the latest", async () => {
    const r = await checkLatestRelease("2.1.0", jsonResponse({ tag_name: "v2.1.0", html_url: RELEASES_PAGE_URL }) as any);
    expect(r).toMatchObject({ ok: true, updateAvailable: false });
  });
  it("non-2xx answers do not claim an update", async () => {
    const r = await checkLatestRelease("2.0.0", jsonResponse({}, 404) as any);
    expect(r).toMatchObject({ ok: false });
    expect(r.updateAvailable).toBeFalsy();
  });
  it("missing tag_name is a controlled no-release-info", async () => {
    const r = await checkLatestRelease("2.0.0", jsonResponse({ foo: 1 }) as any);
    expect(r).toMatchObject({ ok: false, reason: "no-release-info" });
  });
  it("network errors resolve instead of throwing", async () => {
    const r = await checkLatestRelease("2.0.0", (async () => { throw new Error("offline"); }) as any);
    expect(r).toMatchObject({ ok: false, reason: "network-error" });
  });
  it("points at the repo's own releases page by default", () => {
    expect(RELEASES_API_URL).toContain("kuttappu507/minzmahallu-electron");
    expect(RELEASES_PAGE_URL).toBe("https://github.com/kuttappu507/minzmahallu-electron/releases/latest");
  });
});
