import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Android web-build module redirection.
 *
 * The Electron service modules import two Node-bound files:
 *   - electron/db/connection.js   (better-sqlite3 + Electron app paths)
 *   - electron/print/utils.js     (fs-based font/stylesheet loaders)
 *
 * For the Capacitor bundle BOTH are redirected to browser implementations,
 * so the REAL service code (16 domain modules, auth, security, doc numbers,
 * receipt/certificate templates) runs unmodified inside the WebView against
 * sql.js. The vite dev server and any electron build of this branchout are
 * not supported — desktop development happens in minzmahallu-electron.
 */
function mmsWebShims(): Plugin {
  const resolveWeb = (rel: string) => path.resolve(__dirname, rel);
  return {
    name: "mms-web-shims",
    enforce: "pre",
    resolveId(source, importer) {
      const imp = String(importer || "").split(path.sep).join("/");
      // connection.js — imported as "../db/connection.js", "../../db/connection.js" …
      if (/(^|\/)db\/connection\.js$/.test(source)) return resolveWeb("src/webapi/db.web.ts");
      // print/utils.js — templates inside electron/print/ import "./utils.js"
      if (/(^|\/)print\/utils\.js$/.test(source) || (source === "./utils.js" && imp.includes("/electron/print/"))) {
        return resolveWeb("src/webapi/print-utils.web.ts");
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), mmsWebShims()],
  base: "./",
  // exceljs (and some browserified deps) still reference the Node `global`.
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "node:crypto", replacement: path.resolve(__dirname, "./src/webapi/node-shims/crypto.ts") },
      { find: "node:module", replacement: path.resolve(__dirname, "./src/webapi/node-shims/module.ts") },
    ],
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks: {
          "vendor-sql": ["sql.js"],
          "vendor-crypto": ["hash-wasm"],
          "vendor-excel": ["exceljs"],
        },
      },
    },
  },
});
