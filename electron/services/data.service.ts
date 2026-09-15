/*
 * DataService — facade over the per-domain modules in ./data/.
 * Exposes all 16 modules' CRUD + summary operations to the Electron
 * renderer via IPC. Split for maintainability; the public API is
 * byte-for-byte compatible with the previous single-file version.
 */
export { todayIST, istMonth, istPlusDays, istDateStr } from "./ist-date.js";
export { families } from "./data/families.service.js";
export { assets, ASSET_CATEGORIES, ASSET_STATUSES, ASSET_CONDITIONS } from "./data/assets.service.js";
export { members } from "./data/members.service.js";
export { ensureCurrentMonth, subscriptions } from "./data/subscriptions.service.js";
export { donations } from "./data/donations.service.js";
export { accounting } from "./data/accounting.service.js";
export { marriages } from "./data/marriages.service.js";
export { deaths } from "./data/deaths.service.js";
export { welfare } from "./data/welfare.service.js";
export { certificates } from "./data/certificates.service.js";
export { users } from "./data/users.service.js";
export { audit } from "./data/audit.service.js";
export { settings } from "./data/settings.service.js";
export { dashboard } from "./data/dashboard.service.js";
export { tokens } from "./data/tokens.service.js";
export { staff } from "./data/staff.service.js";
export { committee } from "./data/committee.service.js";
export { clearAllData } from "./data/clear-data.service.js";
