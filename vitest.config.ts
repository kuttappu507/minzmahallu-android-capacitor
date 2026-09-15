import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Plain-Node test environment: route the Electron runtime module and the
      // native better-sqlite3 to the same stubs the smoke scripts use so the
      // service layer (data.service, whatsapp.service, …) is testable.
      electron: path.resolve(__dirname, "./scripts/electron-stub.mjs"),
      "better-sqlite3": path.resolve(__dirname, "./scripts/better-sqlite3-shim.mjs"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
    // Mirror the real post-setup state: a database that accepts writes always
    // has an Administrator (first-run setup). See scripts/vitest-setup.mjs.
    setupFiles: ["./scripts/vitest-setup.mjs"],
    // Several test files now open the per-process SQLite file (the shim keys
    // its userData dir by PID, so parallel files share one database). Schema
    // init from two workers at once would race — files run sequentially; the
    // whole suite stays well under a second.
    fileParallelism: false,
  },
});
