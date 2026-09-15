import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — MMS Android (Minz Mahallu Management System).
 *
 * appId MUST stay com.mms.minzmahallu and release builds MUST be signed with
 * keystore/mms-release.keystore: both are shared with every previously
 * released MMS Android build so updates install in-place over the old app
 * (never uninstall — the mosque's data lives inside the app storage).
 */
const config: CapacitorConfig = {
  appId: "com.mms.minzmahallu",
  appName: "MMS Mahallu",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#0b1220",
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#0d9488",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    SystemBars: {
      // Edge-to-edge WebView: env(safe-area-inset-*) carry real values with
      // viewport-fit=cover (index.html), so the app bar clears the camera
      // cutout and the island clears the gesture bar.
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
