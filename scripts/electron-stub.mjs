// Minimal electron stub (ESM, named exports) so connection.ts can run under
// plain Node for database verification.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let userDataDir = path.join(os.tmpdir(), "mms-verify-" + process.pid);
fs.mkdirSync(userDataDir, { recursive: true });

export const app = {
  isPackaged: false,
  getAppPath: () => process.cwd(),
  getPath: (name) => {
    if (name === "userData") return userDataDir;
    return path.join(userDataDir, name);
  },
};

export const dialog = {
  showMessageBoxSync: () => 0,
};
