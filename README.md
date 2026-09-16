# MMS Mahallu — Android App (Capacitor)

The **Android port** of the Minz Mahallu Management System (mosque community /
mahallu administration). The exact same React app as the desktop edition —
same design, same features — packaged as a native-feeling Android app with
**Capacitor 8** and restructured for phone screens.

> **Every push to `main` automatically builds a signed, installable APK.**
> This repo builds Android only — the Windows/macOS/Linux desktop edition is
> built in [kuttappu507/minzmahallu-electron](https://github.com/kuttappu507/minzmahallu-electron).

## Download the APK (no build tools needed)

**Option A — Actions tab (every commit):**
1. Open the **Actions** tab → the latest green **"Build Android APK"** run.
2. Under **Artifacts**, download `MMS-Mahallu-Android-APK` (a .zip containing
   the .apk). Unzip it to get the .apk file.

**Option B — Releases section:**
- `main` pushes publish to the rolling **"Latest Android APK (main)"**
  pre-release.
- Versioned tags (`v*`) publish proper releases.

### Installing / updating in place

- App ID: `com.mms.minzmahallu` — versionCode **300** (v3.0.0), signed with
  `mms-release.keystore`, the same key as every earlier MMS Android build
  (Kotlin wrapper v2.0.x). The APK therefore **installs directly over the old
  app** — do **not** uninstall the old app first, because the mahallu's data
  lives inside the app's storage.
- First launch: create the admin account, then restore a backup if you have
  one. The app ships **empty** — no demo data.

## What changed for the phone

- **Same design language** as the desktop app (no Material redesign) — colors,
  components and typography are the existing ones, only the layout is
  restructured for small screens.
- **Island menu**: the desktop sidebar became a floating island popup
  (icons + names), opened from a bottom FAB — thumb-reachable, safe-area aware.
- **Tables → cards**: every list screen renders as readable cards on phones,
  with the important values highlighted and actions kept within 48 px touch
  targets.
- **Native feel**: proper safe-area insets (edge-to-edge, camera-cutout safe),
  splash screen, no browser chrome, back-button friendly, no accidental
  pull-to-refresh / overscroll.
- **Bilingual** English + മലയാളം, light/dark themes — as on desktop.

## Architecture

| Layer | Technology |
|---|---|
| UI | Shared React 18 app (unchanged design), Tailwind CSS |
| Native shell | Capacitor 8 / Android WebView (`android/`) |
| Database | sql.js (WASM SQLite), persisted to IndexedDB |
| Business logic | The **real** Electron service modules (`electron/services/data/*`) run unmodified in the WebView |
| Bridge | `window.mms` implemented in `src/webapi/` — a web twin of the Electron main process |
| Security | PBKDF2-SHA256 (200k iterations) via hash-wasm, same auth as desktop |

Key directories:

- `android/` — native Android project (Gradle). Release signing config reads
  `android/keystore/signing.properties` (keystore committed intentionally for
  community sideload updates — handle with care).
- `src/webapi/` — the web bridge: sql.js database layer, node:crypto shim,
  and the full `window.mms` API surface mirroring `electron/preload.mts`.
- `electron/` — kept as the shared backend/business-logic source; the bridge
  aliases `electron/db/connection.ts` to the sql.js implementation at build
  time (Vite plugin), so no Electron source was patched.
- `scripts/qa-clear-data-web.mjs` — headless phone-viewport client-side test
  that boots the real `dist/` build (setup → island menu → card tables →
  Danger Zone wipe → empty states → receipt reset → re-login).

## Build from source

Requirements: Node 20+, JDK 21, Android SDK (licenses accepted).

```bash
npm ci
npm run mobile:apk
# -> android/app/build/outputs/apk/release/app-release.apk
```

- `npm run mobile:web` — typecheck + build the web bundle into `dist/`
- `npm run mobile:sync` — build web + sync into the Android project
- `npm run mobile:apk` — everything above + signed release APK

GitHub Actions does exactly these steps (see
`.github/workflows/build-android.yml`).

## Relationship to the desktop app

This repo was branched from
[minzmahallu-electron](https://github.com/kuttappu507/minzmahallu-electron)
so bug fixes and translations made there flow in, and Android-specific fixes
here stay separate. The desktop edition keeps its own repo, CI and installers.
