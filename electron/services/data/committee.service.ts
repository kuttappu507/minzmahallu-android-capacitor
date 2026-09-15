/* Committee module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run, scalar } from "../../db/connection.js";
import { istPlusDays, todayIST } from "../ist-date.js";

// Elected/nominated committee members with term tracking. Distinct from Staff
// (which are paid employees). Positions: President, VP, Secretary, Joint Secretary,
// Treasurer, Auditor, Committee Member, Advisory Member, etc.
export const committee = {
  list: (filter: { search?: string; position?: string; committeeType?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(c.name LIKE ? OR c.committee_code LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t);
    }
    if (filter.position && filter.position !== "All") {
      where.push("c.position = ?");
      params.push(filter.position);
    }
    if (filter.committeeType && filter.committeeType !== "All") {
      where.push("c.committee_type = ?");
      params.push(filter.committeeType);
    }
    if (filter.status && filter.status !== "All") {
      if (filter.status === "Archived") {
        where.push("c.archive_state = 1");
      } else {
        where.push("c.archive_state = 0 AND c.status = ?");
        params.push(filter.status);
      }
    } else {
      // Default: exclude archived.
      where.push("c.archive_state = 0");
    }
    const sql = `SELECT c.*, m.member_code AS linked_member_code, m.name AS linked_member_name, m.mobile AS linked_member_mobile
      FROM committee_members c LEFT JOIN members m ON m.id = c.member_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.committee_code ASC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM committee_members c WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT c.*, m.member_code AS linked_member_code, m.name AS linked_member_name FROM committee_members c LEFT JOIN members m ON m.id = c.member_id WHERE c.id = ?", [id]),
  positions: () => ["President", "Vice President", "Secretary", "Joint Secretary", "Treasurer", "Auditor", "Committee Member", "Advisory Member", "Trustee", "Other"],
  types: () => ["Executive", "Advisory", "Working", "Sub-Committee", "Trust"],
  create: (data: any) => {
    const num = scalar<string>(
      "SELECT 'COM-' || printf('%04d', COALESCE(MAX(id), 0) + 1) AS n FROM committee_members"
    );
    const { id } = run(
      `INSERT INTO committee_members
        (committee_code, member_id, name, position, committee_type, phone, email, address, term_start, term_end, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num,
        data.memberId ?? null,
        data.name ?? "",
        data.position ?? "Committee Member",
        data.committeeType ?? "Executive",
        data.phone ?? "",
        data.email ?? "",
        data.address ?? "",
        data.termStart ?? null,
        data.termEnd ?? null,
        data.status ?? "Active",
        data.notes ?? ""
      ]
    );
    return { id, committeeCode: num };
  },
  update: (id: number, data: any) =>
    run(
      `UPDATE committee_members SET member_id = ?, name = ?, position = ?, committee_type = ?, phone = ?, email = ?, address = ?, term_start = ?, term_end = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.memberId ?? null,
        data.name ?? "",
        data.position ?? "Committee Member",
        data.committeeType ?? "Executive",
        data.phone ?? "",
        data.email ?? "",
        data.address ?? "",
        data.termStart ?? null,
        data.termEnd ?? null,
        data.status ?? "Active",
        data.notes ?? "",
        id
      ]
    ),
  archive: (id: number, reason: string, userId: number) =>
    run(
      `UPDATE committee_members SET archive_state = 1, archive_source = 'manual', archived_at = datetime('now'), archived_by = ?, archive_reason = ?, status = 'Past', updated_at = datetime('now') WHERE id = ?`,
      [userId, reason, id]
    ),
  restore: (id: number, userId: number) =>
    run(
      `UPDATE committee_members SET archive_state = 0, archive_source = NULL, archived_at = NULL, archived_by = ?, archive_reason = NULL, status = 'Active', updated_at = datetime('now') WHERE id = ?`,
      [userId, id]
    ),
  summary: () => {
    const activeCount = scalar<number>("SELECT COUNT(*) AS v FROM committee_members WHERE archive_state = 0 AND status = 'Active'", []);
    // Terms ending within 30 days (term_end between today and today+30 days).
    const endingSoon = scalar<number>(
      `SELECT COUNT(*) AS v FROM committee_members
       WHERE archive_state = 0 AND status = 'Active' AND term_end IS NOT NULL
         AND term_end >= ? AND term_end <= ?`,
      [todayIST(), istPlusDays(30)]
    );
    const totalCount = scalar<number>("SELECT COUNT(*) AS v FROM committee_members", []);
    return { activeCount, endingSoon, totalCount };
  },
  history: (committeeId: number, limit = 100) =>
    all<any>(
      `SELECT * FROM record_history WHERE entity_type = ? AND entity_id = ? ORDER BY changed_at DESC, id DESC LIMIT ?`,
      ["committee", committeeId, limit]
    ),
};
