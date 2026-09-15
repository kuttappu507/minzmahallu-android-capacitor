// node:module shim for the Android web bundle — nothing in the WebView may
// reach Node's require(). Any code path that tries to (Electron-only modules)
// fails loudly instead of silently misbehaving.
export function createRequire(): never {
  throw new Error("require() is not available in the MMS Android app");
}
export default { createRequire };
