/*
 * clear-data.service — factory reset for the RECORD data (production start).
 *
 * "Clear All Data" in Settings → Danger Zone. Erases every business record —
 * families, members, subscriptions and their payment ledger, donations,
 * accounting transactions, marriages, deaths, welfare requests, certificates,
 * documents, tokens, assets, staff, committee, history and the audit trail —
 * so a mahallu can go live on a machine they had been testing on.
 *
 * KEPT on purpose (configuration + reference data, NOT business records):
 * users, permissions, settings, subscription_plans, donation_categories,
 * ledger_accounts, sessions, whatsapp_settings, schema_version. The operator
 * keeps their login, the mahallu configuration, plans, categories and the
 * chart of accounts.
 *
 * The wipe runs in ONE transaction; AUTOINCREMENT counters are reset so new
 * records start at 1; VACUUM shrinks the file. The caller (IPC layer)
 * re-verifies the administrator password in the main process FIRST and writes
 * the fresh audit-trail genesis entry AFTER the wipe.
 */
import { getDB } from "../../db/connection.js";

/** Business-record tables erased by clearAllData, children before parents
 *  (members before families — members carry the family FK). Tables missing
 *  on an older database are skipped defensively. */
const DATA_TABLES = [
  "audit_chain",
  "audit_log",
  "notifications",
  "documents",
  "certificates",
  "token_events",
  "token_assignments",
  "welfare_requests",
  "marriages",
  "deaths",
  "subscription_payments",
  "subscriptions",
  "donations",
  "transactions",
  "staff_payments",
  "staff",
  "committee_members",
  "family_moves",
  "record_history",
  "assets",
  "members",
  "families",
];

export function clearAllData(reason: string): { cleared: string[] } {
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to clear all data");
  const db = getDB();
  const cleared: string[] = [];
  // PRAGMA foreign_keys is a no-op inside a transaction — toggle OUTSIDE it.
  const fkWasOn = db.pragma("foreign_keys", { simple: true }) as number;
  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      for (const table of DATA_TABLES) {
        try {
          db.prepare(`DELETE FROM ${table}`).run();
          cleared.push(table);
        } catch {
          /* optional table missing on an older database — nothing to erase */
        }
      }
      try {
        db.prepare(
          `DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLES.map(() => "?").join(",")})`
        ).run(...DATA_TABLES);
      } catch {
        /* no AUTOINCREMENT counters on this database */
      }
    });
    tx();
  } finally {
    db.pragma(`foreign_keys = ${fkWasOn ? "ON" : "OFF"}`);
  }
  try { db.exec("VACUUM"); } catch { /* cosmetic — never block the reset */ }
  return { cleared };
}
