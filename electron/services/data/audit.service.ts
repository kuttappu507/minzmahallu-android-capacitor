/* Audit Log module — split out of data.service.ts (public API unchanged via the facade). */

import { all, getDB, one } from "../../db/connection.js";
import { computeEntryHash, verifyAuditChain } from "../audit-chain.js";

export const audit = {
  list: (filter: { user?: string; action?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.user) {
      where.push("username LIKE ?");
      params.push(`%${filter.user}%`);
    }
    if (filter.action && filter.action !== "All") {
      where.push("action = ?");
      params.push(filter.action);
    }
    const sql = `SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_log WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  log: (userId: number, username: string, action: string, module: string, entityId: number, description: string, metadata: string = "") => {
    try {
      const db = getDB();
      // Tamper-evident chain: every new event stores the hash of the previous
      // event. The append-only triggers (V010) block UPDATE/DELETE on this
      // table, so once written, a row cannot be altered without breaking the
      // chain for every later event.
      const prev = db.prepare("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as { entry_hash: string | null } | undefined;
      const prevHash = prev?.entry_hash || null;
      const entryHash = computeEntryHash(prevHash, {
        userId, username, action, module, entityId, description, metadata,
      });
      db.prepare(
        `INSERT INTO audit_log (user_id, username, action, module, entity_id, description, metadata, prev_hash, entry_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(userId, username, action, module, entityId, description, metadata, prevHash, entryHash);
      // Update the anchor so verification can also detect truncation of the tail.
      const anchor = db.prepare("SELECT event_count FROM audit_chain WHERE id = 1").get() as { event_count: number } | undefined;
      db.prepare("INSERT OR REPLACE INTO audit_chain (id, last_hash, event_count, updated_at) VALUES (1, ?, ?, datetime('now'))")
        .run(entryHash, (anchor?.event_count ?? 0) + 1);
    } catch (e) {
      console.error("[audit] Failed to log:", e);
    }
  },
  /**
   * Walk the whole audit log and verify the hash chain. Returns:
   *   { intact, verified, legacyRows, brokenAtId, anchor }
   */
  verify: () => {
    const rows = all<any>(
      `SELECT id, prev_hash, entry_hash, user_id, username, action, module, entity_id, description, metadata, created_at
       FROM audit_log ORDER BY id ASC`
    );
    const result = verifyAuditChain(rows);
    const anchor = one<any>("SELECT last_hash, event_count, updated_at FROM audit_chain WHERE id = 1") || null;
    // Cross-check the tail: the newest entry_hash must match the anchor.
    const newest = rows.length ? rows[rows.length - 1] : null;
    const tailMatches = !anchor?.last_hash
      ? newest?.entry_hash == null
      : newest?.entry_hash === anchor.last_hash;
    return {
      intact: result.intact && !!tailMatches,
      verified: result.verified,
      legacyRows: result.legacyRows,
      brokenAtId: result.brokenAtId,
      eventCount: anchor?.event_count ?? rows.length,
      anchorMatches: tailMatches,
      verifiedAt: new Date().toISOString(),
    };
  },
};
