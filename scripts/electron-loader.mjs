// ESM loader: resolve bare specifiers "electron" and "better-sqlite3" to local
// shims so the real electron/db/connection.ts can run under plain Node.
// Also maps relative ".js" imports to ".ts" source files so scripts can import
// the full service layer (data.service.ts etc.) directly from TypeScript.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronStub = new URL("./electron-stub.mjs", import.meta.url).href;
const bsqliteShim = new URL("./better-sqlite3-shim.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") return { url: electronStub, shortCircuit: true };
  if (specifier === "better-sqlite3") return { url: bsqliteShim, shortCircuit: true };
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd() + "/x.mjs";
    const base = path.resolve(path.dirname(parent), specifier);
    const ts = base.slice(0, -3) + ".ts";
    if (fs.existsSync(ts)) return { url: new URL("file://" + ts).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
